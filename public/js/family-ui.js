/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// Family + per-family LLM settings panels (phase 12).
//
// Renders two panels inside the settings grid:
//   - #settingsFamilyBody      members, login users, invitations,
//                              transfer/leave/delete family
//   - #settingsFamilyLlmBody   LLM backend + model + key + baseUrl +
//                              test button + provider links

// ============================================================
// LLM provider catalogue — ready for affiliate-link swaps later.
// ============================================================

const LLM_PROVIDERS = [
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
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    url: 'https://github.com/ggerganov/llama.cpp',
    defaultModel: 'local',
    needsKey: false,
  },
];

// ============================================================
// Family panel
// ============================================================

async function renderSettingsFamily() {
  const body = document.getElementById('settingsFamilyBody');
  if (!body) return;
  setHTML(body, h`<div class="panel-row-label" style="opacity:0.6">Laster…</div>`);

  const data = await api('/api/family');
  if (!data || !data.family) {
    setHTML(body, h`<div class="panel-row-label">Ikke i en familie ennå.</div>`);
    return;
  }

  const isOwner = currentUser && currentUser.role === 'owner';
  const members = (data.profileMembers || [])
    .map(
      (m) =>
        h`<li class="family-member">
           <span class="mem-name">${m.name}</span>
           <span class="mem-meta">${m.category} · ${m.portionFactor}×</span>
         </li>`
    )
    .reduce((acc, cur) => new RawHTML(acc.value + cur.value), new RawHTML(''));

  const users = (data.users || [])
    .map(
      (u) =>
        h`<li class="family-user">
           <span class="mem-name">${u.name || u.email}</span>
           <span class="mem-meta">${u.role}${u.lastSeenAt ? ' · sist aktiv ' + String(u.lastSeenAt).slice(0, 10) : ''}</span>
           ${isOwner && currentUser.id !== u.id ? raw(`<button class="link-btn" onclick="removeFamilyUser(${u.id})">Fjern</button>`) : raw('')}
           ${isOwner && currentUser.id !== u.id && u.role !== 'owner' ? raw(`<button class="link-btn" onclick="transferOwnership(${u.id})">Gjør til eier</button>`) : raw('')}
         </li>`
    )
    .reduce((acc, cur) => new RawHTML(acc.value + cur.value), new RawHTML(''));

  const ownerActions = isOwner
    ? h`
        <div class="family-owner-actions">
          <button class="btn btn-ghost" onclick="renameFamilyPrompt('${escapeHtml(data.family.name)}')">Endre familienavn</button>
          <button class="btn btn-danger" onclick="deleteFamilyPrompt('${escapeHtml(data.family.name)}')">Slett familien</button>
        </div>
      `
    : raw('');

  const leaveBtn =
    !isOwner && currentUser
      ? h`<button class="btn btn-ghost" onclick="leaveFamily()">Forlat familien</button>`
      : raw('');

  setHTML(
    body,
    h`
      <div class="family-head">
        <div>
          <div class="family-name">${data.family.name}</div>
          <div class="family-meta">Porsjoner: ${data.portionSum || 0} · ${data.profileMembers?.length || 0} i roster · ${data.users?.length || 0} innloggede</div>
        </div>
      </div>

      <div class="family-col">
        <div class="panel-subheader">Roster (porsjonsskalering)</div>
        <ul class="family-list">${raw(members.value)}</ul>
        ${isOwner || (currentUser && currentUser.role === 'adult') ? raw('<div class="family-add-member"><input type="text" id="newMemberName" placeholder="Nytt navn" /><select id="newMemberCategory"><option value="adult">Voksen</option><option value="teen">Ungdom</option><option value="child">Barn</option></select><button class="btn" onclick="addFamilyMember()">Legg til</button></div>') : ''}
      </div>

      <div class="family-col">
        <div class="panel-subheader">Innloggede brukere</div>
        <ul class="family-list">${raw(users.value)}</ul>
      </div>

      <div class="family-col" id="familyInviteCol">
        <div class="panel-subheader">Invitasjoner</div>
        ${isOwner ? raw('<div class="family-invite-form"><select id="inviteRole"><option value="adult">Voksen</option><option value="child">Barn</option></select><button class="btn" onclick="createInvite()">Opprett invitasjons-URL</button></div>') : raw('<div class="panel-row-label" style="opacity:0.6">Bare eier kan invitere.</div>')}
        <ul class="invite-list" id="inviteList"></ul>
      </div>

      ${ownerActions}
      ${leaveBtn}
    `
  );

  if (isOwner) refreshInviteList();
}

async function refreshInviteList() {
  const ul = document.getElementById('inviteList');
  if (!ul) return;
  const data = await api('/api/family/invitations');
  const invs = data?.invitations || [];
  if (invs.length === 0) {
    setHTML(ul, h`<li class="panel-row-label" style="opacity:0.6">Ingen aktive invitasjoner.</li>`);
    return;
  }
  const rows = invs
    .map(
      (i) =>
        h`<li class="invite-row">
           <code class="invite-url">${i.url}</code>
           <span class="mem-meta">${i.assignedRole} · utløper ${String(i.expiresAt).slice(0, 10)}</span>
           <button class="link-btn" onclick="copyInviteUrl('${escapeHtml(i.url)}')">Kopier</button>
           <button class="link-btn danger" onclick="revokeInvite(${i.id})">Tilbakekall</button>
         </li>`
    )
    .reduce((acc, cur) => new RawHTML(acc.value + cur.value), new RawHTML(''));
  setHTML(ul, rows);
}

async function addFamilyMember() {
  const nameEl = document.getElementById('newMemberName');
  const catEl = document.getElementById('newMemberCategory');
  if (!nameEl || !nameEl.value.trim()) {
    showToast('Skriv inn et navn først.', 'warn');
    return;
  }
  const res = await api('/api/family/members', {
    method: 'POST',
    body: { name: nameEl.value.trim(), category: catEl.value },
  });
  if (res && res.ok) {
    nameEl.value = '';
    renderSettingsFamily();
  }
}

async function createInvite() {
  const sel = document.getElementById('inviteRole');
  const res = await api('/api/family/invitations', {
    method: 'POST',
    body: { role: sel ? sel.value : 'adult' },
  });
  if (res?.ok) {
    showToast('Invitasjons-URL opprettet.', 'info');
    refreshInviteList();
  }
}

async function revokeInvite(id) {
  if (!confirm('Tilbakekall denne invitasjonen?')) return;
  const res = await api(`/api/family/invitations/${id}`, { method: 'DELETE' });
  if (res?.ok) refreshInviteList();
}

function copyInviteUrl(url) {
  try {
    navigator.clipboard.writeText(url);
    showToast('Kopiert! Del lenken med den du vil invitere.', 'info');
  } catch {
    showToast('Kunne ikke kopiere — marker URL-en manuelt.', 'warn');
  }
}

async function removeFamilyUser(userId) {
  if (!confirm('Fjern denne brukeren fra familien?')) return;
  const res = await api(`/api/family/members/users/${userId}`, { method: 'DELETE' });
  if (res?.ok) renderSettingsFamily();
}

async function transferOwnership(userId) {
  if (!confirm('Overfør eierskap til denne brukeren? Du blir selv voksen.')) return;
  const res = await api('/api/family/transfer-ownership', {
    method: 'POST',
    body: { userId },
  });
  if (res?.ok) {
    showToast('Eierskap overført.', 'info');
    // Reload to refresh role-gated UI.
    setTimeout(() => window.location.reload(), 600);
  }
}

async function leaveFamily() {
  if (!confirm('Forlat familien? Du mister tilgang til all familie-data.')) return;
  const res = await api('/api/family/leave', { method: 'POST' });
  if (res?.ok) {
    showToast('Du har forlatt familien.', 'info');
    setTimeout(() => window.location.reload(), 600);
  }
}

async function renameFamilyPrompt(currentName) {
  const name = prompt('Nytt familienavn:', currentName);
  if (!name || name === currentName) return;
  const res = await api('/api/family', { method: 'PUT', body: { name } });
  if (res?.ok) renderSettingsFamily();
}

async function deleteFamilyPrompt(currentName) {
  const confirmationName = prompt(`Skriv familienavnet "${currentName}" for å bekrefte sletting:`);
  if (!confirmationName) return;
  const res = await api('/api/family', {
    method: 'DELETE',
    body: { confirmationName },
  });
  if (res?.ok) {
    showToast('Familien er slettet.', 'info');
    setTimeout(() => window.location.replace('/login.html'), 600);
  }
}

// ============================================================
// Per-family LLM config panel
// ============================================================

async function renderSettingsFamilyLlm() {
  const body = document.getElementById('settingsFamilyLlmBody');
  if (!body) return;
  setHTML(body, h`<div class="panel-row-label" style="opacity:0.6">Laster…</div>`);

  const data = await api('/api/family/llm');
  const config = data?.config || null;
  const isOwner = currentUser && currentUser.role === 'owner';

  const backendOptions = LLM_PROVIDERS.map(
    (p) =>
      h`<option value="${p.id}" ${config && config.backend === p.id ? 'selected' : ''}>
          ${p.label}
        </option>`
  ).reduce((acc, cur) => new RawHTML(acc.value + cur.value), new RawHTML(''));

  const providerLinks = LLM_PROVIDERS.map(
    (p) =>
      h`<li>
          <a href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">${p.label}</a>
          ${p.needsKey ? raw('<span class="mem-meta">API-nøkkel kreves</span>') : raw('<span class="mem-meta">ingen nøkkel</span>')}
        </li>`
  ).reduce((acc, cur) => new RawHTML(acc.value + cur.value), new RawHTML(''));

  const currentBackend = (config && config.backend) || 'anthropic';
  const needsBaseUrl = currentBackend === 'ollama' || currentBackend === 'llamacpp';

  setHTML(
    body,
    h`
      <div class="panel-row-label" style="opacity:0.75;margin-bottom:0.75rem;">
        Hver familie bruker sin egen AI-motor og betaler for egen bruk.
      </div>

      <div class="llm-field">
        <label>Backend</label>
        <select id="famLlmBackend" onchange="renderSettingsFamilyLlm()">
          ${raw(backendOptions.value)}
        </select>
      </div>

      <div class="llm-field">
        <label>Modell</label>
        <input type="text" id="famLlmModel" value="${escapeHtml(config?.model || '')}" placeholder="${escapeHtml((LLM_PROVIDERS.find((p) => p.id === currentBackend) || {}).defaultModel || '')}" />
      </div>

      ${needsBaseUrl ? raw(`<div class="llm-field"><label>Base URL</label><input type="text" id="famLlmBaseUrl" value="${escapeHtml(config?.baseUrl || '')}" placeholder="http://localhost:11434" /></div>`) : raw('')}

      ${needsBaseUrl ? raw('') : raw(`<div class="llm-field"><label>API-nøkkel</label><input type="password" id="famLlmApiKey" value="" placeholder="${config?.hasKey ? '••••••• (lagret)' : 'Lim inn nøkkelen din'}" autocomplete="off" /><div class="panel-row-label" style="font-size:0.78rem;opacity:0.7;">La feltet stå tomt for å beholde eksisterende nøkkel. Skriv en bindestrek (-) for å fjerne.</div></div>`)}

      <div class="llm-actions">
        ${isOwner ? raw('<button class="btn primary" onclick="saveFamilyLlm()">Lagre</button>') : raw('<span class="mem-meta">Bare eier kan endre.</span>')}
        <button class="btn btn-ghost" onclick="testFamilyLlm()">Test tilkobling</button>
        <span id="famLlmStatus" class="api-key-status"></span>
      </div>

      <details class="llm-providers">
        <summary>AI-leverandører (åpne konto)</summary>
        <ul class="provider-list">${raw(providerLinks.value)}</ul>
      </details>
    `
  );
}

async function saveFamilyLlm() {
  const backend = document.getElementById('famLlmBackend')?.value;
  const model = document.getElementById('famLlmModel')?.value.trim() || null;
  const baseUrl = document.getElementById('famLlmBaseUrl')?.value.trim() || null;
  const keyField = document.getElementById('famLlmApiKey');
  let apiKey;
  if (keyField) {
    const v = keyField.value;
    if (v === '')
      apiKey = undefined; // keep existing
    else if (v === '-')
      apiKey = ''; // explicit clear
    else apiKey = v;
  }
  const status = document.getElementById('famLlmStatus');
  if (status) {
    status.textContent = 'Lagrer…';
    status.className = 'api-key-status warn';
  }
  const res = await api('/api/family/llm', {
    method: 'PUT',
    body: { backend, model, baseUrl, apiKey },
  });
  if (res?.ok) {
    if (status) {
      status.textContent = '✓ Lagret';
      status.className = 'api-key-status ok';
    }
    if (keyField) keyField.value = '';
    setTimeout(renderSettingsFamilyLlm, 600);
  } else if (status) {
    status.textContent = '✗ Kunne ikke lagre';
    status.className = 'api-key-status err';
  }
}

async function testFamilyLlm() {
  const status = document.getElementById('famLlmStatus');
  if (status) {
    status.textContent = 'Tester…';
    status.className = 'api-key-status warn';
  }
  const res = await api('/api/family/llm/test', { method: 'POST', body: {} });
  if (!status) return;
  if (res?.ok) {
    status.textContent = `✓ OK (${res.backend}${res.model ? ' · ' + res.model : ''})`;
    status.className = 'api-key-status ok';
  } else if (res?.error === 'llm_not_configured') {
    status.textContent = '✗ Ikke konfigurert — lagre backend og nøkkel først';
    status.className = 'api-key-status err';
  } else {
    status.textContent = `✗ ${res?.detail || 'Feilet'}`;
    status.className = 'api-key-status err';
  }
}
