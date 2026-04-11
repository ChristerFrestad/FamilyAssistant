/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
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
      html += `
        <div class="chore-item ${isDone ? 'chore-done' : ''}">
          <span class="chore-icon">${escapeHtml(c.icon)}</span>
          <div class="chore-info">
            <div class="chore-task">${escapeHtml(c.task)}</div>
            ${c.details ? `<div class="chore-day">${escapeHtml(c.details)}</div>` : ''}
            ${c.status === 'postponed' ? '<div class="chore-day" style="color:var(--orange)">Utsatt</div>' : ''}
          </div>
          ${!isDone ? `
            <button class="btn btn-ghost btn-small" onclick="postponeChore(${Number(c.choreId)})">Utsett</button>
            <button class="btn btn-success btn-small" onclick="completeChore(${Number(c.choreId)})">✓</button>
          ` : '<span style="color:var(--green);font-size:0.8rem">✓ Gjort</span>'}
        </div>
      `;
    }
    html += `</div>`;
  }

  (function(el){ if(el){ el.innerHTML = html; el.setAttribute('aria-busy', 'false'); } })(document.getElementById('choresContent'));
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

