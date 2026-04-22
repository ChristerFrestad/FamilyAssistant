/* eslint-disable no-undef -- classic script shares globals across public/js/*.js */
// === Init ===
loadTheme();

// Phase 11: boot auth before loading anything that hits /api/*. If the
// backend says "not authenticated" we hand over to /login.html and stop
// the rest of the init so the shell does not flicker with skeleton
// loaders. Bearer-auth RPi deployments and legacy no-AUTH_TOKEN dev
// mode both return an authenticated synthetic user and pass through.
(async function boot() {
  const ok = await bootAuth();
  if (!ok) return;
  loadToday();
  // PR #59 fix — preload shopping data on boot. The handleliste-empty bug
  // surfaced because clicking the tab never triggered a fetch in some
  // browser environments (suspected SW-cached stale shopping.js). Preloading
  // here guarantees shoppingData is populated by the time the user switches
  // to the handleliste-tab, regardless of switchTab/loadShopping timing or
  // any lingering cache quirks. The cost is one extra request on boot
  // (~30ms for a few KB of JSON); the safety it buys is worth it until
  // we have stronger evidence the tab-switch path is 100% reliable.
  if (typeof loadShopping === 'function') {
    loadShopping().catch(() => {
      /* preload is best-effort; failures surface via the normal tab-click
         flow. Do not toast from here — user has not requested shopping yet. */
    });
  }
  checkLlmStatus();
  initVoice();
  setInterval(checkNotifications, 30 * 60 * 1000);
  setTimeout(checkNotifications, 5000);
})();
// === M5.2 Service worker registration ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // prettier-ignore
    const reg$ = navigator.serviceWorker.register('/sw.js');
    reg$
      .then((reg) => {
        // Sjekk for oppdateringer hver time
        setInterval(
          () => {
            reg.update().catch(() => {});
          },
          60 * 60 * 1000
        );
        // Når en ny SW er installert og venter, informer brukeren
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Ny versjon tilgjengelig — last siden på nytt', 'info', 10000);
            }
          });
        });
      })
      .catch((err) => console.warn('[sw] registrering feilet:', err));
  });
}
