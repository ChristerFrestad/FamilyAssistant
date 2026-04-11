/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
// === Init ===
loadTheme();
loadToday();
checkLlmStatus();
initVoice();
// Sjekk varsler hvert 30. minutt
setInterval(checkNotifications, 30 * 60 * 1000);
setTimeout(checkNotifications, 5000); // Sjekk etter 5 sek

// Uke 4 (FE-11): onboarding-wizard for foerste-gangs-brukere.
// Kalles etter en liten delay slik at appen rekker aa laste todayContent foerst.
setTimeout(() => {
  if (typeof startOnboarding === 'function') startOnboarding();
}, 800);

// === M5.2 Service worker registration ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        // Sjekk for oppdateringer hver time
        setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
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
      .catch(err => console.warn('[sw] registrering feilet:', err));
  });
}
