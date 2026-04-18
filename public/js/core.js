/* eslint-disable no-undef, no-unused-vars, no-empty -- classic script shares globals across public/js/*.js */
const API = '';  // Same origin
const DAYS = ["Mandag","Tirsdag","Onsdag","Torsdag","Fredag","Lørdag","Søndag"];

// === XSS-safe HTML templating (M1.1) ===
// escapeHtml() gjør strenger DOM-trygge. h`...` er en tagged template
// som auto-escaper alle interpolasjoner — bruk denne i stedet for vanlig
// `...` når resultatet går via innerHTML og inneholder user-kontrollerte
// felter (oppskriftsnavn, kalenderhendelser, pantry-varer, kvitteringer osv).
// For å sette inn rå HTML som allerede er trygg (f.eks. en indre h`...`),
// pakk den med raw() slik at escape hoppes over.
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Sikker URL-validering for href/src — tillater bare http(s):, mailto:, tel:, /relative.
// Returnerer 'about:blank' for javascript:, data:text/html, vbscript: osv.
function safeUrl(u) {
  if (u === null || u === undefined) return '';
  const s = String(u).trim();
  if (s === '') return '';
  // Relative URLer er trygge
  if (s.startsWith('/') || s.startsWith('#') || s.startsWith('?')) return escapeHtml(s);
  // Eksplisitte trygge schemes
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s) || /^tel:/i.test(s)) {
    return escapeHtml(s);
  }
  return 'about:blank';
}
class RawHTML { constructor(value) { this.value = value; } }
function raw(html) { return new RawHTML(html); }
function h(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v instanceof RawHTML) out += v.value;
      else if (Array.isArray(v)) {
        // Array of strings/RawHTML — join without separator (caller kontrollerer)
        for (const item of v) {
          if (item instanceof RawHTML) out += item.value;
          else out += escapeHtml(item);
        }
      }
      else out += escapeHtml(v);
    }
  }
  return new RawHTML(out);
}
// setHTML(elem, content) — tar RawHTML eller string. String antas allerede trygg
// for bakover-kompabilitet med kode som bygger h\`...\` gjennom flere lag.
function setHTML(el, content) {
  if (!el) return;
  el.innerHTML = content instanceof RawHTML ? content.value : String(content ?? '');
  // M5.3: clear aria-busy når innhold er satt
  if (el.hasAttribute('aria-busy')) el.setAttribute('aria-busy', 'false');
}

// === State ===
let currentWeek = null;
let mealsData = null;
let shoppingData = null;
let choresData = null;
let expandedRecipes = new Set();
// ===== FASE_E_BEGIN state-vars =====
let shoppingSubView = 'buy';
let pantryData = null;
let currentShoppingListId = null;
let enrichmentPollTimer = null;
let recipeImportTab = 'text';
let recipeImportImageB64 = null;
// ===== FASE_E_END state-vars =====

// === M5.1 Toast-komponent ===
// Auto-dismiss etter 4s (warn/error etter 6s). Maks 4 samtidige toasts —
// nyeste pusher eldste ut når capen nås. Alle toasts er role=status slik
// at screen readers leser dem.
const MAX_TOASTS = 4;
function showToast(message, type = 'info', durationMs = null) {
  const container = document.getElementById('toastContainer');
  if (!container) { console.log('[toast]', type, message); return; }

  // Cap antall samtidige
  while (container.children.length >= MAX_TOASTS) {
    container.removeChild(container.firstElementChild);
  }

  const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  // Escape user/server tekst — DOM-safe
  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.textContent = icons[type] || icons.info;
  const body = document.createElement('div');
  body.className = 'toast-body';
  body.textContent = String(message ?? '').slice(0, 300);
  const close = document.createElement('button');
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Lukk melding');
  close.textContent = '×';
  close.onclick = () => dismissToast(t);
  t.appendChild(iconSpan);
  t.appendChild(body);
  t.appendChild(close);
  container.appendChild(t);

  // Trigger CSS-transition
  requestAnimationFrame(() => t.classList.add('show'));

  const duration = durationMs ?? (type === 'error' || type === 'warn' ? 6000 : 4000);
  setTimeout(() => dismissToast(t), duration);
}
function dismissToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.remove('show');
  setTimeout(() => { try { el.remove(); } catch {} }, 250);
}

// === Fetch helpers ===
// M4.1: tracking siste request-id globalt så brukerfeil kan refereres
// til noe operator kan grep'e i loggen.
let lastRequestId = null;
let isOffline = false;
async function api(path, opts = {}) {
  try {
    const res = await fetch(API + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const rid = res.headers.get('X-Request-Id');
    if (rid) lastRequestId = rid;
    setOffline(false);
    // 401 on an /api/* call from the main app → the session is gone.
    // Redirect to login if the helper is present (phase 11 adds it).
    if (res.status === 401 && typeof redirectToLogin === 'function') {
      redirectToLogin();
      // Return a benign empty object so callers do not crash before the
      // redirect completes.
      return {};
    }
    const data = await res.json();
    // M5.1: auto-toast på 4xx/5xx med problem+json
    if (!res.ok && data) {
      const errMsg = data.detail || data.title || `HTTP ${res.status}`;
      // Silent for 401/404 på utforsknings-endpoints; alltid vis 5xx
      if (res.status >= 500) {
        showToast(`${errMsg}${data.requestId ? ` (id: ${data.requestId.slice(0, 8)})` : ''}`, 'error');
      } else if (res.status >= 400 && opts.method && opts.method !== 'GET') {
        showToast(errMsg, 'warn');
      }
    }
    return data;
  } catch (err) {
    // Nettverksfeil → marker offline + vis toast
    setOffline(true);
    showToast('Ingen forbindelse — sjekk nettverket', 'error');
    throw err;
  }
}
function getLastRequestId() { return lastRequestId; }

function setOffline(offline) {
  if (offline === isOffline) return;
  isOffline = offline;
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.hidden = !offline;
  document.body.classList.toggle('is-offline', offline);
}
// M5.2: browser-event for offline/online
window.addEventListener('offline', () => { setOffline(true); showToast('Offline', 'warn'); });
window.addEventListener('online', () => { setOffline(false); showToast('Tilkoblet igjen', 'success'); });

// === Uke 4 (FE-8): Confirm dialog utility ===
// Gjenbrukbar confirm-dialog som erstatter native confirm() for destruktive
// handlinger. Fordelene over native confirm():
//   1. Konsistent visuelt med resten av appen (bruker .modal-bg)
//   2. Tastatur-navigerbar (Esc = avbryt, Enter = OK, Tab-fokus)
//   3. Returnerer Promise<boolean> så callere kan await
//   4. Støtter tilpassbare "destructive"-varianter (rød bekreft-knapp)
//   5. Screen reader-vennlig med role=dialog + aria-label + aria-describedby
//
// Bruk:
//   const ok = await showConfirm({
//     title: 'Slette oppskrift?',
//     message: 'Dette kan ikke angres.',
//     confirmLabel: 'Slett',
//     destructive: true,
//   });
//   if (ok) { ... }
function showConfirm({
  title = 'Er du sikker?',
  message = '',
  confirmLabel = 'OK',
  cancelLabel = 'Avbryt',
  destructive = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    dialog.setAttribute('aria-describedby', 'confirm-msg');
    dialog.tabIndex = -1;

    const titleEl = document.createElement('h3');
    titleEl.id = 'confirm-title';
    titleEl.className = 'confirm-title';
    titleEl.textContent = String(title);

    const msgEl = document.createElement('p');
    msgEl.id = 'confirm-msg';
    msgEl.className = 'confirm-message';
    msgEl.textContent = String(message);

    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = destructive ? 'btn btn-danger' : 'btn btn-primary';
    confirmBtn.type = 'button';
    confirmBtn.textContent = confirmLabel;

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(titleEl);
    if (message) dialog.appendChild(msgEl);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Lagre forrige fokus så vi kan gjenopprette etter lukking
    const previousFocus = document.activeElement;

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKey, true);
      try { overlay.remove(); } catch {}
      try { if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus(); } catch {}
      resolve(result);
    };

    // Fokus-trap: hold Tab-navigering innenfor dialogen
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup(false);
        return;
      }
      if (ev.key === 'Enter' && document.activeElement === confirmBtn) {
        ev.preventDefault();
        cleanup(true);
        return;
      }
      if (ev.key === 'Tab') {
        const focusable = [cancelBtn, confirmBtn];
        const idx = focusable.indexOf(document.activeElement);
        if (idx === -1) {
          ev.preventDefault();
          focusable[0].focus();
          return;
        }
        ev.preventDefault();
        const next = ev.shiftKey
          ? focusable[(idx - 1 + focusable.length) % focusable.length]
          : focusable[(idx + 1) % focusable.length];
        next.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) cleanup(false);
    });
    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));

    // Flytt fokus til cancel som default (tryggest) med mindre destructive=false,
    // da fokuseres confirm-knappen for raskere "OK"-flyt.
    requestAnimationFrame(() => {
      (destructive ? cancelBtn : confirmBtn).focus();
    });
  });
}

