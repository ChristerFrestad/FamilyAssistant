/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// === Tab switching ===
function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(el.dataset.view).classList.add('active');

  // Load data for the tab
  const view = el.dataset.view;
  // FASE_E: stopp enrichment-polling hvis vi forlater shopping
  if (view !== 'viewShopping' && enrichmentPollTimer) {
    clearTimeout(enrichmentPollTimer);
    enrichmentPollTimer = null;
  }
  if (view === 'viewToday') loadToday();
  if (view === 'viewMeals') loadMeals();
  if (view === 'viewShopping') loadShopping();
  if (view === 'viewChores') loadChores();
  // FASE_E: oppdater FAB synlighet
  if (typeof updateFabVisibility === 'function') updateFabVisibility();
}

