/* eslint-disable no-undef, no-empty -- classic script shares globals across public/js/*.js */
// === Uke 4 (FE-11): Onboarding wizard ===
//
// Enkel 4-stegs velkomst-tour som vises første gang brukeren åpner appen.
// Bruker localStorage for flagg-lagring ('fa-onboarded'). Frivillig å
// gjennomføre — "Hopp over" skjuler den permanent.
//
// Tastatur:
//   Esc    → avbryt og marker som sett
//   Enter  → neste steg
//   Tab    → flytter fokus mellom Hopp over / Neste

const ONBOARDING_KEY = 'fa-onboarded';

function isOnboarded() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  } catch {
    return false;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'true');
  } catch {}
}

const ONBOARDING_STEPS = [
  {
    title: '👋 Velkommen til Familieassistenten!',
    body:
      'Dette er familiens digitale hjelper. Du kan planlegge middager, lage handleliste, ' +
      'huske husarbeid og prate med en LLM om hva som helst — alt kjører lokalt på din RPi5.',
    emoji: '🏠',
  },
  {
    title: '📅 Fanene i bunn',
    body:
      'I dag viser dagens middag, husarbeid og kalender.\n\n' +
      'Ukesmeny lar deg bytte middager og se ingredienser.\n\n' +
      'Handletur bygger handlelisten automatisk fra ukesmenyen.\n\n' +
      'Husarbeid tracker ukas oppgaver.\n\n' +
      'Chat er for å snakke med LLM-en.',
    emoji: '🧭',
  },
  {
    title: '⚙️ Innstillinger = Kontrollrommet',
    body:
      'Tannhjulet øverst åpner "Kontrollrommet" der du setter API-nøkler, ' +
      'velger språkmodell, legger til oppskriftskilder, definerer ' +
      'familieprofil (allergier!) og ser status.',
    emoji: '⚙️',
  },
  {
    title: '💡 Tips for daglig bruk',
    body:
      '• Klikk 📖-knappen i Ukesmeny for å importere oppskrift fra tekst eller bilde.\n' +
      '• Bruk 🎤-knappen i Chat for å snakke i stedet for å skrive.\n' +
      '• Alt lagres lokalt — ingen data forlater nettverket ditt.\n\n' +
      'Du kan alltid se denne guiden igjen via BRUKERGUIDE.md på GitHub.',
    emoji: '🚀',
  },
];

let onboardingCurrentStep = 0;
let onboardingOverlay = null;

function startOnboarding() {
  if (isOnboarded()) return;
  onboardingCurrentStep = 0;
  renderOnboarding();
}

function renderOnboarding() {
  // Rydde forrige overlay hvis finnes
  if (onboardingOverlay) {
    try { onboardingOverlay.remove(); } catch {}
    onboardingOverlay = null;
  }

  const step = ONBOARDING_STEPS[onboardingCurrentStep];
  if (!step) {
    finishOnboarding();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'onboarding-title');
  overlay.setAttribute('aria-describedby', 'onboarding-body');

  const card = document.createElement('div');
  card.className = 'onboarding-card';
  card.tabIndex = -1;

  // Emoji
  const emojiEl = document.createElement('div');
  emojiEl.className = 'onboarding-emoji';
  emojiEl.textContent = step.emoji;
  emojiEl.setAttribute('aria-hidden', 'true');

  // Title
  const titleEl = document.createElement('h2');
  titleEl.id = 'onboarding-title';
  titleEl.className = 'onboarding-title';
  titleEl.textContent = step.title;

  // Body
  const bodyEl = document.createElement('p');
  bodyEl.id = 'onboarding-body';
  bodyEl.className = 'onboarding-body';
  bodyEl.textContent = step.body;

  // Step dots
  const dotsEl = document.createElement('div');
  dotsEl.className = 'onboarding-dots';
  dotsEl.setAttribute('aria-label', `Steg ${onboardingCurrentStep + 1} av ${ONBOARDING_STEPS.length}`);
  for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
    const dot = document.createElement('span');
    dot.className = 'onboarding-dot' + (i === onboardingCurrentStep ? ' active' : '');
    dotsEl.appendChild(dot);
  }

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'onboarding-btn-row';

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'btn btn-ghost';
  skipBtn.textContent = 'Hopp over';
  skipBtn.addEventListener('click', () => finishOnboarding());

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn btn-primary';
  const isLast = onboardingCurrentStep === ONBOARDING_STEPS.length - 1;
  nextBtn.textContent = isLast ? 'Kom i gang!' : 'Neste →';
  nextBtn.addEventListener('click', () => {
    if (isLast) {
      finishOnboarding();
    } else {
      onboardingCurrentStep++;
      renderOnboarding();
    }
  });

  btnRow.appendChild(skipBtn);
  btnRow.appendChild(nextBtn);

  card.appendChild(emojiEl);
  card.appendChild(titleEl);
  card.appendChild(bodyEl);
  card.appendChild(dotsEl);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  onboardingOverlay = overlay;

  // Focus + keyboard handling
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      finishOnboarding();
      return;
    }
    if (ev.key === 'Enter' && document.activeElement === nextBtn) {
      ev.preventDefault();
      nextBtn.click();
      return;
    }
    if (ev.key === 'Tab') {
      const focusable = [skipBtn, nextBtn];
      const idx = focusable.indexOf(document.activeElement);
      if (idx === -1) {
        ev.preventDefault();
        focusable[0].focus();
        return;
      }
      ev.preventDefault();
      const next = ev.shiftKey
        ? focusable[(idx - 1 + focusable.length) % focusable.length]
        : focusable[(idx + 1) % focusable.length];
      next.focus();
    }
  };
  overlay._onKey = onKey;
  document.addEventListener('keydown', onKey, true);

  requestAnimationFrame(() => nextBtn.focus());
}

function finishOnboarding() {
  if (onboardingOverlay) {
    try {
      document.removeEventListener('keydown', onboardingOverlay._onKey, true);
      onboardingOverlay.remove();
    } catch {}
    onboardingOverlay = null;
  }
  markOnboarded();
}

// Debug-helper: eksponer restart av onboarding fra devtools
if (typeof window !== 'undefined') {
  window._resetOnboarding = () => {
    try {
      localStorage.removeItem(ONBOARDING_KEY);
    } catch {}
    startOnboarding();
  };
}
