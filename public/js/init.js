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
