/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// === Tab switching ===
function switchTab(el) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(el.dataset.view).classList.add('active');

  // Load data for the tab
  const view = el.dataset.view;
  // FASE_E: stopp enrichment-polling hvis vi forlater shopping
  if (view !== 'viewShopping' && enrichmentPollTimer) {
    clearTimeout(enrichmentPollTimer);
    enrichmentPollTimer = null;
  }
  // Defensive: typeof-guards mirror the pattern already used in settings.js
  // and pantry.js. If one module fails to load (cached-stale SW, 404, CSP),
  // the others still work — we do not crash the tab-switch wholesale.
  // Regression context: the handleliste-empty bug (PR #59) surfaced because
  // a cached shopping.js from before PR #46 was still served by the SW,
  // making loadShopping undefined at click-time; switchTab then threw
  // silently and no fetch fired. SW VERSION is bumped in the same change
  // to force cache invalidation; these guards are belt-and-suspenders.
  if (view === 'viewToday' && typeof loadToday === 'function') loadToday();
  if (view === 'viewMeals' && typeof loadMeals === 'function') loadMeals();
  if (view === 'viewShopping' && typeof loadShopping === 'function') loadShopping();
  if (view === 'viewChores' && typeof loadChores === 'function') loadChores();
  // FASE_E: oppdater FAB synlighet
  if (typeof updateFabVisibility === 'function') updateFabVisibility();
}
