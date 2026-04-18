/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// Client-side authentication helpers.
// Boots the app: fetches /api/auth/me, redirects unauthenticated
// cloud users to /login.html, and wires the header username + logout
// button to the same endpoint set the backend exposes.
//
// The RPi bearer-token path and the legacy no-auth dev path both
// return `authenticated: true` with a synthetic user, so this module
// never kicks those deployments to the login page.

let currentUser = null;

async function fetchAuthMe() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function renderUserBadge() {
  const el = document.getElementById('userBadge');
  if (!el) return;
  if (!currentUser) {
    el.style.display = 'none';
    return;
  }
  const name = escapeHtml(currentUser.name || currentUser.email || 'Bruker');
  const role = escapeHtml(currentUser.role || '');
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  setHTML(
    el,
    h`
      <button class="user-chip" id="userChipBtn" type="button" title="${name} (${role})">
        <span class="user-avatar" aria-hidden="true">${initials || '👤'}</span>
        <span class="user-name">${name}</span>
      </button>
      <button class="logout-btn" id="logoutBtn" type="button" title="Logg ut">↪</button>
    `
  );
  el.style.display = '';
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    /* even if the server round-trip fails, go to login */
  }
  currentUser = null;
  window.location.replace('/login.html');
}

async function bootAuth() {
  const me = await fetchAuthMe();
  if (me && me.authenticated) {
    currentUser = me.user || null;
    // Authenticated but no family yet → onboarding wizard.
    // Synthetic local/bearer users are hard-coded to family_id=1 so they
    // skip this redirect automatically.
    if (
      currentUser &&
      !currentUser.synthetic &&
      !currentUser.familyId &&
      !/\/onboarding\.html/.test(window.location.pathname)
    ) {
      window.location.replace('/onboarding.html');
      return false;
    }
    renderUserBadge();
    return true;
  }
  // Anonymous on a cloud deployment → go to login.
  window.location.replace('/login.html');
  return false;
}

// Invoked by other modules (core.js fetch interceptor) when an API call
// returns 401 — clears local state and sends the user to login.
function redirectToLogin() {
  currentUser = null;
  if (!/\/login\.html/.test(window.location.pathname)) {
    window.location.replace('/login.html');
  }
}
