'use strict';

// Sprint 3 / Fase 1e — POST /api/auth/onboarding/complete
//
// The endpoint marks the calling user as having finished the
// frontend onboarding wizard. Together with the magic-link
// verify-handler's onboarding-aware redirect (covered in
// auth-magic-link.test.js), it lets the AuthContext on the
// frontend know whether to route a returning user to the main
// dashboard or back into the wizard.
//
// Tests below cover:
//   * 401 when no session
//   * 401 when session is the synthetic LOCAL_USER (PILOT_BYPASS
//     uses a real DB user, so this is exercised by the LOCAL_USER
//     case alone — auth-token bearer auth)
//   * Happy path: starts at 0, becomes 1, /api/auth/me reflects it
//   * Idempotent: calling twice keeps the value at 1
//   * /api/auth/me reports onboardingCompleted in its payload
//     (default 0 for fresh users → returns false, after toggle → true)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');

async function loginViaPilotBypass(server) {
  // Enable pilot-bypass for this server instance so we have a
  // session-cookie path that creates a real DB user. The user
  // the bypass returns is keyed on PILOT_EMAIL='pilot@local'.
  process.env.PILOT_BYPASS = 'true';
  const r = await request(server.baseUrl, 'GET', '/api/auth/pilot-login');
  delete process.env.PILOT_BYPASS;
  const setCookie = r.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
  const sessionMatch = /fa_session=([^;]+)/.exec(header || '');
  return sessionMatch ? sessionMatch[1] : null;
}

test('POST /api/auth/onboarding/complete returns 401 without a session', async () => {
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      body: {},
    });
    // The endpoint sits behind authenticate-middleware in non-bypass
    // mode. A request without a cookie or bearer token reaches the
    // handler with ctx.user = null which the handler explicitly
    // rejects.
    assert.equal(r.status, 401);
  } finally {
    await server.close();
  }
});

test('happy path: onboarding flag flips from 0 to 1 and /me reflects it', async () => {
  process.env.PILOT_BYPASS = 'true';
  const server = await startTestServer();
  try {
    const sessionId = await loginViaPilotBypass(server);
    assert.ok(sessionId, 'pilot bypass should issue a session cookie');

    // Sanity: /me reports onboardingCompleted=false for the fresh
    // pilot user (migration 021 default = 0).
    const me1 = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: `fa_session=${sessionId}` },
    });
    assert.equal(me1.status, 200);
    assert.equal(me1.body.user.onboardingCompleted, false);

    // Mark complete.
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: `fa_session=${sessionId}` },
      body: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.user.onboardingCompleted, true);

    // Second /me confirms persistence — the next page-load will
    // read this value to decide whether to send the user to the
    // dashboard or back to the onboarding wizard.
    const me2 = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: `fa_session=${sessionId}` },
    });
    assert.equal(me2.body.user.onboardingCompleted, true);
  } finally {
    delete process.env.PILOT_BYPASS;
    await server.close();
  }
});

test('idempotent: calling /onboarding/complete twice keeps the flag at true', async () => {
  process.env.PILOT_BYPASS = 'true';
  const server = await startTestServer();
  try {
    const sessionId = await loginViaPilotBypass(server);

    const first = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: `fa_session=${sessionId}` },
      body: {},
    });
    const second = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: `fa_session=${sessionId}` },
      body: {},
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.user.onboardingCompleted, true);
    assert.equal(second.body.user.onboardingCompleted, true);
  } finally {
    delete process.env.PILOT_BYPASS;
    await server.close();
  }
});
