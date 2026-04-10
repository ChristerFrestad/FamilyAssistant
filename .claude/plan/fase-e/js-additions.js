// ============================================================================
// FASE E — JavaScript-tillegg til public/index.html
// Lim inn i <script>-blokka. Se kommentarer for anbefalt plassering.
// ============================================================================

// --- STATE (legg til øverst sammen med de andre state-variablene) ---
let shoppingSubView = 'buy';     // 'buy' | 'pantry'
let pantryData = null;
let currentShoppingListId = null; // brukes til retry av enrichment
let enrichmentPollTimer = null;

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
    Handleliste — uke ${data.weekYear.split('-W')[1]}
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
    document.getElementById('shoppingContent').innerHTML = html;
    loadPantry(); // async refresh
    return;
  }

  // --- Enrichment status banner ---
  html += renderEnrichmentBanner(data);

  // --- Eksisterende kategori-rendering med utvidelser ---
  for (const cat of data.categories || []) {
    html += `<div class="shop-category"><div class="shop-category-title">${cat.category}</div>`;
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
  html += `<div class="total-price">Estimert totalpris: ~${data.totalEstPrice || 0} kr</div>`;

  // Legg til vare-skjema (uendret)
  html += renderAddItemForm();

  document.getElementById('shoppingContent').innerHTML = html;
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
    alert('Kunne ikke starte berikelse på nytt.');
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
  html += `<div class="shop-item-name">${displayName} ${kassalChip}</div>`;
  if (showEnglish) html += `<div class="shop-item-name-en">${item.ingredientName}</div>`;

  if (item.packSize) {
    html += `<div class="shop-item-detail">${item.stillNeed}${item.packUnit} trengs → ${item.packCount} pk à ${item.packSize}${item.packUnit}</div>`;
    if (item.hasHome > 0) {
      html += `<div class="shop-item-detail" style="color:var(--green)">Har ${item.hasHome}${item.packUnit} hjemme</div>`;
    }
  }
  if (item.dairyNote) html += `<div class="dairy-note">${item.dairyNote}</div>`;
  html += `</div>`; // end info col

  if (item.estPrice > 0) html += `<div class="shop-item-price">~${item.estPrice} kr</div>`;

  // "Kjøpt" knapp → oppdaterer pantry (Fase D)
  if (!item.checkedOff && item.id) {
    html += `<button class="btn btn-success btn-small" style="margin-left:8px" onclick="markItemBought(${item.id})">✓ Kjøpt</button>`;
  }
  html += `</div>`;
  return html;
}

function renderPantryLinkedItem(item) {
  const displayName = item.ingredientNameNo || item.ingredientName || item.name;
  return `
    <div class="shop-item is-pantry">
      <div style="flex:1">
        <div class="shop-item-name">${displayName}</div>
        <span class="pantry-flag">✓ Dekket av pantry</span>
      </div>
      <button class="btn btn-ghost btn-small" onclick="unpantryItem(${item.id})" title="Flytt tilbake til kjøpsliste">
        ↩ Trenger likevel
      </button>
    </div>
  `;
}

function renderConsumableItem(item) {
  // Uendret fra eksisterende kode — flyttet ut i egen funksjon for lesbarhet
  let html = `<div class="consumable-item">`;
  html += `<div class="consumable-header">`;
  html += `<div><div class="consumable-name">${item.name}</div>`;
  if (item.packSize) html += `<div style="font-size:0.75rem;color:var(--text2)">${item.packCount || 1} pk à ${item.packSize} ${item.packUnit || 'stk'}</div>`;
  html += `</div>`;
  if (item.estPrice > 0) html += `<div class="consumable-price">~${item.estPrice} kr</div>`;
  html += `</div>`;
  html += `<div class="consumable-meta">`;
  if (item.depletionInfo) html += `<span>Forbruk: ${item.depletionInfo}</span>`;
  if (item.store) html += `<span class="store-tag">📍 ${item.store}</span>`;
  html += `</div>`;
  if (item.daysLeft !== undefined && item.daysLeft !== null) {
    const dClass = item.daysLeft <= 0 ? 'days-urgent' : item.daysLeft <= 3 ? 'days-warn' : 'days-ok';
    const dText = item.daysLeft <= 0 ? 'TOM — kjøp nå!' : `~${item.daysLeft} dager igjen`;
    html += `<div class="consumable-days-left ${dClass}">${dText}</div>`;
  }
  if (item.notes) html += `<div class="consumable-notes">${item.notes}</div>`;
  html += `<div class="consumable-actions">`;
  html += `<button class="btn btn-success btn-small" onclick="markConsumableBought(${item.consumableId})">✓ Kjøpt</button>`;
  html += `<button class="btn btn-ghost btn-small" onclick="toggleConsumableAuto(${item.consumableId})">Auto av/på</button>`;
  html += `</div></div>`;
  return html;
}

function renderAddItemForm() {
  return `
    <div class="card" style="margin-top:16px">
      <div class="card-title">Legg til vare</div>
      <div class="input-row">
        <input type="text" id="addItemInput" placeholder="Varenavn (f.eks. Saft, Bleier...)">
        <button class="btn btn-primary" onclick="addShoppingItem()">Legg til</button>
      </div>
      <select id="addItemCategory" style="margin-top:8px;padding:8px;border-radius:8px;background:var(--input-bg);color:var(--text);border:1px solid var(--border);width:100%;font-family:inherit">
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
    alert('Kunne ikke markere som kjøpt: ' + (err.message || err));
  }
}

async function unpantryItem(itemId) {
  try {
    await api(`/api/shopping/items/${itemId}/unpantry`, { method: 'PUT' });
    await loadShopping();
  } catch (err) {
    alert('Kunne ikke flytte tilbake: ' + (err.message || err));
  }
}

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
    <div class="card">
      <div class="card-title">Legg til i pantry</div>
      <div class="input-row">
        <input type="text" id="pantryNameInput" placeholder="Varenavn">
        <input type="number" id="pantryQtyInput" placeholder="Antall" style="max-width:90px" min="1" value="1">
        <button class="btn btn-primary" onclick="addToPantry()">Legg til</button>
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

function renderPantryList() {
  const items = pantryData?.items || [];
  if (items.length === 0) {
    return `<div class="pantry-empty">Ingen varer i pantry ennå.<br>Legg til med skjemaet over.</div>`;
  }
  let html = '';
  for (const it of items) {
    const name = it.ingredientNameNo || it.ingredientName || it.name;
    html += `
      <div class="pantry-item">
        <div class="pantry-item-name">${name}</div>
        <div class="pantry-item-qty">${it.quantity || 1} ${it.unit || 'stk'}</div>
        <button class="btn btn-ghost btn-small" onclick="removeFromPantry(${it.id})" title="Har ikke likevel">
          ✗
        </button>
      </div>
    `;
  }
  return html;
}

async function addToPantry() {
  const name = document.getElementById('pantryNameInput').value.trim();
  const qty  = parseInt(document.getElementById('pantryQtyInput').value, 10) || 1;
  if (!name) return;
  try {
    await api('/api/pantry/add', { method: 'POST', body: { name, quantity: qty } });
    document.getElementById('pantryNameInput').value = '';
    document.getElementById('pantryQtyInput').value = '1';
    await loadPantry();
  } catch (err) {
    alert('Kunne ikke legge til: ' + (err.message || err));
  }
}

async function removeFromPantry(pantryId) {
  try {
    // Backend mangler eksplisitt /pantry/remove — bruk /pantry/add med qty=0 eller
    // legg til ny rute. For nå: bruk PUT /api/shopping/items/:id/unpantry hvis pantryId
    // refererer til et shopping-item. Ellers må vi vente på dedikert rute.
    // Fallback: POST /api/pantry/add med negativ delta hvis servicen støtter det.
    await api(`/api/pantry/${pantryId}`, { method: 'DELETE' });
    await loadPantry();
  } catch (err) {
    alert('Kunne ikke fjerne: ' + (err.message || err));
  }
}

// ============================================================================
// === OPPSKRIFTS-IMPORT MODAL (nås via FAB i Ukesmeny-fanen) ===
// ============================================================================

let recipeImportTab = 'text'; // 'text' | 'image'
let recipeImportImageB64 = null;

function openRecipeImportModal() {
  recipeImportTab = 'text';
  recipeImportImageB64 = null;
  renderRecipeImportModal();
  document.getElementById('modalBg').style.display = 'flex';
}

function renderRecipeImportModal() {
  const html = `
    <h2>📖 Importer oppskrift</h2>
    <div class="modal-tabs">
      <button class="modal-tab ${recipeImportTab === 'text' ? 'active' : ''}" onclick="setRecipeImportTab('text')">Tekst</button>
      <button class="modal-tab ${recipeImportTab === 'image' ? 'active' : ''}" onclick="setRecipeImportTab('image')">Bilde</button>
    </div>
    ${recipeImportTab === 'text' ? renderRecipeTextPanel() : renderRecipeImagePanel()}
    <div class="btn-row" style="margin-top:16px">
      <button class="btn btn-primary" style="flex:1" onclick="submitRecipeImport()" id="recipeImportSubmit">
        Importer
      </button>
      <button class="btn btn-ghost" onclick="closeModal()">Avbryt</button>
    </div>
  `;
  document.getElementById('modalContent').innerHTML = html;
}

function setRecipeImportTab(tab) {
  recipeImportTab = tab;
  renderRecipeImportModal();
}

function renderRecipeTextPanel() {
  return `
    <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
      Lim inn oppskriften under — tittel, ingredienser, fremgangsmåte.
    </p>
    <textarea id="recipeTextInput" placeholder="Eks.&#10;Kremet pasta med kylling&#10;&#10;Ingredienser:&#10;- 400g pasta&#10;- 2 kyllingfileter&#10;- 2 dl fløte&#10;&#10;Slik gjør du:&#10;1. Kok pastaen&#10;2. Stek kyllingen..."></textarea>
  `;
}

function renderRecipeImagePanel() {
  const preview = recipeImportImageB64
    ? `<img src="${recipeImportImageB64}" class="image-preview" alt="forhåndsvisning">`
    : '';
  return `
    <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
      Ta bilde av kokeboksiden eller velg fra galleri. Bildet blir automatisk skalert ned.
    </p>
    <label class="image-dropzone" id="imageDropzone">
      <span class="ico">📷</span>
      <div>Trykk for å velge bilde</div>
      <div class="hint">JPG, PNG — maks 800px bred etter skalering</div>
      <input type="file" accept="image/*" capture="environment" onchange="handleRecipeImageSelect(event)">
    </label>
    ${preview}
  `;
}

async function handleRecipeImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    recipeImportImageB64 = await resizeImageToBase64(file, 800, 0.8);
    renderRecipeImportModal();
  } catch (err) {
    alert('Kunne ikke lese bilde: ' + (err.message || err));
  }
}

// Client-side resize for å holde base64-payload under MAX_BODY_BYTES (1MB)
function resizeImageToBase64(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function submitRecipeImport() {
  const submitBtn = document.getElementById('recipeImportSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Importerer…';
  try {
    let result;
    if (recipeImportTab === 'text') {
      const text = document.getElementById('recipeTextInput').value.trim();
      if (!text) { alert('Lim inn oppskriftstekst først.'); submitBtn.disabled = false; submitBtn.textContent = 'Importer'; return; }
      result = await api('/api/recipes/import', { method: 'POST', body: { text } });
    } else {
      if (!recipeImportImageB64) { alert('Velg et bilde først.'); submitBtn.disabled = false; submitBtn.textContent = 'Importer'; return; }
      result = await api('/api/recipes/import/image', { method: 'POST', body: { imageBase64: recipeImportImageB64 } });
    }
    closeModal();
    alert(`✅ Oppskrift importert: ${result.recipe?.name || 'ukjent navn'}`);
  } catch (err) {
    alert('Import feilet: ' + (err.message || err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Importer';
  }
}

// ============================================================================
// === FAB visibility (vises kun i Ukesmeny-fanen) ===
// ============================================================================

function updateFabVisibility() {
  const fab = document.getElementById('recipeImportFab');
  if (!fab) return;
  const isMeals = document.getElementById('viewMeals').classList.contains('active');
  fab.classList.toggle('visible', isMeals);
}
// Kall updateFabVisibility() fra switchTab() etter klasse-toggle.
