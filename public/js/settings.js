/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
// ===== FASE_F_BEGIN settings-view-js =====
/* -----------------------------------------------------
 * Fase F — SettingsView toggle, slide-transisjoner,
 * Escape-handler, swipe-handler, tittel-toggle, og
 * stub-rendering av de 5 seksjonene.
 * Ekte data fylles av F6 (env) og F7 (recipe-sources).
 * ----------------------------------------------------- */

let settingsOpen = false;
let lastTabBeforeSettings = null;

function onAppTitleClick() {
  if (settingsOpen) exitSettings();
  // Ellers: ingen effekt (kunne vært "go home" men vi holder oss til settings-bytte)
}

function toggleSettings() {
  if (settingsOpen) exitSettings();
  else enterSettings();
}

function enterSettings() {
  if (settingsOpen) return;
  settingsOpen = true;

  // Husk hvilken tab som var aktiv før — slik at vi kan returnere dit
  const activeTab = document.querySelector('.tab.active');
  lastTabBeforeSettings = activeTab ? activeTab.dataset.view : 'viewToday';

  // Animer ut den aktive viewen
  const currentView = document.querySelector('.view.active');
  if (currentView) {
    currentView.classList.add('slide-out-left');
    setTimeout(() => {
      currentView.classList.remove('active', 'slide-out-left');
    }, 220);
  }

  // Vis settings-view med slide-in
  const settingsView = document.getElementById('viewSettings');
  setTimeout(() => {
    settingsView.classList.add('active', 'slide-in-right');
    setTimeout(() => settingsView.classList.remove('slide-in-right'), 340);
  }, 80);

  // Header-oppdateringer
  document.getElementById('settingsBtn').classList.add('active');
  document.getElementById('appTitle').classList.add('back-mode');
  document.body.classList.add('settings-mode');

  // Last inn stub-innhold
  loadSettingsContent();

  // Stopp enrichment-polling siden vi forlater shopping-viewen
  if (typeof enrichmentPollTimer !== 'undefined' && enrichmentPollTimer) {
    clearTimeout(enrichmentPollTimer);
    enrichmentPollTimer = null;
  }
}

function exitSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;

  const settingsView = document.getElementById('viewSettings');
  settingsView.classList.add('slide-out-left');
  setTimeout(() => {
    settingsView.classList.remove('active', 'slide-out-left');
  }, 220);

  // Gjenopprett forrige tab
  const tabTarget = lastTabBeforeSettings || 'viewToday';
  const targetView = document.getElementById(tabTarget);
  if (targetView) {
    setTimeout(() => {
      targetView.classList.add('active', 'slide-in-right');
      setTimeout(() => targetView.classList.remove('slide-in-right'), 340);
      // Reload data for the tab vi vender tilbake til
      if (tabTarget === 'viewToday' && typeof loadToday === 'function') loadToday();
      if (tabTarget === 'viewMeals' && typeof loadMeals === 'function') loadMeals();
      if (tabTarget === 'viewShopping' && typeof loadShopping === 'function') loadShopping();
      if (tabTarget === 'viewChores' && typeof loadChores === 'function') loadChores();
    }, 80);
  }

  document.getElementById('settingsBtn').classList.remove('active');
  document.getElementById('appTitle').classList.remove('back-mode');
  document.body.classList.remove('settings-mode');
}

// Escape lukker
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOpen) {
    exitSettings();
  }
});

// Swipe fra venstre kant for å gå tilbake (mobil/touch)
(function initSettingsSwipe() {
  let startX = null;
  let startY = null;
  let tracking = false;
  const EDGE_ZONE = 20;
  const SWIPE_THRESHOLD = 50;
  const VERTICAL_TOLERANCE = 30;

  document.addEventListener('touchstart', (e) => {
    if (!settingsOpen) return;
    const t = e.touches[0];
    if (t.clientX <= EDGE_ZONE) {
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking || !settingsOpen) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    if (dx > SWIPE_THRESHOLD && dy < VERTICAL_TOLERANCE) {
      tracking = false;
      exitSettings();
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    tracking = false;
    startX = null;
    startY = null;
  }, { passive: true });
})();

// --- STUB-RENDERING av de 5 seksjonene ---
// F6/F7 erstatter disse med ekte data.
async function loadSettingsContent() {
  renderSettingsIntegrasjoner();
  renderSettingsLlm();
  renderSettingsKilder();
  renderSettingsProfil();
  renderSettingsOm();
}

function renderApiKeyField({ label, key, masked, help, testable }) {
  // key er hardkodet whitelist-navn; escapes uansett for defense-in-depth
  const id = `akf-${escapeHtml(key)}`;
  return `
    <div class="api-key-field">
      <label class="api-key-field-label" for="${id}">${escapeHtml(label)}</label>
      <div class="api-key-field-row">
        <input type="password" id="${id}" class="api-key-field-input"
               value="${escapeHtml(masked || '')}" placeholder="Ikke satt" data-env-key="${escapeHtml(key)}" autocomplete="off">
        <button type="button" class="api-key-field-btn" onclick="toggleApiKeyVisibility('${escapeHtml(id)}')">Vis</button>
        ${testable ? `<button type="button" class="api-key-field-btn btn-test" onclick="testIntegration('${escapeHtml(testable)}')">Test</button>` : ''}
      </div>
      <div class="api-key-status" id="${id}-status">${escapeHtml(help || '')}</div>
    </div>
  `;
}

function toggleApiKeyVisibility(id) {
  const input = document.getElementById(id);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    setTimeout(() => {
      if (input) input.type = 'password';
    }, 8000);
  } else {
    input.type = 'password';
  }
}

async function testIntegration(name) {
  const status = document.getElementById(`akf-${name.toUpperCase()}_API_KEY-status`)
             || document.getElementById(`akf-${name}-status`);
  if (status) {
    status.textContent = 'Tester…';
    status.className = 'api-key-status warn';
  }
  try {
    // F6 implementerer denne endepunkten — nå er det en stub
    const r = await fetch(`/api/integrations/${name}/test`, { method: 'POST' });
    if (r.ok) {
      const data = await r.json();
      if (status) {
        status.textContent = data.ok ? `✓ OK (${data.latencyMs} ms)` : `✗ ${data.error || 'Feilet'}`;
        status.className = data.ok ? 'api-key-status ok' : 'api-key-status err';
      }
    } else if (r.status === 404) {
      if (status) {
        status.textContent = 'Ikke implementert ennå (F6)';
        status.className = 'api-key-status warn';
      }
    }
  } catch (err) {
    if (status) {
      status.textContent = '✗ Nettverksfeil';
      status.className = 'api-key-status err';
    }
  }
}

function renderSettingsIntegrasjoner() {
  const body = document.getElementById('settingsIntegrasjonerBody');
  if (!body) return;
  body.innerHTML = `
    ${renderApiKeyField({
      label: 'Kassal.app',
      key: 'KASSAL_API_KEY',
      masked: '',
      help: 'Produktkatalog og prisdata',
      testable: 'kassal'
    })}
    <div class="panel-row" style="margin-top:12px">
      <span class="panel-row-label">Kilde</span>
      <span class="panel-row-value">.env på server</span>
    </div>
  `;
}

function renderSettingsLlm() {
  const body = document.getElementById('settingsLlmBody');
  if (!body) return;
  const motors = [
    { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY' },
    { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY' },
    { id: 'xai', name: 'xAI', key: 'XAI_API_KEY' },
    { id: 'ollama', name: 'Ollama', key: 'OLLAMA_URL' },
  ];
  body.innerHTML = `
    <div class="llm-motor-picker">
      ${motors.map(m => `
        <label class="llm-motor-option" data-motor="${m.id}">
          <input type="radio" name="llmMotor" value="${m.id}" onchange="onLlmMotorChange('${m.id}')">
          <span class="llm-motor-option-name">${m.name}</span>
        </label>
      `).join('')}
    </div>
    <div id="llmMotorKeyContainer"></div>
    <div class="api-key-status warn" style="margin-top:8px">⚠ Ingen motor valgt — LLM-funksjoner deaktivert</div>
  `;
}

function onLlmMotorChange(motorId) {
  document.querySelectorAll('.llm-motor-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.motor === motorId);
  });
  const container = document.getElementById('llmMotorKeyContainer');
  const keyMap = {
    anthropic: { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API-nøkkel', test: 'anthropic' },
    openai: { key: 'OPENAI_API_KEY', label: 'OpenAI API-nøkkel', test: 'openai' },
    xai: { key: 'XAI_API_KEY', label: 'xAI API-nøkkel', test: 'xai' },
    ollama: { key: 'OLLAMA_URL', label: 'Ollama URL', test: 'ollama' },
  };
  const m = keyMap[motorId];
  if (m && container) {
    container.innerHTML = renderApiKeyField({
      label: m.label, key: m.key, masked: '',
      help: motorId === 'ollama' ? 'f.eks. http://localhost:11434' : 'Lim inn nøkkel',
      testable: m.test,
    });
  }
}

async function renderSettingsKilder() {
  const body = document.getElementById('settingsKilderBody');
  if (!body) return;
  // Hent faktiske kilder fra /api/sources (F7 er implementert)
  let sources = [];
  try {
    const res = await fetch('/api/sources');
    if (res.ok) {
      const data = await res.json();
      sources = Array.isArray(data) ? data : (data.sources || []);
    }
  } catch { /* stille feil — vis tom liste */ }

  const iconFor = (type) => ({
    pinterest: '📌',
    godt: '🍳',
    rss: '📡',
    html: '🌐',
    unknown: '🌐',
  }[type] || '🌐');

  const rowsHtml = sources.length > 0
    ? sources.map(s => `
        <div class="recipe-source-row">
          <span class="recipe-source-icon">${iconFor(s.type)}</span>
          <div class="recipe-source-url">
            <div class="recipe-source-label">${escapeHtml(s.label || s.url)}</div>
            <div class="recipe-source-meta">${escapeHtml(s.type)} · ${s.lastSyncAt ? 'synket ' + escapeHtml(s.lastSyncAt) : 'ikke synket'}</div>
          </div>
          <button class="api-key-field-btn" onclick="syncRecipeSource(${Number(s.id)})" title="Synk nå">↻</button>
          <button class="api-key-field-btn" onclick="removeRecipeSource(${Number(s.id)})" title="Fjern">✕</button>
        </div>
      `).join('')
    : `
        <div class="recipe-source-row" style="opacity:0.6">
          <span class="recipe-source-icon">🌐</span>
          <div class="recipe-source-url">Ingen kilder lagt til ennå</div>
        </div>
      `;

  body.innerHTML = `
    <div id="recipeSourceList">${rowsHtml}</div>
    <div class="add-source-input">
      <input type="url" id="newSourceUrl" placeholder="https://pinterest.com/brukernavn/board">
      <button class="api-key-field-btn" onclick="addRecipeSource()">+ Legg til</button>
    </div>
    <div class="panel-row" style="margin-top:18px">
      <span class="panel-row-label">Eller direkte opplasting</span>
      <div style="display:flex;gap:6px">
        <button class="api-key-field-btn" onclick="openRecipeImportModal()">📄 Tekst/Bilde</button>
      </div>
    </div>
    <div class="api-key-status" style="margin-top:12px;color:var(--text2)">
      ℹ Connector-stubs for Pinterest/Godt/RSS — faktisk synk skjer i bakgrunnen hver 6. time
    </div>
  `;
}

async function syncRecipeSource(id) {
  try {
    await fetch(`/api/sources/${id}/sync`, { method: 'POST' });
    renderSettingsKilder();
  } catch { /* stille */ }
}

async function removeRecipeSource(id) {
  // Uke 4 (FE-8): erstatter native confirm() med showConfirm-dialog
  const ok = await showConfirm({
    title: 'Fjern oppskriftskilde?',
    message: 'Kilden blir fjernet. Allerede importerte oppskrifter beholdes.',
    confirmLabel: 'Fjern',
    destructive: true,
  });
  if (!ok) return;
  try {
    await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    showToast('Kilde fjernet', 'success');
    renderSettingsKilder();
  } catch (err) {
    showToast('Kunne ikke fjerne kilde', 'error');
  }
}

async function addRecipeSource() {
  const input = document.getElementById('newSourceUrl');
  if (!input || !input.value.trim()) return;
  try {
    const r = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.value.trim() }),
    });
    if (r.ok) {
      input.value = '';
      renderSettingsKilder();
    } else {
      const err = await r.json().catch(() => ({}));
      alert('Kunne ikke legge til kilde: ' + (err.error?.message || r.statusText));
    }
  } catch (err) {
    alert('Kunne ikke legge til kilde: ' + err.message);
  }
}

async function renderSettingsProfil() {
  const body = document.getElementById('settingsProfilBody');
  if (!body) return;
  let profile = { members: [], allergies: [], dislikes: [], preferences: {} };
  try {
    const r = await fetch('/api/profile');
    if (r.ok) profile = await r.json();
  } catch { /* stille feil */ }

  const renderTags = (arr, emptyText, fieldKey) => {
    if (!arr || arr.length === 0) {
      return `<span class="profile-tag" style="opacity:0.5">${escapeHtml(emptyText)}</span>`;
    }
    // Bruk data-attributter i stedet for inline onclick for å unngå XSS
    return arr.map(t => {
      return `<span class="profile-tag" data-action="remove-tag" data-field="${escapeHtml(fieldKey)}" data-value="${escapeHtml(String(t))}" title="Klikk for å fjerne">${escapeHtml(t)} ✕</span>`;
    }).join('');
  };

  body.innerHTML = `
    <div class="profile-editor-row">
      <div class="profile-editor-label">Medlemmer</div>
      <div class="profile-editor-value">
        <div class="profile-tag-list" id="profileMembersTags">${renderTags(profile.members, 'Ingen registrert', 'members')}</div>
        <div class="add-source-input" style="margin-top:8px">
          <input type="text" id="profileMembersInput" placeholder="Navn…">
          <button class="api-key-field-btn" onclick="addProfileTag('members')">+</button>
        </div>
      </div>
    </div>
    <div class="profile-editor-row">
      <div class="profile-editor-label">Allergier</div>
      <div class="profile-editor-value">
        <div class="profile-tag-list" id="profileAllergiesTags">${renderTags(profile.allergies, 'Ingen registrert', 'allergies')}</div>
        <div class="add-source-input" style="margin-top:8px">
          <input type="text" id="profileAllergiesInput" placeholder="f.eks. laktose">
          <button class="api-key-field-btn" onclick="addProfileTag('allergies')">+</button>
        </div>
      </div>
    </div>
    <div class="profile-editor-row">
      <div class="profile-editor-label">Mislikt</div>
      <div class="profile-editor-value">
        <div class="profile-tag-list" id="profileDislikesTags">${renderTags(profile.dislikes, 'Ingen registrert', 'dislikes')}</div>
        <div class="add-source-input" style="margin-top:8px">
          <input type="text" id="profileDislikesInput" placeholder="f.eks. sopp">
          <button class="api-key-field-btn" onclick="addProfileTag('dislikes')">+</button>
        </div>
      </div>
    </div>
    <div class="api-key-status ok" style="margin-top:12px">✓ Endringer lagres umiddelbart</div>
  `;
}

async function addProfileTag(field) {
  const inputMap = {
    members: 'profileMembersInput',
    allergies: 'profileAllergiesInput',
    dislikes: 'profileDislikesInput',
  };
  const input = document.getElementById(inputMap[field]);
  if (!input || !input.value.trim()) return;
  try {
    const current = await fetch('/api/profile').then(r => r.json());
    const arr = current[field] || [];
    if (!arr.includes(input.value.trim())) arr.push(input.value.trim());
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: arr }),
    });
    input.value = '';
    renderSettingsProfil();
  } catch (err) {
    alert('Kunne ikke lagre: ' + err.message);
  }
}

// Event delegation for profil-tagger (erstatter inline onclick — XSS-sikring)
document.addEventListener('click', (e) => {
  const tag = e.target.closest('[data-action="remove-tag"]');
  if (tag) {
    const field = tag.dataset.field;
    const value = tag.dataset.value;
    if (field && value) removeProfileTag(field, value);
  }
});

async function removeProfileTag(field, value) {
  try {
    const current = await fetch('/api/profile').then(r => r.json());
    const arr = (current[field] || []).filter(t => t !== value);
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: arr }),
    });
    renderSettingsProfil();
  } catch (err) {
    alert('Kunne ikke lagre: ' + err.message);
  }
}

async function renderSettingsOm() {
  const body = document.getElementById('settingsOmBody');
  if (!body) return;
  body.innerHTML = `
    <dl class="about-grid">
      <dt>Versjon</dt><dd id="aboutVersion">laster…</dd>
      <dt>Database</dt><dd id="aboutDb">laster…</dd>
      <dt>Migrasjoner</dt><dd id="aboutMigs">laster…</dd>
      <dt>Tester</dt><dd id="aboutTests">laster…</dd>
      <dt>Oppetid</dt><dd id="aboutUptime">–</dd>
    </dl>
  `;
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('status-endepunkt svarte ikke');
    const data = await res.json();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('aboutVersion', `${data.version} · ${data.phase}`);
    set('aboutDb', data.db || 'ukjent');
    set('aboutMigs', data.migrations || '–');
    set('aboutTests', data.tests ? `${data.tests} ✓` : '–');
    if (typeof data.uptime === 'number') {
      const h = Math.floor(data.uptime / 3600);
      const m = Math.floor((data.uptime % 3600) / 60);
      set('aboutUptime', h > 0 ? `${h}t ${m}m` : `${m} min`);
    }
  } catch (err) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('aboutVersion', '1.1.0 · Fase F');
    set('aboutDb', 'offline');
    set('aboutMigs', '–');
    set('aboutTests', '–');
  }
}
// ===== FASE_F_END settings-view-js =====

