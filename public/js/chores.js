/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// === HUSARBEID ===
async function loadChores() {
  const data = await api('/api/chores/current');
  choresData = data;
  currentWeek = data.weekYear;
  renderChores();
}

function renderChores() {
  const data = choresData;
  if (!data) return;

  let html = `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:12px">Uke ${escapeHtml(String(data.weekYear || '').split('-W')[1] || '')}</div>`;

  // Grupper etter dag
  const byDay = {};
  for (const c of data.chores) {
    const day = c.dayName;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(c);
  }

  for (const [day, items] of Object.entries(byDay)) {
    html += `<div class="card"><div class="card-title">${escapeHtml(day)}</div>`;
    for (const c of items) {
      const isDone = c.status === 'done';
      const isPostponed = c.status === 'postponed';
      // Felles angre-knapp for done/postponed — så fokusgruppen kan rette
      // opp feilklikk uten å lete etter en egen handling per status.
      const undoBtn = `<button class="btn btn-ghost btn-small" onclick="undoChore(${Number(c.choreId)})" title="Angre status">↶ Angre</button>`;
      html += `
        <div class="chore-item ${isDone ? 'chore-done' : ''}">
          <span class="chore-icon">${escapeHtml(c.icon)}</span>
          <div class="chore-info">
            <div class="chore-task">${escapeHtml(c.task)}</div>
            ${c.details ? `<div class="chore-day">${escapeHtml(c.details)}</div>` : ''}
            ${isPostponed ? '<div class="chore-day" style="color:var(--orange)">Utsatt</div>' : ''}
          </div>
          ${
            isDone
              ? `<span style="color:var(--green);font-size:0.8rem;margin-right:6px">✓ Gjort</span>${undoBtn}`
              : isPostponed
                ? `<button class="btn btn-success btn-small" onclick="completeChore(${Number(c.choreId)})">✓</button>${undoBtn}`
                : `
            <button class="btn btn-ghost btn-small" onclick="postponeChore(${Number(c.choreId)})">Utsett</button>
            <button class="btn btn-success btn-small" onclick="completeChore(${Number(c.choreId)})">✓</button>
          `
          }
        </div>
      `;
    }
    html += `</div>`;
  }

  (function (el) {
    if (el) {
      el.innerHTML = html;
      el.setAttribute('aria-busy', 'false');
    }
  })(document.getElementById('choresContent'));
}

async function postponeChore(choreId) {
  await api('/api/chores/postpone', { method: 'PUT', body: { weekYear: currentWeek, choreId } });
  await loadChores();
}

async function completeChore(choreId) {
  await api('/api/chores/complete', { method: 'PUT', body: { weekYear: currentWeek, choreId } });
  // Reload both today and chores
  await Promise.all([loadToday(), loadChores()]);
}

async function undoChore(choreId) {
  try {
    await api('/api/chores/undone', { method: 'PUT', body: { weekYear: currentWeek, choreId } });
    await Promise.all([loadToday(), loadChores()]);
    showToast('Status nullstilt', 'success');
  } catch (err) {
    showToast('Kunne ikke angre: ' + (err.message || err), 'error');
  }
}
