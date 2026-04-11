/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
// === UKESMENY ===
async function loadMeals() {
  const data = await api('/api/meals/current');
  mealsData = data;
  currentWeek = data.weekYear;
  renderMeals();
}

function renderMeals() {
  const data = mealsData;
  if (!data) return;
  let html = `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:12px">Uke ${escapeHtml(String(data.weekYear || '').split('-W')[1] || '')}</div>`;

  for (const slot of data.meals) {
    const r = slot.recipe;
    const isAway = slot.status === 'away';
    const badgeClass = r ? (r.category === 'rask' ? 'badge-rask' : r.category === 'comfort' ? 'badge-comfort' : 'badge-helg') : '';

    html += `<div class="card meal-card">`;

    if (isAway) {
      html += `
        <div class="meal-day">${escapeHtml(slot.dayName)}</div>
        <p style="color:var(--text2);margin:8px 0">🏖️ Borte</p>
        <button class="btn btn-ghost btn-small" onclick="setMealStatus(${Number(slot.dayOfWeek)},'planned')">Tilbake</button>
      `;
    } else if (r) {
      const expanded = expandedRecipes.has(slot.dayOfWeek);
      // Bruk JSON.stringify for onclick-literal slik at apostrofer/quotes ikke bryter markup
      const nameForJs = JSON.stringify(String(r.name || '')).replace(/</g, '\\u003c');
      // Uke 9 SAF-4: safety-advarsel hvis deterministisk filter fant allergener
      let safetyWarning = '';
      if (r.safeForProfile === false && Array.isArray(r.blockedIngredients) && r.blockedIngredients.length > 0) {
        const blockedNames = r.blockedIngredients.map(b => escapeHtml(b.ingredient)).join(', ');
        const allergiesHit = [...new Set(r.blockedIngredients.map(b => b.allergy))].map(escapeHtml).join(', ');
        safetyWarning = `
          <div class="safety-warning" role="alert">
            <strong>⚠ Inneholder allergener</strong>
            <div class="safety-warning-detail">
              Blokkerte ingredienser: <em>${blockedNames}</em><br>
              Matcher profil-allergier: <em>${allergiesHit}</em>
            </div>
          </div>
        `;
      }
      html += `
        <div class="meal-day">${escapeHtml(slot.dayName)}</div>
        <div class="meal-name">${escapeHtml(r.name)}</div>
        ${safetyWarning}
        <div class="meal-meta">
          <span class="meal-badge ${badgeClass}">${escapeHtml(r.category)}</span>
          <span>⏱ ${escapeHtml(r.prepTime)}</span>
        </div>
        <span class="recipe-toggle" onclick="toggleRecipe(${Number(slot.dayOfWeek)})">${expanded ? '▼ Skjul ingredienser' : '▶ Vis ingredienser'}</span>
        ${expanded ? `
          <div class="ingredients-list">
            ${r.ingredients.map(i => `
              <div class="ingredient-row">
                <span>${escapeHtml(i.name)}</span>
                <span class="ingredient-qty">${escapeHtml(i.qty)} ${escapeHtml(i.unit)}</span>
              </div>
            `).join('')}
          </div>
          ${r.url ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:0.8rem;margin-top:6px;display:inline-block">Se oppskrift →</a>` : ''}
        ` : ''}
        <div class="btn-row">
          <button class="btn btn-secondary btn-small" onclick="openSwapModal(${Number(slot.dayOfWeek)})">Bytt middag</button>
          ${slot.dayOfWeek > 0 ? `<button class="btn btn-ghost btn-small" onclick="reorderMeal(${Number(slot.dayOfWeek)},${Number(slot.dayOfWeek) - 1})">↑</button>` : ''}
          ${slot.dayOfWeek < 6 ? `<button class="btn btn-ghost btn-small" onclick="reorderMeal(${Number(slot.dayOfWeek)},${Number(slot.dayOfWeek) + 1})">↓</button>` : ''}
          <button class="btn btn-ghost btn-small" onclick="setMealStatus(${Number(slot.dayOfWeek)},'away')">🏖️ Borte</button>
        </div>
        <div class="similar-link-row">
          <a href="#" class="similar-link" onclick="showSimilarRecipes(${Number(r.id)}, ${nameForJs}); return false;">↻ Lignende oppskrift →</a>
        </div>
      `;
    }
    html += `</div>`;
  }

  (function(el){ if(el){ el.innerHTML = html; el.setAttribute('aria-busy', 'false'); } })(document.getElementById('mealsContent'));
}

// === Fase F4 — Lignende oppskrift modal ===
async function showSimilarRecipes(recipeId, recipeName) {
  try {
    const r = await fetch(`/api/recipes/${recipeId}/similar?limit=5`);
    if (!r.ok) { alert('Kunne ikke hente lignende oppskrifter'); return; }
    const data = await r.json();
    const modalBg = document.getElementById('modalBg');
    const modalContent = document.getElementById('modalContent');
    if (!modalBg || !modalContent) return;

    let html = `
      <h3 style="margin-top:0">Lignende oppskrifter</h3>
      <p style="color:var(--text2);font-size:0.85rem;margin-bottom:16px">Basert på ${escapeHtml(recipeName)}</p>
    `;
    if (!data.similar || data.similar.length === 0) {
      html += `<p style="color:var(--text2)">Ingen lignende oppskrifter funnet.</p>`;
    } else {
      html += '<div class="similar-list">';
      for (const s of data.similar) {
        const pct = Math.round(s.score * 100);
        html += `
          <div class="similar-item">
            <div class="similar-item-header">
              <div class="similar-item-name">${escapeHtml(s.name)}</div>
              <div class="similar-item-score">${pct}%</div>
            </div>
            <div class="similar-item-meta">
              <span class="meal-badge badge-${escapeHtml(s.category || 'comfort')}">${escapeHtml(s.category || '')}</span>
              ${s.prepTime ? `<span>⏱ ${escapeHtml(s.prepTime)}</span>` : ''}
              ${s.servings ? `<span>🍽 ${Number(s.servings) || 0} pers.</span>` : ''}
            </div>
            ${s.reasons && s.reasons.length ? `
              <div class="similar-item-reasons">${s.reasons.map(escapeHtml).join(' • ')}</div>
            ` : ''}
          </div>
        `;
      }
      html += '</div>';
    }
    html += `<div style="margin-top:16px;text-align:right"><button class="btn btn-ghost" onclick="closeModal()">Lukk</button></div>`;

    modalContent.innerHTML = html;
    modalBg.style.display = 'flex';
  } catch (err) {
    alert('Feil ved henting av lignende: ' + err.message);
  }
}

function toggleRecipe(dayOfWeek) {
  if (expandedRecipes.has(dayOfWeek)) expandedRecipes.delete(dayOfWeek);
  else expandedRecipes.add(dayOfWeek);
  renderMeals();
}

async function setMealStatus(dayOfWeek, status) {
  await api('/api/meals/status', { method: 'PUT', body: { weekYear: currentWeek, dayOfWeek, status } });
  await loadMeals();
}

async function reorderMeal(fromDay, toDay) {
  const data = await api('/api/meals/reorder', { method: 'PUT', body: { weekYear: currentWeek, fromDay, toDay } });
  if (data.shelfWarnings && data.shelfWarnings.length > 0) {
    const msgs = data.shelfWarnings.map(w => w.message).join('\n');
    alert('⚠️ Holdbarhetsvarsel:\n\n' + msgs + '\n\nByttet er utført, men vurder å flytte tilbake.');
  }
  await loadMeals();
}

async function openSwapModal(dayOfWeek) {
  const data = await api(`/api/meals/suggestions/${dayOfWeek}`);
  let html = `<h2>Bytt middag — ${escapeHtml(DAYS[dayOfWeek] || '')}</h2>`;

  for (const s of data.suggestions) {
    html += `
      <div class="suggestion-item" onclick="swapMeal(${Number(dayOfWeek)}, ${Number(s.recipeId)})">
        <div class="suggestion-name">${escapeHtml(s.name)}</div>
        <div class="suggestion-meta">⏱ ${escapeHtml(s.prepTime)} · ${escapeHtml(s.reason)}</div>
      </div>
    `;
  }

  html += `
    <div style="margin-top:16px">
      <div style="font-size:0.85rem;color:var(--text2);margin-bottom:6px">Eller skriv inn ønsket rett:</div>
      <div class="input-row">
        <input type="text" id="customMealInput" placeholder="F.eks. Taco, Lasagne, Stekt ris...">
        <button class="btn btn-primary" onclick="customSwap(${dayOfWeek})">Velg</button>
      </div>
    </div>
    <button class="btn btn-ghost" style="margin-top:12px;width:100%" onclick="closeModal()">Avbryt</button>
  `;

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').style.display = 'flex';
}

async function swapMeal(dayOfWeek, recipeId) {
  await api('/api/meals/swap', { method: 'PUT', body: { weekYear: currentWeek, dayOfWeek, recipeId } });
  closeModal();
  await loadMeals();
}

async function customSwap(dayOfWeek) {
  const input = document.getElementById('customMealInput');
  const name = input.value.trim();
  if (!name) return;
  // Søk i eksisterende oppskrifter
  const data = await api('/api/recipes');
  const match = data.recipes.find(r => r.name.toLowerCase().includes(name.toLowerCase()));
  if (match) {
    await swapMeal(dayOfWeek, match.id);
  } else {
    alert('Fant ikke oppskrift for "' + name + '". Prøv et av forslagene, eller be om at oppskriften legges til.');
    input.focus();
  }
}

function closeModal(event) {
  if (event && event.target !== document.getElementById('modalBg')) return;
  const bg = document.getElementById('modalBg');
  if (bg) bg.style.display = 'none';
  // Uke 4 (FE-9): ryd fokus etter modal lukkes
  try {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  } catch {}
}

// === Uke 4 (FE-9): Global Esc-handler for modalBg ===
// Settings-viewen har sin egen Esc-handler i settings.js. Denne håndterer
// kun det generelle modalBg-elementet (swap meal, sunday push, etc).
// Prioritet: hvis settings er åpen, lar vi settings.js håndtere det.
(function initGlobalModalKeyboard() {
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    // Skip hvis settings er åpen (settings.js eier dens egen Esc)
    if (typeof settingsOpen !== 'undefined' && settingsOpen) return;
    const bg = document.getElementById('modalBg');
    if (bg && bg.style.display !== 'none') {
      ev.preventDefault();
      closeModal();
    }
  });
})();


