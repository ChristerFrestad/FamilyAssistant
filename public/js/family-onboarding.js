/* eslint-disable no-undef -- classic script on a standalone onboarding page */
// Family onboarding wizard (3 steps: family name → roster/allergies → LLM).
// Persists each step incrementally so a partial drop-off still leaves the
// caller in a usable state.

const ALLERGY_OPTIONS = [
  'gluten',
  'laktose',
  'nøtter',
  'skalldyr',
  'egg',
  'soya',
  'fisk',
  'vegansk',
  'vegetarisk',
  'pescetar',
];

const PROVIDER_OPTIONS = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    url: 'https://console.anthropic.com/',
    defaultModel: 'claude-haiku-4-5-20251001',
    needsKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    url: 'https://x.ai/api',
    defaultModel: 'grok-3-mini',
    needsKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama (lokal)',
    url: 'https://ollama.com/download',
    defaultModel: 'qwen2.5:3b',
    needsKey: false,
  },
];

const state = {
  step: 1,
  familyId: null,
  members: [{ name: '', category: 'adult' }],
  allergies: new Set(),
  allergyFreeText: '',
  provider: null,
};

function setStatus(text, kind) {
  const el = document.getElementById('obStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ob-status' + (kind ? ' ' + kind : '');
}

function showStep(n) {
  state.step = n;
  for (let i = 1; i <= 3; i++) {
    document.getElementById('step' + i).hidden = i !== n;
    const dot = document.getElementById('dot' + i);
    dot.classList.toggle('active', i === n);
    dot.classList.toggle('done', i < n);
  }
  const back = document.getElementById('backBtn');
  const next = document.getElementById('nextBtn');
  back.disabled = n === 1;
  next.textContent = n === 3 ? 'Fullfør' : 'Neste';
}

function categoryFactor(cat) {
  if (cat === 'adult') return 1.0;
  if (cat === 'teen') return 0.75;
  if (cat === 'child') return 0.5;
  return 1.0;
}

// ============================================================
// Render dynamic parts
// ============================================================

function renderMemberList() {
  const list = document.getElementById('memberList');
  list.innerHTML = '';
  state.members.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'ob-member';
    row.innerHTML = `
      <input type="text" data-idx="${idx}" data-field="name" value="${escapeAttr(m.name)}" placeholder="Navn" />
      <select data-idx="${idx}" data-field="category">
        <option value="adult"${m.category === 'adult' ? ' selected' : ''}>Voksen</option>
        <option value="teen"${m.category === 'teen' ? ' selected' : ''}>Ungdom</option>
        <option value="child"${m.category === 'child' ? ' selected' : ''}>Barn</option>
      </select>
      <input type="number" data-idx="${idx}" data-field="portionFactor" value="${categoryFactor(m.category)}" step="0.05" min="0.1" max="3" />
      <button type="button" data-idx="${idx}" data-action="remove" ${state.members.length === 1 ? 'disabled' : ''}>✕</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', () => {
      const i = Number(el.dataset.idx);
      const f = el.dataset.field;
      state.members[i][f] = f === 'portionFactor' ? Number(el.value) : el.value;
      if (f === 'category') {
        // Snap the portion-factor input to the new default when the user
        // didn't override it yet.
        const pfInput = list.querySelector(`input[data-idx="${i}"][data-field="portionFactor"]`);
        if (pfInput) pfInput.value = categoryFactor(el.value);
        state.members[i].portionFactor = categoryFactor(el.value);
      }
    });
  });
  list.querySelectorAll('button[data-action="remove"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      state.members.splice(i, 1);
      if (state.members.length === 0) state.members.push({ name: '', category: 'adult' });
      renderMemberList();
    });
  });
}

function renderAllergyChips() {
  const el = document.getElementById('allergyChips');
  el.innerHTML = '';
  ALLERGY_OPTIONS.forEach((opt) => {
    const chip = document.createElement('span');
    chip.className = 'ob-chip' + (state.allergies.has(opt) ? ' active' : '');
    chip.textContent = opt;
    chip.addEventListener('click', () => {
      if (state.allergies.has(opt)) state.allergies.delete(opt);
      else state.allergies.add(opt);
      renderAllergyChips();
    });
    el.appendChild(chip);
  });
}

function renderProviderList() {
  const el = document.getElementById('providerList');
  el.innerHTML = '';
  // "Skip" option at the top so the caller can clearly opt out.
  const skip = document.createElement('div');
  skip.className = 'ob-provider' + (state.provider === null ? ' active' : '');
  skip.innerHTML = `
    <div>⏭️</div>
    <div class="ob-provider-label">
      Hopp over (konfigurer senere)
      <div class="ob-provider-meta">Pantry og handleliste virker uten AI.</div>
    </div>
  `;
  skip.addEventListener('click', function () {
    state.provider = null;
    renderProviderList();
    syncLlmFields();
  });
  el.appendChild(skip);

  PROVIDER_OPTIONS.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'ob-provider' + (state.provider === p.id ? ' active' : '');
    row.innerHTML = `
      <div>🤖</div>
      <div class="ob-provider-label">
        ${escapeAttr(p.label)}
        <div class="ob-provider-meta">
          ${p.needsKey ? 'API-nøkkel kreves · ' : 'Ingen nøkkel · '}
          <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener noreferrer">Åpne konto</a>
        </div>
      </div>
    `;
    row.addEventListener('click', (ev) => {
      if (ev.target && ev.target.tagName === 'A') return; // don't swallow provider link click
      state.provider = p.id;
      renderProviderList();
      syncLlmFields();
    });
    el.appendChild(row);
  });
}

function syncLlmFields() {
  const keyWrap = document.getElementById('llmKeyWrap');
  const baseUrlWrap = document.getElementById('llmBaseUrlWrap');
  const modelInput = document.getElementById('llmModel');
  const keyHelp = document.getElementById('llmKeyHelp');
  const chosen = PROVIDER_OPTIONS.find((p) => p.id === state.provider);

  if (!chosen) {
    keyWrap.hidden = true;
    baseUrlWrap.hidden = true;
    modelInput.value = '';
    return;
  }
  modelInput.placeholder = chosen.defaultModel;
  if (chosen.needsKey) {
    keyWrap.hidden = false;
    baseUrlWrap.hidden = true;
    keyHelp.textContent = `Lim inn nøkkelen fra ${chosen.label}. Den lagres kryptert på serveren.`;
  } else {
    keyWrap.hidden = true;
    baseUrlWrap.hidden = false;
  }
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Backend calls
// ============================================================

async function createFamily(name) {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const me = await res.json().catch(() => ({}));
  if (me && me.user && me.user.familyId) {
    state.familyId = me.user.familyId;
    return true;
  }
  // No family yet — create one and attach via an internal endpoint.
  // MVP: we reuse /api/family PUT after creation. Since there is no
  // "create family" endpoint in phase 7, fall back to a minimal path:
  // create the row via POST /api/onboarding/create-family.
  const r = await fetch('/api/onboarding/create-family', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || 'Kunne ikke opprette familien.');
  }
  const data = await r.json();
  state.familyId = data.family?.id || data.familyId || null;
  return !!state.familyId;
}

async function saveRosterAndProfile() {
  // Members
  for (const m of state.members) {
    if (!m.name.trim()) continue;
    await fetch('/api/family/members', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: m.name.trim(),
        category: m.category,
        portionFactor: Number(m.portionFactor) || categoryFactor(m.category),
      }),
    }).catch(() => {});
  }

  // Allergies / diet text
  const allergies = Array.from(state.allergies);
  if (state.allergyFreeText.trim()) allergies.push(state.allergyFreeText.trim());
  await fetch('/api/profile', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allergies }),
  }).catch(() => {});
}

async function saveLlmConfig() {
  if (!state.provider) return true; // explicit skip
  const chosen = PROVIDER_OPTIONS.find((p) => p.id === state.provider);
  const body = {
    backend: state.provider,
    model: document.getElementById('llmModel').value.trim() || chosen.defaultModel,
  };
  if (chosen.needsKey) {
    const key = document.getElementById('llmApiKey').value.trim();
    if (!key) return true; // allow skip even when a provider is selected
    body.apiKey = key;
  } else {
    const url = document.getElementById('llmBaseUrl').value.trim();
    if (url) body.baseUrl = url;
  }
  const r = await fetch('/api/family/llm', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

// ============================================================
// Step handlers
// ============================================================

async function onNext() {
  setStatus('');
  const next = document.getElementById('nextBtn');
  next.disabled = true;
  try {
    if (state.step === 1) {
      const name = document.getElementById('familyName').value.trim();
      if (!name) {
        setStatus('Skriv inn et familienavn.', 'err');
        return;
      }
      await createFamily(name);
      renderMemberList();
      renderAllergyChips();
      showStep(2);
      return;
    }
    if (state.step === 2) {
      state.allergyFreeText = document.getElementById('allergyFreeText').value || '';
      await saveRosterAndProfile();
      renderProviderList();
      syncLlmFields();
      showStep(3);
      return;
    }
    if (state.step === 3) {
      setStatus('Lagrer …');
      try {
        await saveLlmConfig();
      } catch {
        // Non-fatal — user can reconfigure later.
      }
      window.location.replace('/');
      return;
    }
  } catch (err) {
    setStatus(err.message || 'Noe gikk galt.', 'err');
  } finally {
    next.disabled = false;
  }
}

function onBack() {
  if (state.step > 1) showStep(state.step - 1);
}

// ============================================================
// Bootstrap
// ============================================================

(async function init() {
  // If the user is already in a family, they should not see this wizard.
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) {
    window.location.replace('/login.html');
    return;
  }
  const me = await res.json().catch(() => ({}));
  if (!me || !me.authenticated) {
    window.location.replace('/login.html');
    return;
  }
  if (me.user && me.user.familyId) {
    window.location.replace('/');
    return;
  }

  document.getElementById('addMemberBtn').addEventListener('click', () => {
    state.members.push({ name: '', category: 'adult' });
    renderMemberList();
  });
  document.getElementById('nextBtn').addEventListener('click', onNext);
  document.getElementById('backBtn').addEventListener('click', onBack);
  showStep(1);
})();
