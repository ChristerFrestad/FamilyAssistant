/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// ===== FASE_E_BEGIN shopping-pantry-recipe-import =====
// === HANDLETUR (Fase E) ===
// ============================================================================
// FASE E — JavaScript-tillegg til public/index.html
// Lim inn i <script>-blokka. Se kommentarer for anbefalt plassering.
// ============================================================================

// ============================================================================
// === HANDLETUR — ERSTATTER den eksisterende loadShopping/renderShopping ===
// ============================================================================

async function loadShopping() {
  // Ny rute: hent aktiv shopping_lists-row med items (inkl. pantry-items)
  const data = await api('/api/shopping/list/current');
  shoppingData = data;
  currentShoppingListId = data.id || null;
  currentWeek = data.weekYear;
  await renderShopping();
  // Start polling hvis enrichment ikke er ferdig
  scheduleEnrichmentPoll();
}

function scheduleEnrichmentPoll() {
  if (enrichmentPollTimer) clearTimeout(enrichmentPollTimer);
  const st = shoppingData?.enrichmentStatus;
  if (st === 'pending' || st === 'running') {
    enrichmentPollTimer = setTimeout(() => loadShopping(), 3000);
  }
}

function renderShopping() {
  const data = shoppingData;
  if (!data) return;

  let html = `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
    Handleliste — uke ${escapeHtml(String(data.weekYear || '').split('-W')[1] || '')}
  </div>`;

  // --- Segmentert toggle: Kjøpsliste / Pantry ---
  html += `
    <div class="segmented">
      <button class="${shoppingSubView === 'buy' ? 'active' : ''}" onclick="setShoppingSubView('buy')">
        🛒 Å kjøpe
      </button>
      <button class="${shoppingSubView === 'pantry' ? 'active' : ''}" onclick="setShoppingSubView('pantry')">
        🏠 Pantry
      </button>
    </div>
  `;

  if (shoppingSubView === 'pantry') {
    html += renderPantryInline();
    (function (el) {
      if (el) {
        el.innerHTML = html;
        el.setAttribute('aria-busy', 'false');
      }
    })(document.getElementById('shoppingContent'));
    loadPantry(); // async refresh
    return;
  }

  // --- Enrichment status banner ---
  html += renderEnrichmentBanner(data);

  // --- Eksisterende kategori-rendering med utvidelser ---
  for (const cat of data.categories || []) {
    html += `<div class="shop-category"><div class="shop-category-title">${escapeHtml(cat.category)}</div>`;
    for (const item of cat.items) {
      // Consumables uendret
      if (item.source === 'consumable') {
        html += renderConsumableItem(item); // behold eksisterende logikk
        continue;
      }
      // Pantry-linket recipe item → vis i kjøps-listen som "dekt av pantry"
      if (item.isPantry) {
        html += renderPantryLinkedItem(item);
        continue;
      }
      // Vanlige oppskrifts-items
      html += renderRecipeItem(item);
    }
    html += `</div>`;
  }

  // Total
  html += `<div class="total-price">Estimert totalpris: ~${Number(data.totalEstPrice) || 0} kr</div>`;

  // Legg til vare-skjema (uendret)
  html += renderAddItemForm();

  (function (el) {
    if (el) {
      el.innerHTML = html;
      el.setAttribute('aria-busy', 'false');
    }
  })(document.getElementById('shoppingContent'));
}

function renderEnrichmentBanner(data) {
  const st = data.enrichmentStatus || 'done';
  if (st === 'done') return ''; // ingen banner når alt er ok
  const labels = {
    pending: { text: 'Klargjør berikelse…', showRetry: false },
    running: { text: 'Beriker med Kassal-data…', showRetry: false },
    partial: { text: 'Noen varer mangler berikelse.', showRetry: true },
    failed: { text: 'Berikelse feilet.', showRetry: true },
  };
  const cfg = labels[st] || labels.failed;
  const retryBtn =
    cfg.showRetry && currentShoppingListId
      ? `<button class="enrich-retry" onclick="retryEnrichment()">Prøv igjen</button>`
      : '';
  return `
    <div class="enrich-banner status-${st}">
      <span class="enrich-dot"></span>
      <span class="enrich-text">${cfg.text}</span>
      ${retryBtn}
    </div>
  `;
}

async function retryEnrichment() {
  if (!currentShoppingListId) return;
  try {
    await api(`/api/shopping/list/${currentShoppingListId}/enrich`, { method: 'POST' });
    await loadShopping();
  } catch (err) {
    showToast('Kunne ikke starte berikelse på nytt.', 'error');
  }
}

function renderRecipeItem(item) {
  const checkedClass = item.checkedOff ? 'checked-off' : '';
  const displayName = item.ingredientNameNo || item.name || item.ingredientName;
  const showEnglish =
    item.ingredientName && item.ingredientNameNo && item.ingredientName !== item.ingredientNameNo;
  const itemId = Number(item.id);
  const unit = item.packUnit || item.unit || 'stk';

  // Kassal-match chip
  let kassalChip = '';
  if (item.kassalProductId) {
    const conf = item.resolutionConfidence || 0;
    const confClass =
      conf >= 0.7 ? 'confidence-high' : conf >= 0.4 ? 'confidence-med' : 'confidence-low';
    kassalChip = `<span class="kassal-chip ${confClass}">🎯 ${Math.round(conf * 100)}%</span>`;
  }

  let html = `<div class="shop-item ${checkedClass}">`;
  html += `<div style="flex:1">`;
  html += `<div class="shop-item-name">${escapeHtml(displayName)} ${kassalChip}</div>`;
  if (showEnglish)
    html += `<div class="shop-item-name-en">${escapeHtml(item.ingredientName)}</div>`;

  if (item.packSize) {
    html += `<div class="shop-item-detail">${escapeHtml(item.stillNeed)}${escapeHtml(item.packUnit)} trengs → ${escapeHtml(item.packCount)} pk à ${escapeHtml(item.packSize)}${escapeHtml(item.packUnit)}</div>`;
    if (item.hasHome > 0) {
      html += `<div class="shop-item-detail" style="color:var(--green)">Har ${escapeHtml(item.hasHome)}${escapeHtml(item.packUnit)} hjemme</div>`;
    }
  }
  if (item.dairyNote) html += `<div class="dairy-note">${escapeHtml(item.dairyNote)}</div>`;
  html += `</div>`; // end info col

  if (item.estPrice > 0)
    html += `<div class="shop-item-price">~${Number(item.estPrice) || 0} kr</div>`;

  if (itemId) {
    // Two-state toggle — grey "Kjøp" / green "✓ Kjøpt". Clicking the
    // green state calls /unbought so it acts as the undo affordance.
    const boughtClass = item.checkedOff ? 'btn-success' : 'btn-ghost';
    const boughtLabel = item.checkedOff ? '✓ Kjøpt' : 'Kjøp';
    html += `<button class="btn ${boughtClass} btn-small" style="margin-left:8px"
      onclick="toggleBought(${itemId}, ${item.checkedOff ? 1 : 0})"
      title="${item.checkedOff ? 'Klikk for å angre kjøp' : 'Marker som kjøpt'}">${boughtLabel}</button>`;

    if (item.checkedOff) {
      // PR A.2 — only meaningful once the item has been bought. Opens a
      // one-field inline date picker that records an expiry for
      // shelf-life learning. Optional — skipping is fine.
      html += `<button class="btn btn-ghost btn-small" style="margin-left:6px"
        onclick="openExpiryForm(${itemId})" title="Sett utløpsdato for læring">📅 Utløpsdato</button>`;
    } else {
      // "Har hjemme" — tops up pantry qty without marking the row bought.
      html += `<button class="btn btn-ghost btn-small" style="margin-left:6px"
        onclick="openHasHomeForm(${itemId})" title="Jeg har denne varen hjemme allerede">🏠 Har hjemme</button>`;
    }

    // Trash — permanently deletes the row from the active shopping list.
    html += `<button class="btn btn-ghost btn-small" style="margin-left:6px"
      onclick="deleteShoppingItem(${itemId})" title="Slett vare helt">🗑</button>`;
  }
  html += `</div>`;

  // Inline panels. Both toggle display:none/flex from JS — see A.2 hotfix.
  if (itemId) {
    html += renderHasHomeForm(itemId, unit);
    if (item.checkedOff) html += renderExpiryForm(itemId);
  }
  return html;
}

function renderExpiryForm(itemId) {
  // Panel is hidden by default (display:none). openExpiryForm() toggles it
  // to flex. Keeping inline style to match the rest of the shopping UI.
  return `
    <div class="expiry-form" id="expiry-${itemId}"
         style="display:none;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;padding:8px;background:var(--bg2);border-radius:8px">
      <span style="color:var(--text2);font-size:0.85rem">Utløpsdato:</span>
      <input type="date" id="expiry-date-${itemId}"
             style="padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font:inherit"
             onkeydown="if(event.key==='Enter'){submitExpiry(${itemId})}">
      <button class="btn btn-primary btn-small" onclick="submitExpiry(${itemId})">Lagre</button>
      <button class="btn btn-ghost btn-small" onclick="cancelExpiry(${itemId})">Avbryt</button>
    </div>`;
}

function renderHasHomeForm(itemId, unit) {
  const unitLabel = escapeHtml(unit || 'stk');
  // display:none by default. openHasHomeForm() toggles to display:flex on
  // demand. Using inline style instead of the HTML `hidden` attribute because
  // the `hidden` attribute is overridden by any `display:*` in the style
  // attribute, which silently left this panel visible at all times.
  return `
    <div class="has-home-form" id="has-home-${itemId}"
         style="display:none;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;padding:8px;background:var(--bg2);border-radius:8px">
      <input type="number" min="0" step="0.1" id="has-home-qty-${itemId}"
             placeholder="Antall"
             style="width:90px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font:inherit"
             onkeydown="if(event.key==='Enter'){submitHasHome(${itemId})}">
      <span style="color:var(--text2);font-size:0.85rem">${unitLabel}</span>
      <input type="date" id="has-home-date-${itemId}"
             title="Kjøpsdato (valgfri)"
             style="padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font:inherit">
      <button class="btn btn-primary btn-small" onclick="submitHasHome(${itemId})">Lagre</button>
      <button class="btn btn-ghost btn-small" onclick="cancelHasHome(${itemId})">Avbryt</button>
    </div>`;
}

function renderPantryLinkedItem(item) {
  const displayName = item.ingredientNameNo || item.ingredientName || item.name;
  return `
    <div class="shop-item is-pantry">
      <div style="flex:1">
        <div class="shop-item-name">${escapeHtml(displayName)}</div>
        <span class="pantry-flag">🏠 I pantry — har nok hjemme</span>
      </div>
      <button class="btn btn-ghost btn-small" onclick="unpantryItem(${Number(item.id)})" title="Flytt tilbake til kjøpsliste">
        ↩ Trenger likevel
      </button>
    </div>
  `;
}

function renderConsumableItem(item) {
  // Uendret fra eksisterende kode — flyttet ut i egen funksjon for lesbarhet
  let html = `<div class="consumable-item">`;
  html += `<div class="consumable-header">`;
  html += `<div><div class="consumable-name">${escapeHtml(item.name)}</div>`;
  if (item.packSize)
    html += `<div style="font-size:0.75rem;color:var(--text2)">${escapeHtml(item.packCount || 1)} pk à ${escapeHtml(item.packSize)} ${escapeHtml(item.packUnit || 'stk')}</div>`;
  html += `</div>`;
  if (item.estPrice > 0)
    html += `<div class="consumable-price">~${Number(item.estPrice) || 0} kr</div>`;
  html += `</div>`;
  html += `<div class="consumable-meta">`;
  if (item.depletionInfo) html += `<span>Forbruk: ${escapeHtml(item.depletionInfo)}</span>`;
  if (item.store) html += `<span class="store-tag">📍 ${escapeHtml(item.store)}</span>`;
  html += `</div>`;
  if (item.daysLeft !== undefined && item.daysLeft !== null) {
    const dClass =
      item.daysLeft <= 0 ? 'days-urgent' : item.daysLeft <= 3 ? 'days-warn' : 'days-ok';
    const dText =
      item.daysLeft <= 0 ? 'TOM — kjøp nå!' : `~${Number(item.daysLeft) || 0} dager igjen`;
    html += `<div class="consumable-days-left ${dClass}">${escapeHtml(dText)}</div>`;
  }
  if (item.notes) html += `<div class="consumable-notes">${escapeHtml(item.notes)}</div>`;
  html += `<div class="consumable-actions">`;
  html += `<button class="btn btn-success btn-small" onclick="markConsumableBought(${Number(item.consumableId)})">✓ Kjøpt</button>`;
  html += `<button class="btn btn-ghost btn-small" onclick="toggleConsumableAuto(${Number(item.consumableId)})">Auto av/på</button>`;
  html += `</div></div>`;
  return html;
}

function renderAddItemForm() {
  return `
    <div class="card" style="margin-top:16px">
      <div class="card-title">Legg til vare</div>
      <div class="input-row">
        <input type="text" id="addItemInput" aria-label="Nytt varenavn" placeholder="Varenavn (f.eks. Saft, Bleier...)">
        <button class="btn btn-primary" onclick="addShoppingItem()">Legg til</button>
      </div>
      <select id="addItemCategory" aria-label="Kategori for ny vare" style="margin-top:8px;padding:8px;border-radius:8px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);width:100%;font-family:inherit">
        <option value="Kjøtt & fisk">Kjøtt & fisk</option>
        <option value="Meieri">Meieri</option>
        <option value="Frukt & grønt">Frukt & grønt</option>
        <option value="Brød & bakst">Brød & bakst</option>
        <option value="Tørrvarer & annet" selected>Tørrvarer & annet</option>
        <option value="Drikkevarer">Drikkevarer</option>
        <option value="Husholdning">Husholdning</option>
        <option value="Barn">Barn</option>
        <option value="Personlig pleie">Personlig pleie</option>
      </select>
    </div>
  `;
}

function setShoppingSubView(view) {
  shoppingSubView = view;
  renderShopping();
}

// --- Handlers for bought / unpantry / delete ---

// Reload both shopping and pantry after any mutation — they share state
// (marking Kjøpt updates pantry qty, editing pantry flips shopping
// pantry_has flags). loadPantry() no-ops gracefully if the pantry sub-
// view isn't rendered, so calling it from shopping context is safe.
async function refreshShoppingAndPantry() {
  await loadShopping();
  if (typeof loadPantry === 'function') {
    try {
      await loadPantry();
    } catch {
      /* pantry tab may not be mounted yet — ignore */
    }
  }
}

// Toggle button: grey "Kjøp" -> green "✓ Kjøpt" (mark), green -> grey (undo).
// The row stays on the list either way; .checked-off class dims it.
async function toggleBought(itemId, isCurrentlyBought) {
  const endpoint = isCurrentlyBought
    ? `/api/shopping/items/${itemId}/unbought`
    : `/api/shopping/items/${itemId}/bought`;
  try {
    await api(endpoint, { method: 'PUT' });
    await refreshShoppingAndPantry();
  } catch (err) {
    const verb = isCurrentlyBought ? 'angre kjøp' : 'markere som kjøpt';
    showToast(`Kunne ikke ${verb}: ` + (err.message || err), 'error');
  }
}

// Back-compat: some callers (e.g. e2e tests) still use the old name.
async function markItemBought(itemId) {
  return toggleBought(itemId, 0);
}

async function deleteShoppingItem(itemId) {
  const go = await (typeof showConfirm === 'function'
    ? showConfirm('Slett varen fra denne handlelisten?', {
        confirmLabel: 'Slett',
        cancelLabel: 'Avbryt',
        destructive: true,
      })
    : Promise.resolve(confirm('Slett varen fra denne handlelisten?')));
  if (!go) return;
  try {
    await api(`/api/shopping/items/${itemId}`, { method: 'DELETE' });
    await refreshShoppingAndPantry();
  } catch (err) {
    showToast('Kunne ikke slette: ' + (err.message || err), 'error');
  }
}

async function unpantryItem(itemId) {
  try {
    await api(`/api/shopping/items/${itemId}/unpantry`, { method: 'PUT' });
    await refreshShoppingAndPantry();
  } catch (err) {
    showToast('Kunne ikke flytte tilbake: ' + (err.message || err), 'error');
  }
}

// "Har hjemme" — inline panel replaces the two legacy prompt() calls.
// User types qty + picks optional purchase date; panel sits right under
// the row and is keyboard-accessible (Enter submits).
function openHasHomeForm(itemId) {
  const form = document.getElementById(`has-home-${itemId}`);
  if (!form) return;
  const isOpen = form.style.display === 'flex';
  // Close all other open panels so the layout stays clean.
  document.querySelectorAll('.has-home-form').forEach((el) => {
    if (el !== form) el.style.display = 'none';
  });
  form.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    const qtyInput = document.getElementById(`has-home-qty-${itemId}`);
    if (qtyInput) {
      qtyInput.value = '';
      qtyInput.focus();
    }
    const dateInput = document.getElementById(`has-home-date-${itemId}`);
    if (dateInput) dateInput.value = '';
  }
}

function cancelHasHome(itemId) {
  const form = document.getElementById(`has-home-${itemId}`);
  if (form) form.style.display = 'none';
}

async function submitHasHome(itemId) {
  const qtyInput = document.getElementById(`has-home-qty-${itemId}`);
  const dateInput = document.getElementById(`has-home-date-${itemId}`);
  if (!qtyInput) return;
  const qty = Number(qtyInput.value);
  if (!Number.isFinite(qty) || qty <= 0) {
    showToast('Skriv inn antall større enn 0', 'warn');
    qtyInput.focus();
    return;
  }
  const body = { qty };
  const dateStr = (dateInput && dateInput.value) || '';
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    body.purchasedAt = dateStr;
  }
  try {
    await api(`/api/shopping/items/${itemId}/has-home`, { method: 'PUT', body });
    cancelHasHome(itemId);
    showToast('Pantry oppdatert', 'success');
    await refreshShoppingAndPantry();
  } catch (err) {
    showToast('Kunne ikke oppdatere pantry: ' + (err.message || err), 'error');
  }
}

// Back-compat with the old name — delegate to the new inline flow.
function markItemHasHome(itemId) {
  openHasHomeForm(itemId);
}

// PR A.2 — shelf-life learning. Expiry panel appears only on bought rows.
function openExpiryForm(itemId) {
  const form = document.getElementById(`expiry-${itemId}`);
  if (!form) return;
  const isOpen = form.style.display === 'flex';
  document.querySelectorAll('.expiry-form').forEach((el) => {
    if (el !== form) el.style.display = 'none';
  });
  form.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) {
    const dateInput = document.getElementById(`expiry-date-${itemId}`);
    if (dateInput) {
      dateInput.value = '';
      dateInput.focus();
    }
  }
}

function cancelExpiry(itemId) {
  const form = document.getElementById(`expiry-${itemId}`);
  if (form) form.style.display = 'none';
}

async function submitExpiry(itemId) {
  const dateInput = document.getElementById(`expiry-date-${itemId}`);
  const dateStr = (dateInput && dateInput.value) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    showToast('Velg en gyldig utløpsdato', 'warn');
    return;
  }
  try {
    await api(`/api/shopping/items/${itemId}/expiry`, {
      method: 'POST',
      body: { expiresAt: dateStr },
    });
    cancelExpiry(itemId);
    showToast('Utløpsdato lagret — læringssnitt oppdatert', 'success');
    await refreshShoppingAndPantry();
  } catch (err) {
    showToast('Kunne ikke lagre utløpsdato: ' + (err.message || err), 'error');
  }
}

// === Fix: addShoppingItem — tidligere referert i renderAddItemForm uten å
// være definert. Uke 4 FE-bugfix. Leser #addItemInput + #addItemCategory
// fra skjemaet som renderAddItemForm() rendrer og poster til /api/shopping/add.
async function addShoppingItem() {
  const input = document.getElementById('addItemInput');
  const select = document.getElementById('addItemCategory');
  if (!input) return;
  const name = (input.value || '').trim();
  if (!name) {
    showToast('Skriv et varenavn først', 'warn');
    input.focus();
    return;
  }
  const body = { name };
  if (select && select.value) body.category = select.value;
  try {
    await api('/api/shopping/add', { method: 'POST', body });
    input.value = '';
    showToast(`"${name}" lagt til i handlelisten`, 'success');
    await loadShopping();
  } catch (err) {
    showToast('Kunne ikke legge til: ' + (err.message || err), 'error');
  }
}
