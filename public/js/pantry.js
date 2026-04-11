/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
// ============================================================================
// === PANTRY (vises som sub-view av Handletur) ===
// ============================================================================

async function loadPantry() {
  try {
    pantryData = await api('/api/pantry');
    // Re-render kun pantry-seksjonen
    const container = document.getElementById('pantryInlineContent');
    if (container) container.innerHTML = renderPantryList();
  } catch (err) {
    const container = document.getElementById('pantryInlineContent');
    if (container) container.innerHTML = `<div class="pantry-empty">Kunne ikke laste pantry</div>`;
  }
}

function renderPantryInline() {
  return `
    <div class="card card-pantry-combobox">
      <div class="card-title">Legg til i beholdningen</div>
      <div class="pantry-combobox-wrap">
        <input type="text" id="pantryComboInput"
               placeholder="Søk etter vare…"
               autocomplete="off"
               oninput="onPantryComboInput(event)"
               onkeydown="onPantryComboKeydown(event)"
               onfocus="onPantryComboInput(event)"
               onblur="onPantryComboBlur(event)">
        <div class="pantry-combobox-results hidden" id="pantryComboResults"></div>
      </div>
      <div class="pantry-combobox-qty-row" id="pantryQtyRow" style="display:none;margin-top:12px;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="number" id="pantryQtyInput" placeholder="Mengde" style="max-width:100px" min="0" step="0.01" value="1">
        <span style="color:var(--text2);font-size:0.85rem">av</span>
        <input type="number" id="pantryTotalInput" placeholder="Total" style="max-width:100px" min="0" step="0.01">
        <select id="pantryUnitInput" style="max-width:90px">
          <option value="stk">stk</option>
          <option value="g">g</option>
          <option value="kg">kg</option>
          <option value="ml">ml</option>
          <option value="dl">dl</option>
          <option value="l">l</option>
        </select>
        <button class="btn btn-primary" onclick="confirmAddPantry()">Lagre</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Du har hjemme</div>
      <div id="pantryInlineContent">
        <div class="pantry-empty">Laster…</div>
      </div>
    </div>
  `;
}

// === Fase F1 — Pantry combobox-handlers ===
let pantryComboSuggestions = [];
let pantryComboSelectedIdx = -1;
let pantryComboChosen = null;
let pantryComboDebounceTimer = null;

async function onPantryComboInput(ev) {
  const val = ev.target.value.trim();
  const results = document.getElementById('pantryComboResults');
  if (val.length < 1) {
    if (results) results.classList.add('hidden');
    return;
  }
  if (pantryComboDebounceTimer) clearTimeout(pantryComboDebounceTimer);
  pantryComboDebounceTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/pantry/suggest?q=${encodeURIComponent(val)}`);
      if (!r.ok) return;
      const data = await r.json();
      pantryComboSuggestions = data.suggestions || [];
      pantryComboSelectedIdx = -1;
      renderPantryComboResults();
    } catch (err) {
      // Stille feil
    }
  }, 220);
}

function renderPantryComboResults() {
  const results = document.getElementById('pantryComboResults');
  if (!results) return;
  if (pantryComboSuggestions.length === 0) {
    results.classList.add('hidden');
    return;
  }
  results.classList.remove('hidden');
  results.innerHTML = pantryComboSuggestions.map((s, i) => {
    const badge = s.source === 'kassal' ? '<span class="combo-badge combo-badge-kassal">✓ Kassal</span>'
                : s.source === 'lokal'  ? '<span class="combo-badge combo-badge-lokal">• Lokal</span>'
                :                          '<span class="combo-badge combo-badge-ny">+ Ny vare</span>';
    const meta = s.frequency ? `<span class="combo-meta">brukt ${Number(s.frequency) || 0}×</span>` : '';
    const selectedClass = i === pantryComboSelectedIdx ? ' selected' : '';
    return `
      <div class="combo-row${selectedClass}" onmousedown="selectPantryCombo(${i})">
        <div class="combo-row-main">
          <span class="combo-name">${escapeHtml(s.name)}</span>
          ${badge}
        </div>
        ${meta}
      </div>
    `;
  }).join('');
}

// (escapeHtml defineres øverst i scriptet — M1.1 XSS-hardening)

function onPantryComboKeydown(ev) {
  if (!pantryComboSuggestions.length) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    pantryComboSelectedIdx = Math.min(pantryComboSelectedIdx + 1, pantryComboSuggestions.length - 1);
    renderPantryComboResults();
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    pantryComboSelectedIdx = Math.max(pantryComboSelectedIdx - 1, 0);
    renderPantryComboResults();
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    if (pantryComboSelectedIdx >= 0) {
      selectPantryCombo(pantryComboSelectedIdx);
    } else if (pantryComboSuggestions[0]) {
      selectPantryCombo(0);
    }
  } else if (ev.key === 'Escape') {
    document.getElementById('pantryComboResults').classList.add('hidden');
  }
}

function onPantryComboBlur() {
  // Liten delay så klikk på resultat rekker å registreres
  setTimeout(() => {
    const results = document.getElementById('pantryComboResults');
    if (results) results.classList.add('hidden');
  }, 180);
}

function selectPantryCombo(idx) {
  const sug = pantryComboSuggestions[idx];
  if (!sug) return;
  pantryComboChosen = sug;
  const input = document.getElementById('pantryComboInput');
  if (input) input.value = sug.name;
  const results = document.getElementById('pantryComboResults');
  if (results) results.classList.add('hidden');
  // Vis qty-rad nå som vara er valgt
  const qtyRow = document.getElementById('pantryQtyRow');
  if (qtyRow) qtyRow.style.display = 'flex';
  // Preset unit hvis kjent
  if (sug.unit) {
    const unitEl = document.getElementById('pantryUnitInput');
    if (unitEl) unitEl.value = sug.unit;
  }
  if (sug.packSize) {
    const totalEl = document.getElementById('pantryTotalInput');
    if (totalEl && !totalEl.value) totalEl.value = sug.packSize;
  }
  // Fokusér på qty
  const qty = document.getElementById('pantryQtyInput');
  if (qty) qty.focus();
}

async function confirmAddPantry() {
  const input = document.getElementById('pantryComboInput');
  const qtyEl = document.getElementById('pantryQtyInput');
  const totalEl = document.getElementById('pantryTotalInput');
  const unitEl = document.getElementById('pantryUnitInput');
  if (!input || !input.value.trim()) return;

  const body = {
    qty: parseFloat(qtyEl.value) || 1,
    unit: unitEl.value || 'stk',
    reason: 'manual',
  };
  if (totalEl.value) body.total = parseFloat(totalEl.value);
  if (pantryComboChosen && pantryComboChosen.productKey && pantryComboChosen.source !== 'ny') {
    body.productKey = pantryComboChosen.productKey;
  } else {
    body.query = input.value.trim();
  }

  try {
    await api('/api/pantry/add', { method: 'POST', body });
    // Reset
    input.value = '';
    qtyEl.value = '1';
    totalEl.value = '';
    unitEl.value = 'stk';
    pantryComboChosen = null;
    document.getElementById('pantryQtyRow').style.display = 'none';
    await loadPantry();
  } catch (err) {
    alert('Kunne ikke legge til: ' + (err.message || err));
  }
}

function renderPantryList() {
  const items = pantryData?.items || [];
  if (items.length === 0) {
    return `<div class="pantry-empty">Ingen varer i pantry ennå.<br>Legg til med skjemaet over.</div>`;
  }
  let html = '';
  for (const it of items) {
    const name = it.ingredientNameNo || it.ingredientName || it.name;
    const pk = encodeURIComponent(it.productKey || ''); // trygg for attributtet
    // Fase F2: progress-bar hvis total er satt
    let progressHtml = '';
    let qtyLabel = `${escapeHtml(it.quantity || 1)} ${escapeHtml(it.unit || 'stk')}`;
    if (it.total && it.ratio !== null && typeof it.ratio !== 'undefined') {
      const pct = Math.max(0, Math.min(100, Math.round(Number(it.ratio) * 100) || 0));
      const lowClass = it.isLow ? 'low' : (it.ratio < 0.4 ? 'medium' : 'high');
      progressHtml = `
        <div class="pantry-progress-wrap">
          <div class="pantry-progress">
            <div class="pantry-progress-fill ${lowClass}" style="width:${pct}%"></div>
          </div>
        </div>
      `;
      qtyLabel = `${escapeHtml(it.quantity)} ${escapeHtml(it.unit)} <span class="pantry-qty-of">/ ${escapeHtml(it.total)} ${escapeHtml(it.unit)}</span>`;
    }
    html += `
      <div class="pantry-item${it.isLow ? ' is-low' : ''}">
        ${progressHtml}
        <div class="pantry-item-main">
          <div class="pantry-item-name">${escapeHtml(name)}${it.isLow ? ' <span class="pantry-low-badge">⚠ lav</span>' : ''}</div>
          <div class="pantry-item-qty">${qtyLabel}</div>
        </div>
        <button class="btn btn-ghost btn-small" onclick="removeFromPantry('${pk}')" title="Har ikke likevel">
          ✗
        </button>
      </div>
    `;
  }
  return html;
}

// Fase F1: klient-side slugify er fjernet. Server resolver kanonisk productKey
// via /api/pantry/suggest og /api/pantry/add (query-basert).
// Gammel addToPantry() er erstattet av confirmAddPantry() — se Fase F1-combobox.

async function removeFromPantry(productKey) {
  if (!productKey) return;
  // Uke 4 (FE-8): confirm før destructive
  const decodedKey = decodeURIComponent(productKey);
  const item = pantryData?.items?.find((i) => i.productKey === decodedKey);
  const name = item ? (item.ingredientNameNo || item.ingredientName || item.name) : decodedKey;
  const ok = await showConfirm({
    title: 'Fjerne fra pantry?',
    message: `"${name}" blir fjernet fra det du har hjemme.`,
    confirmLabel: 'Fjern',
    destructive: true,
  });
  if (!ok) return;
  try {
    await api(`/api/pantry/${productKey}`, { method: 'DELETE' });
    showToast('Fjernet fra pantry', 'success');
    await loadPantry();
  } catch (err) {
    showToast('Kunne ikke fjerne: ' + (err.message || err), 'error');
  }
}

