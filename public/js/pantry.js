/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
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
        <input type="date" id="pantryDateInput" title="Kjøpsdato (valgfri)" style="max-width:150px">
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
  results.innerHTML = pantryComboSuggestions
    .map((s, i) => {
      const badge =
        s.source === 'kassal'
          ? '<span class="combo-badge combo-badge-kassal">✓ Kassal</span>'
          : s.source === 'lokal'
            ? '<span class="combo-badge combo-badge-lokal">• Lokal</span>'
            : '<span class="combo-badge combo-badge-ny">+ Ny vare</span>';
      const meta = s.frequency
        ? `<span class="combo-meta">brukt ${Number(s.frequency) || 0}×</span>`
        : '';
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
    })
    .join('');
}

// (escapeHtml defineres øverst i scriptet — M1.1 XSS-hardening)

function onPantryComboKeydown(ev) {
  if (!pantryComboSuggestions.length) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    pantryComboSelectedIdx = Math.min(
      pantryComboSelectedIdx + 1,
      pantryComboSuggestions.length - 1
    );
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
  const dateEl = document.getElementById('pantryDateInput');
  if (!input || !input.value.trim()) return;

  const body = {
    qty: parseFloat(qtyEl.value) || 1,
    unit: unitEl.value || 'stk',
    reason: 'manual',
  };
  if (totalEl.value) body.total = parseFloat(totalEl.value);
  // Optional purchase date — server defaults to today if absent.
  if (dateEl && dateEl.value && /^\d{4}-\d{2}-\d{2}$/.test(dateEl.value)) {
    body.purchasedAt = dateEl.value;
  }
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
    if (dateEl) dateEl.value = '';
    pantryComboChosen = null;
    document.getElementById('pantryQtyRow').style.display = 'none';
    await loadPantry();
  } catch (err) {
    showToast('Kunne ikke legge til: ' + (err.message || err), 'error');
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
      const lowClass = it.isLow ? 'low' : it.ratio < 0.4 ? 'medium' : 'high';
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
        <button class="btn btn-ghost btn-small" data-action="edit-pantry"
                data-key="${escapeHtml(it.productKey)}"
                data-qty="${escapeHtml(String(it.quantity || ''))}"
                data-total="${escapeHtml(String(it.total || ''))}"
                data-unit="${escapeHtml(it.unit || 'stk')}"
                title="Rediger mengde / enhet">
          ✏
        </button>
        <button class="btn btn-ghost btn-small" data-action="remove-pantry" data-key="${escapeHtml(it.productKey)}" title="Har ikke likevel">
          ✗
        </button>
      </div>
      <div class="pantry-edit-form" id="pantry-edit-${escapeHtml(it.productKey)}" hidden
           style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 10px 8px;padding:8px;background:var(--bg2);border-radius:8px">
        <input type="number" class="pantry-edit-qty" placeholder="Mengde" style="max-width:100px" min="0" step="0.01">
        <span style="color:var(--text2);font-size:0.85rem">av</span>
        <input type="number" class="pantry-edit-total" placeholder="Total" style="max-width:100px" min="0" step="0.01">
        <select class="pantry-edit-unit" style="max-width:90px">
          <option value="stk">stk</option>
          <option value="g">g</option>
          <option value="kg">kg</option>
          <option value="ml">ml</option>
          <option value="dl">dl</option>
          <option value="l">l</option>
        </select>
        <input type="date" class="pantry-edit-date" title="Kjøpsdato (valgfri)" style="max-width:150px">
        <button class="btn btn-primary btn-small" data-action="save-pantry-edit" data-key="${escapeHtml(it.productKey)}">Lagre</button>
        <button class="btn btn-ghost btn-small" data-action="cancel-pantry-edit" data-key="${escapeHtml(it.productKey)}">Avbryt</button>
      </div>
    `;
  }
  return html;
}

// Fase F1: klient-side slugify er fjernet. Server resolver kanonisk productKey
// via /api/pantry/suggest og /api/pantry/add (query-basert).
// Gammel addToPantry() er erstattet av confirmAddPantry() — se Fase F1-combobox.

// Event delegation for pantry-knapper (unngår inline onclick med XSS-risiko)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const key = btn.dataset.key;
  if (action === 'remove-pantry' && key) {
    removeFromPantry(key);
    return;
  }
  if (action === 'edit-pantry' && key) {
    openPantryEdit(btn);
    return;
  }
  if (action === 'cancel-pantry-edit' && key) {
    closePantryEdit(key);
    return;
  }
  if (action === 'save-pantry-edit' && key) {
    submitPantryEdit(key);
    return;
  }
});

function openPantryEdit(triggerBtn) {
  const key = triggerBtn.dataset.key;
  if (!key) return;
  const form = document.getElementById(`pantry-edit-${key}`);
  if (!form) return;
  document.querySelectorAll('.pantry-edit-form').forEach((el) => {
    if (el !== form) el.hidden = true;
  });
  form.hidden = !form.hidden;
  if (!form.hidden) {
    const qtyInput = form.querySelector('.pantry-edit-qty');
    const totalInput = form.querySelector('.pantry-edit-total');
    const unitSelect = form.querySelector('.pantry-edit-unit');
    if (qtyInput) qtyInput.value = triggerBtn.dataset.qty || '';
    if (totalInput) totalInput.value = triggerBtn.dataset.total || '';
    if (unitSelect) unitSelect.value = triggerBtn.dataset.unit || 'stk';
    if (qtyInput) qtyInput.focus();
  }
}

function closePantryEdit(key) {
  const form = document.getElementById(`pantry-edit-${key}`);
  if (form) form.hidden = true;
}

async function submitPantryEdit(productKey) {
  const form = document.getElementById(`pantry-edit-${productKey}`);
  if (!form) return;
  const qty = Number(form.querySelector('.pantry-edit-qty')?.value);
  if (!Number.isFinite(qty) || qty < 0) {
    showToast('Ugyldig mengde', 'warn');
    return;
  }
  const body = { productKey, newQty: qty };
  const totalVal = form.querySelector('.pantry-edit-total')?.value;
  if (totalVal && Number(totalVal) > 0) body.newTotal = Number(totalVal);
  const unitVal = form.querySelector('.pantry-edit-unit')?.value;
  if (unitVal) body.newUnit = unitVal;
  const dateVal = form.querySelector('.pantry-edit-date')?.value;
  if (dateVal && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) body.purchasedAt = dateVal;
  try {
    await api('/api/pantry/correct', { method: 'PUT', body });
    closePantryEdit(productKey);
    showToast('Pantry oppdatert', 'success');
    await loadPantry();
  } catch (err) {
    showToast('Kunne ikke oppdatere: ' + (err.message || err), 'error');
  }
}

async function removeFromPantry(productKey) {
  if (!productKey) return;
  // Uke 4 (FE-8): confirm før destructive
  const item = pantryData?.items?.find((i) => i.productKey === productKey);
  const name = item ? item.ingredientNameNo || item.ingredientName || item.name : productKey;
  const ok = await showConfirm({
    title: 'Fjerne fra pantry?',
    message: `"${name}" blir fjernet fra det du har hjemme.`,
    confirmLabel: 'Fjern',
    destructive: true,
  });
  if (!ok) return;
  try {
    await api(`/api/pantry/${encodeURIComponent(productKey)}`, { method: 'DELETE' });
    showToast('Fjernet fra pantry', 'success');
    await loadPantry();
  } catch (err) {
    showToast('Kunne ikke fjerne: ' + (err.message || err), 'error');
  }
}
