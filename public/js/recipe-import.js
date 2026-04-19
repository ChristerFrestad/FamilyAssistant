/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// ============================================================================
// === OPPSKRIFTS-IMPORT MODAL (nås via FAB i Ukesmeny-fanen) ===
// ============================================================================

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
  // recipeImportImageB64 kommer fra canvas.toDataURL() lokalt — trygt, men escape attribute-verdien
  const preview = recipeImportImageB64
    ? `<img src="${escapeHtml(recipeImportImageB64)}" class="image-preview" alt="forhåndsvisning">`
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
    showToast('Kunne ikke lese bilde: ' + (err.message || err), 'error');
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
      if (!text) {
        showToast('Lim inn oppskriftstekst først', 'warn');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Importer';
        return;
      }
      result = await api('/api/recipes/import', { method: 'POST', body: { text } });
    } else {
      if (!recipeImportImageB64) {
        showToast('Velg et bilde først', 'warn');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Importer';
        return;
      }
      result = await api('/api/recipes/import/image', {
        method: 'POST',
        body: { imageBase64: recipeImportImageB64 },
      });
    }
    closeModal();
    const importedName = String(result.recipe?.name || 'ukjent navn').slice(0, 200);

    // Uke 9 SAF-4: hvis deterministisk allergi-filter fant treff, vis
    // tydelig advarsel i stedet for en vanlig success-toast. Frontend er
    // siste linje — backend lagrer allerede blockedIngredients, vi bare
    // gjør brukeren klar over det.
    if (
      result.safeForProfile === false &&
      Array.isArray(result.blockedIngredients) &&
      result.blockedIngredients.length > 0
    ) {
      const blockedNames = result.blockedIngredients.map((b) => b.ingredient).join(', ');
      const allergies = [...new Set(result.blockedIngredients.map((b) => b.allergy))].join(', ');
      await showConfirm({
        title: '⚠ Advarsel: allergener oppdaget',
        message: `Oppskrift "${importedName}" er lagret, men inneholder ingredienser som matcher familieprofilen din:\n\n${blockedNames}\n\nMatcher allergier: ${allergies}\n\nDobbelsjekk oppskriften manuelt. LLM-genererte oppskrifter er "beste innsats" og ikke garantert allergi-trygge.`,
        confirmLabel: 'Forstått',
        cancelLabel: 'Avbryt',
      });
    } else {
      showToast(`✅ Oppskrift importert: ${importedName}`, 'success');
    }
  } catch (err) {
    showToast('Import feilet: ' + (err.message || err), 'error');
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
  // CSS-regelen `body.settings-mode .fab { display: none }` sikrer at FAB
  // skjules automatisk når SettingsView er aktiv, uansett tab-tilstand.
}
// Kall updateFabVisibility() fra switchTab() etter klasse-toggle.
// ===== FASE_E_END shopping-pantry-recipe-import =====
