'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');

function enablePilotBypass() {
  process.env.PILOT_BYPASS = 'true';
}

function disablePilotBypass() {
  delete process.env.PILOT_BYPASS;
}

afterEach(() => {
  disablePilotBypass();
});

// ============================================================
// GET /api/auth/config
// ============================================================

test('GET /api/auth/config returns pilotBypass:false by default', async () => {
  disablePilotBypass();
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pilotBypass, false);
  } finally {
    await server.close();
  }
});

test('GET /api/auth/config returns pilotBypass:true when enabled', async () => {
  enablePilotBypass();
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pilotBypass, true);
  } finally {
    await server.close();
  }
});

// ============================================================
// GET /api/auth/pilot-login — disabled by default
// ============================================================

test('GET /api/auth/pilot-login returns 404 when PILOT_BYPASS is off', async () => {
  disablePilotBypass();
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/pilot-login');
    assert.strictEqual(r.status, 404);
  } finally {
    await server.close();
  }
});

// ============================================================
// GET /api/auth/pilot-login — enabled path
// ============================================================

test('GET /api/auth/pilot-login creates a pilot user and sets a session', async () => {
  enablePilotBypass();
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/pilot-login');
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/');

    const setCookie = r.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
    assert.match(header, /fa_session=/);

    const user = server.repos.auth.findByEmail('pilot@local');
    assert.ok(user, 'pilot user should exist in DB');
    assert.strictEqual(user.email, 'pilot@local');
  } finally {
    await server.close();
  }
});

test('GET /api/auth/pilot-login is idempotent — second call reuses same user', async () => {
  enablePilotBypass();
  const server = await startTestServer();
  try {
    const r1 = await request(server.baseUrl, 'GET', '/api/auth/pilot-login');
    assert.strictEqual(r1.status, 302);
    const userAfterFirst = server.repos.auth.findByEmail('pilot@local');
    assert.ok(userAfterFirst);

    const r2 = await request(server.baseUrl, 'GET', '/api/auth/pilot-login');
    assert.strictEqual(r2.status, 302);
    const userAfterSecond = server.repos.auth.findByEmail('pilot@local');
    assert.strictEqual(
      userAfterSecond.id,
      userAfterFirst.id,
      'second call must not create a new user'
    );
  } finally {
    await server.close();
  }
});
