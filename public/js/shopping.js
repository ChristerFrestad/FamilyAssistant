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
    (function(el){ if(el){ el.innerHTML = html; el.setAttribute('aria-busy', 'false'); } })(document.getElementById('shoppingContent'));
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

  (function(el){ if(el){ el.innerHTML = html; el.setAttribute('aria-busy', 'false'); } })(document.getElementById('shoppingContent'));
}

function renderEnrichmentBanner(data) {
  const st = data.enrichmentStatus || 'done';
  if (st === 'done') return ''; // ingen banner når alt er ok
  const labels = {
    pending: { text: 'Klargjør berikelse…', showRetry: false },
    running: { text: 'Beriker med Kassal-data…', showRetry: false },
    partial: { text: 'Noen varer mangler berikelse.', showRetry: true },
    failed:  { text: 'Berikelse feilet.', showRetry: true },
  };
  const cfg = labels[st] || labels.failed;
  const retryBtn = cfg.showRetry && currentShoppingListId
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
  const showEnglish = item.ingredientName && item.ingredientNameNo &&
                      item.ingredientName !== item.ingredientNameNo;

  // Kassal-match chip
  let kassalChip = '';
  if (item.kassalProductId) {
    const conf = item.resolutionConfidence || 0;
    const confClass = conf >= 0.7 ? 'confidence-high'
                    : conf >= 0.4 ? 'confidence-med' : 'confidence-low';
    kassalChip = `<span class="kassal-chip ${confClass}">🎯 ${Math.round(conf*100)}%</span>`;
  }

  let html = `<div class="shop-item ${checkedClass}">`;
  html += `<div style="flex:1">`;
  html += `<div class="shop-item-name">${escapeHtml(displayName)} ${kassalChip}</div>`;
  if (showEnglish) html += `<div class="shop-item-name-en">${escapeHtml(item.ingredientName)}</div>`;

  if (item.packSize) {
    html += `<div class="shop-item-detail">${escapeHtml(item.stillNeed)}${escapeHtml(item.packUnit)} trengs → ${escapeHtml(item.packCount)} pk à ${escapeHtml(item.packSize)}${escapeHtml(item.packUnit)}</div>`;
    if (item.hasHome > 0) {
      html += `<div class="shop-item-detail" style="color:var(--green)">Har ${escapeHtml(item.hasHome)}${escapeHtml(item.packUnit)} hjemme</div>`;
    }
  }
  if (item.dairyNote) html += `<div class="dairy-note">${escapeHtml(item.dairyNote)}</div>`;
  html += `</div>`; // end info col

  if (item.estPrice > 0) html += `<div class="shop-item-price">~${Number(item.estPrice) || 0} kr</div>`;

  // "Kjøpt" knapp → oppdaterer pantry (Fase D)
  if (!item.checkedOff && item.id) {
    html += `<button class="btn btn-success btn-small" style="margin-left:8px" onclick="markItemBought(${Number(item.id)})">✓ Kjøpt</button>`;
  }
  html += `</div>`;
  return html;
}

function renderPantryLinkedItem(item) {
  const displayName = item.ingredientNameNo || item.ingredientName || item.name;
  return `
    <div class="shop-item is-pantry">
      <div style="flex:1">
        <div class="shop-item-name">${escapeHtml(displayName)}</div>
        <span class="pantry-flag">✓ Dekket av pantry</span>
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
  if (item.packSize) html += `<div style="font-size:0.75rem;color:var(--text2)">${escapeHtml(item.packCount || 1)} pk à ${escapeHtml(item.packSize)} ${escapeHtml(item.packUnit || 'stk')}</div>`;
  html += `</div>`;
  if (item.estPrice > 0) html += `<div class="consumable-price">~${Number(item.estPrice) || 0} kr</div>`;
  html += `</div>`;
  html += `<div class="consumable-meta">`;
  if (item.depletionInfo) html += `<span>Forbruk: ${escapeHtml(item.depletionInfo)}</span>`;
  if (item.store) html += `<span class="store-tag">📍 ${escapeHtml(item.store)}</span>`;
  html += `</div>`;
  if (item.daysLeft !== undefined && item.daysLeft !== null) {
    const dClass = item.daysLeft <= 0 ? 'days-urgent' : item.daysLeft <= 3 ? 'days-warn' : 'days-ok';
    const dText = item.daysLeft <= 0 ? 'TOM — kjøp nå!' : `~${Number(item.daysLeft) || 0} dager igjen`;
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

// --- Nye handlers for bought / unpantry ---
async function markItemBought(itemId) {
  try {
    await api(`/api/shopping/items/${itemId}/bought`, { method: 'PUT' });
    await loadShopping();
  } catch (err) {
    showToast('Kunne ikke markere som kjøpt: ' + (err.message || err), 'error');
  }
}

async function unpantryItem(itemId) {
  try {
    await api(`/api/shopping/items/${itemId}/unpantry`, { method: 'PUT' });
    await loadShopping();
  } catch (err) {
    showToast('Kunne ikke flytte tilbake: ' + (err.message || err), 'error');
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

