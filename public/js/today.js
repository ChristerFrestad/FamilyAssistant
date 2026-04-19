/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// === I DAG ===
async function loadToday() {
  const data = await api('/api/today');
  currentWeek = data.weekYear;
  document.getElementById('headerSubtitle').textContent =
    `${data.dayName} — uke ${data.weekYear.split('-W')[1]}`;

  let html = '';

  // Dagens middag — kompakt visning (ingredienser i Ukesmeny-fanen)
  if (data.meal && data.meal.recipe) {
    const r = data.meal.recipe;
    const badgeClass =
      r.category === 'rask'
        ? 'badge-rask'
        : r.category === 'comfort'
          ? 'badge-comfort'
          : 'badge-helg';
    html += `
      <div class="card">
        <div class="card-title">Dagens middag</div>
        <h2 class="meal-heading">${escapeHtml(r.name)}</h2>
        <div class="meal-meta">
          <span class="meal-badge ${badgeClass}">${escapeHtml(r.category)}</span>
          <span>⏱ ${escapeHtml(r.prepTime)}</span>
          ${r.source ? `<span>📖 ${escapeHtml(r.source)}</span>` : ''}
        </div>
        ${r.url ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:0.85rem;margin-top:8px;display:inline-block">Se oppskrift →</a>` : ''}
      </div>
    `;
  } else if (data.meal && data.meal.status === 'away') {
    html += `<div class="card"><div class="card-title">Dagens middag</div><p style="color:var(--text2)">🏖️ Borte i dag</p></div>`;
  } else {
    html += `<div class="card"><div class="card-title">Dagens middag</div><p style="color:var(--text2)">Ingen middag planlagt</p></div>`;
  }

  // Kalender-hendelser i dag
  if (data.events && data.events.length > 0) {
    html += `<div class="card"><div class="card-title">Kalender i dag</div>`;
    for (const ev of data.events) {
      const timeStr = ev.allDay ? 'Hele dagen' : `${ev.startTime}–${ev.endTime}`;
      html += `
        <div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div style="font-size:0.9rem;font-weight:600">${escapeHtml(ev.title)}</div>
              <div style="font-size:0.8rem;color:var(--text2)">${escapeHtml(timeStr)}</div>
            </div>
          </div>
          ${ev.location ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem;color:var(--accent);margin-top:2px;display:inline-block">📍 ${escapeHtml(ev.location)}</a>` : ''}
        </div>
      `;
    }
    html += `</div>`;
  } else {
    html += `<div class="card"><div class="card-title">Kalender i dag</div><p style="color:var(--text2)">Ingen hendelser 📅</p></div>`;
  }

  // Dagens husarbeid
  if (data.chores && data.chores.length > 0) {
    html += `<div class="card"><div class="card-title">Husarbeid i dag</div>`;
    for (const c of data.chores) {
      html += `
        <div class="chore-item">
          <span class="chore-icon">${escapeHtml(c.icon)}</span>
          <div class="chore-info"><div class="chore-task">${escapeHtml(c.task)}</div></div>
          <button class="btn btn-success btn-small" onclick="completeChore(${Number(c.choreId)})">✓ Gjort</button>
        </div>
      `;
    }
    html += `</div>`;
  } else {
    html += `<div class="card"><div class="card-title">Husarbeid i dag</div><p style="color:var(--text2)">Ingen oppgaver i dag 🎉</p></div>`;
  }

  // "Hva kan jeg lage nå?" — 2-stegs pantry-basert forslag for denne uka
  html += `
    <div class="card">
      <div class="card-title">Denne uka</div>
      <p style="font-size:0.85rem;color:var(--text2);margin-bottom:8px">Få 5 forslag basert på det du har hjemme nå.</p>
      <button class="btn btn-primary" onclick="openPantryNowModal()">🥘 Hva kan jeg lage nå?</button>
    </div>
  `;

  // Søndagspush — automatisk søndag 14:00 via cron, manuell knapp som backup
  html += `
    <div class="card">
      <div class="card-title">Neste uke</div>
      <p style="font-size:0.85rem;color:var(--text2);margin-bottom:8px">Automatisk forslag kommer søndag kl. 14:00. Trykk for å planlegge manuelt nå.</p>
      <button class="btn btn-primary" onclick="openSundayPush()">📋 Planlegg neste uke</button>
    </div>
  `;

  (function (el) {
    if (el) {
      el.innerHTML = html;
      el.setAttribute('aria-busy', 'false');
    }
  })(document.getElementById('todayContent'));
}

// === SØNDAGSPUSH ===
async function openSundayPush() {
  const data = await api('/api/sunday-push');
  const weekStr = escapeHtml(String(data.weekYear || '').split('-W')[1] || '');
  let html = `<h2>📋 Forslag — uke ${weekStr}</h2>`;
  html += `<p style="color:var(--text2);font-size:0.85rem;margin-bottom:12px">${escapeHtml(data.message)}</p>`;

  for (const m of data.meals) {
    if (!m.recipe) continue;
    const badgeClass =
      m.recipe.category === 'rask'
        ? 'badge-rask'
        : m.recipe.category === 'comfort'
          ? 'badge-comfort'
          : 'badge-helg';
    html += `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <span style="font-size:0.75rem;color:var(--accent);font-weight:600;min-width:60px">${escapeHtml(m.dayName)}</span>
        <div style="flex:1">
          <div style="font-size:0.9rem">${escapeHtml(m.recipe.name)}</div>
          <div style="font-size:0.75rem;color:var(--text2)"><span class="meal-badge ${badgeClass}" style="font-size:0.65rem">${escapeHtml(m.recipe.category)}</span> ⏱ ${escapeHtml(m.recipe.prepTime)}</div>
        </div>
      </div>
    `;
  }

  html += `<div style="margin-top:12px;padding:10px;background:rgba(240,192,64,0.1);border-radius:8px;font-size:0.85rem">`;
  html += `<strong>🛒 Estimert handletur:</strong> ~${Number(data.shoppingList?.totalEstPrice) || 0} kr<br>`;
  html += `<strong>📅 Anbefalt handledag:</strong> ${escapeHtml(data.handledag)}`;
  html += `</div>`;

  // weekYear må være trygg — regex-valider mot ^\d{4}-W\d{2}$ før onclick
  const safeWeekYear = /^\d{4}-W\d{2}$/.test(data.weekYear) ? data.weekYear : '';
  html += `
    <div class="btn-row" style="margin-top:16px">
      <button class="btn btn-success" style="flex:1" onclick="acceptSundayPush('${safeWeekYear}')">✓ Godta forslaget</button>
      <button class="btn btn-secondary" onclick="openSundayPush()">🔄 Nytt forslag</button>
    </div>
    <button class="btn btn-ghost" style="margin-top:8px;width:100%" onclick="closeModal()">Avbryt</button>
  `;

  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').style.display = 'flex';
  // Lagre data for accept
  window._sundayPushData = data;
}

async function acceptSundayPush(weekYear) {
  const data = window._sundayPushData;
  if (!data) return;
  await api('/api/sunday-push/accept', {
    method: 'POST',
    body: { weekYear, meals: data.meals },
  });
  closeModal();
  showToast('Uke ' + weekYear.split('-W')[1] + ' er planlagt!', 'success');
  await loadToday();
}

// === "Hva kan jeg lage nå?" — to-stegs pantry-basert forslag ===
const _DAY_LABELS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function openPantryNowModal() {
  const html = `
    <h2 style="margin-top:0">🥘 Hva har du lyst på?</h2>
    <p style="color:var(--text2);font-size:0.85rem;margin-bottom:16px">
      Vi finner oppskriftene med flest varer allerede på lager.
    </p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-secondary" onclick="loadPantrySuggestions('rask')">⚡ Light &amp; easy</button>
      <button class="btn btn-secondary" onclick="loadPantrySuggestions('comfort')">🛋 Comfort food</button>
      <button class="btn btn-secondary" onclick="loadPantrySuggestions('helg')">🎉 Søndagsmiddag</button>
    </div>
    <button class="btn btn-ghost" style="margin-top:16px;width:100%" onclick="closeModal()">Avbryt</button>
  `;
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBg').style.display = 'flex';
}

async function loadPantrySuggestions(category) {
  try {
    const data = await api('/api/meals/pantry-suggestions', {
      method: 'POST',
      body: { category },
    });
    window._pantrySuggestionsData = data;
    renderPantrySuggestions(data);
  } catch (err) {
    showToast('Kunne ikke hente forslag: ' + err.message, 'error');
  }
}

function renderPantrySuggestions(data) {
  const remaining = Array.isArray(data.remainingDays) ? data.remainingDays : [];
  const catLabel =
    { rask: 'Light & easy', comfort: 'Comfort food', helg: 'Søndagsmiddag' }[data.category] ||
    data.category;

  let html = `
    <h2 style="margin-top:0">🥘 Topp ${Number(data.suggestions?.length) || 0} forslag — ${escapeHtml(catLabel)}</h2>
    <p style="color:var(--text2);font-size:0.85rem;margin-bottom:12px">
      Sortert etter mest pantry-dekning${data.mode === 'balansert' ? ' (med bonus for utløpsnære varer)' : ''}.
    </p>
  `;

  if (!data.suggestions || data.suggestions.length === 0) {
    html += `<p style="color:var(--text2)">Ingen oppskrifter i denne kategorien som ikke allerede er brukt i uka.</p>`;
  } else if (remaining.length === 0) {
    html += `<p style="color:var(--text2)">Alle dager resten av uka er allerede bestemt (borte/hoppet over). Prøv igjen neste uke.</p>`;
  } else {
    for (let i = 0; i < data.suggestions.length; i++) {
      const s = data.suggestions[i];
      const badgeClass =
        s.category === 'rask'
          ? 'badge-rask'
          : s.category === 'comfort'
            ? 'badge-comfort'
            : 'badge-helg';
      const pct =
        s.totalIngredients > 0 ? Math.round((s.ingredientsAtHome / s.totalIngredients) * 100) : 0;
      const dayOptions = remaining
        .map(
          (d, idx) =>
            `<option value="${d}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(_DAY_LABELS[d] || '?')}</option>`
        )
        .join('');
      html += `
        <div class="suggestion-item" style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1">
              <div class="suggestion-name" style="font-weight:600">${escapeHtml(s.name)}</div>
              <div class="suggestion-meta" style="font-size:0.8rem;color:var(--text2);margin-top:4px">
                <span class="meal-badge ${badgeClass}" style="font-size:0.65rem">${escapeHtml(s.category)}</span>
                ⏱ ${escapeHtml(s.prepTime || '?')} ·
                ${Number(s.ingredientsAtHome)}/${Number(s.totalIngredients)} hjemme (${pct}%)
                ${Number(s.expiringUsed) > 0 ? ` · ♻ bruker ${Number(s.expiringUsed)} utløpsnær vare` : ''}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
            <label style="font-size:0.8rem;color:var(--text2)">Legg på:</label>
            <select id="pantryDayFor-${Number(s.recipeId)}" style="flex:1;padding:4px">${dayOptions}</select>
            <button class="btn btn-primary btn-small" onclick="acceptPantrySuggestion(${Number(s.recipeId)})">Velg</button>
          </div>
        </div>
      `;
    }
  }

  html += `<button class="btn btn-ghost" style="margin-top:8px;width:100%" onclick="openPantryNowModal()">← Tilbake</button>`;
  html += `<button class="btn btn-ghost" style="margin-top:4px;width:100%" onclick="closeModal()">Lukk</button>`;

  document.getElementById('modalContent').innerHTML = html;
}

async function acceptPantrySuggestion(recipeId) {
  const sel = document.getElementById(`pantryDayFor-${recipeId}`);
  if (!sel) return;
  const dayOfWeek = Number(sel.value);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    showToast('Ugyldig dag', 'error');
    return;
  }
  try {
    const res = await api('/api/meals/pantry-suggestions/accept', {
      method: 'POST',
      body: { meals: [{ dayOfWeek, recipeId }] },
    });
    closeModal();
    const dayLabel = _DAY_LABELS[dayOfWeek] || '';
    const missingCount = (res.missing || []).length;
    const msg =
      missingCount > 0
        ? `Lagt til ${dayLabel.toLowerCase()}! ${missingCount} ingredienser mangler for resten av uka.`
        : `Lagt til ${dayLabel.toLowerCase()}! Alt du trenger er hjemme. 🎉`;
    showToast(msg, 'success', 5000);
    if (typeof loadToday === 'function') await loadToday();
    if (typeof loadMeals === 'function') await loadMeals();
  } catch (err) {
    showToast('Kunne ikke lagre: ' + err.message, 'error');
  }
}
