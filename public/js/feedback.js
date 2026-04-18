/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// Phase 15 — in-app feedback modal.
//
// Wired to the 💬 button in the header (index.html). Opens a modal with
// category dropdown + message textarea + optional 1-5 star rating +
// "contact me back" checkbox. Submits to POST /api/feedback.

const FEEDBACK_CATEGORIES = [
  { value: 'bug', label: 'Feilmelding' },
  { value: 'suggestion', label: 'Forslag' },
  { value: 'question', label: 'Spørsmål' },
  { value: 'praise', label: 'Ros' },
  { value: 'other', label: 'Annet' },
];

function openFeedbackModal() {
  // Do not stack modals
  if (document.getElementById('feedbackOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'feedbackOverlay';
  overlay.className = 'feedback-overlay';
  overlay.setAttribute('role', 'presentation');

  const dialog = document.createElement('div');
  dialog.className = 'feedback-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'feedback-title');
  dialog.tabIndex = -1;

  const categoryOptions = FEEDBACK_CATEGORIES
    .map((c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`)
    .join('');

  // Initial HTML is composed from static constants (no user input) so
  // innerHTML is safe here. All later user input goes via .value properties.
  dialog.innerHTML = `
    <h3 id="feedback-title" class="feedback-title">Gi tilbakemelding</h3>
    <form id="feedbackForm" class="feedback-form" novalidate>
      <label class="feedback-label">
        Kategori
        <select id="feedbackCategory" name="category" required>
          ${categoryOptions}
        </select>
      </label>
      <label class="feedback-label">
        Melding
        <textarea id="feedbackMessage" name="message" rows="5" maxlength="2000"
                  placeholder="Hva vil du si til oss?" required></textarea>
      </label>
      <fieldset class="feedback-rating">
        <legend>Hvor fornøyd er du? (valgfri)</legend>
        <div class="feedback-stars" role="radiogroup" aria-label="Stjernerangering">
          ${[1, 2, 3, 4, 5]
            .map(
              (n) =>
                `<button type="button" class="feedback-star" data-value="${n}"
                         aria-label="${n} av 5 stjerner">☆</button>`
            )
            .join('')}
        </div>
      </fieldset>
      <label class="feedback-check">
        <input type="checkbox" id="feedbackContact" name="contactOk">
        <span>Det er OK at dere kontakter meg for oppfølging</span>
      </label>
      <div class="feedback-actions">
        <button type="button" class="btn btn-ghost" id="feedbackCancel">Avbryt</button>
        <button type="submit" class="btn btn-primary" id="feedbackSubmit">Send inn</button>
      </div>
    </form>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let currentRating = null;
  const stars = dialog.querySelectorAll('.feedback-star');
  stars.forEach((starBtn) => {
    starBtn.addEventListener('click', () => {
      const v = Number(starBtn.dataset.value);
      currentRating = currentRating === v ? null : v;
      stars.forEach((s) => {
        const sv = Number(s.dataset.value);
        const selected = currentRating !== null && sv <= currentRating;
        s.textContent = selected ? '★' : '☆';
        s.classList.toggle('is-active', selected);
      });
    });
  });

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function onKey(ev) {
    if (ev.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  dialog.querySelector('#feedbackCancel').addEventListener('click', close);

  dialog.querySelector('#feedbackForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const category = dialog.querySelector('#feedbackCategory').value;
    const message = dialog.querySelector('#feedbackMessage').value.trim();
    const contactOk = dialog.querySelector('#feedbackContact').checked;
    if (!message) {
      showToast('Skriv en melding først', 'warn');
      return;
    }
    const submitBtn = dialog.querySelector('#feedbackSubmit');
    submitBtn.disabled = true;
    try {
      await api('/api/feedback', {
        method: 'POST',
        body: {
          category,
          message,
          rating: currentRating,
          contactOk,
          pageUrl: window.location.pathname + window.location.search,
        },
      });
      showToast('Takk for tilbakemeldingen!', 'success');
      close();
    } catch (err) {
      submitBtn.disabled = false;
      // api() already surfaces a toast for transport failures; fall through silently.
    }
  });

  // Focus message textarea after the dialog is in the DOM.
  setTimeout(() => dialog.querySelector('#feedbackMessage')?.focus(), 0);
}

// Phase 15 — recipe thumbs helper. Called from meals.js on AI suggestions.
async function sendRecipeFeedback({ recipeId, mealPlanId = null, rating }) {
  if (!recipeId || ![-1, 0, 1].includes(rating)) return null;
  try {
    const res = await api('/api/recipe-feedback', {
      method: 'POST',
      body: { recipeId, mealPlanId, rating },
    });
    return res;
  } catch {
    return null;
  }
}

// Wire up the header button once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('feedbackBtn');
  if (btn) btn.addEventListener('click', openFeedbackModal);
});
