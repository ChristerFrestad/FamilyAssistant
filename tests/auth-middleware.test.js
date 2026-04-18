'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

// ============================================================
// Dev mode (no AUTH_TOKEN, no session) — legacy behaviour
// ============================================================

test('dev mode without AUTH_TOKEN: /api/auth/me returns synthetic local user', async () => {
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/me');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.authenticated, true);
    assert.strictEqual(r.body.user.synthetic, true);
    assert.strictEqual(r.body.user.familyId, 1);
    assert.strictEqual(r.body.user.role, 'owner');
  } finally {
    await server.close();
  }
});

test('dev mode without AUTH_TOKEN: /health is public', async () => {
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/health');
    assert.strictEqual(r.status, 200);
  } finally {
    await server.close();
  }
});

// ============================================================
// AUTH_TOKEN present — bearer auth mandatory on /api/*
// ============================================================

test('AUTH_TOKEN set: missing Bearer on /api/* returns 401', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const r = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.strictEqual(r.status, 401);
  } finally {
    await server.close();
  }
});

test('AUTH_TOKEN set: wrong Bearer on /api/* returns 401', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const r = await request(server.baseUrl, 'GET', '/api/meals/current', {
      headers: { Authorization: 'Bearer wrong' },
    });
    assert.strictEqual(r.status, 401);
  } finally {
    await server.close();
  }
});

test('AUTH_TOKEN set: correct Bearer attaches synthetic local user', async () => {
  const token = 'secret-token-1234567890abcdef';
  const server = await startTestServer({ authToken: token });
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/me', { token });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.authenticated, true);
    assert.strictEqual(r.body.user.synthetic, true);
    assert.strictEqual(r.body.user.role, 'owner');
    assert.strictEqual(r.body.user.familyId, 1);
  } finally {
    await server.close();
  }
});

// ============================================================
// Session cookie behaviour
// ============================================================

test('valid session cookie attaches the real user', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const crypto = require('node:crypto');
    const user = server.repos.auth.createUser({
      email: 'alice@example.com',
      name: 'Alice',
    });
    server.repos.auth.setFamily(user.id, 1, 'owner');
    const sid = crypto.randomBytes(16).toString('hex');
    server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

    const cookie = serializeCookie('fa_session', sid, { httpOnly: true, path: '/' });
    const r = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: cookie.split(';')[0] },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.authenticated, true);
    assert.strictEqual(r.body.user.email, 'alice@example.com');
    assert.strictEqual(r.body.user.role, 'owner');
    assert.strictEqual(r.body.user.synthetic, false);
  } finally {
    await server.close();
  }
});

test('expired session cookie falls through to 401', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const crypto = require('node:crypto');
    const user = server.repos.auth.createUser({
      email: 'bob@example.com',
      name: 'Bob',
    });
    server.repos.auth.setFamily(user.id, 1, 'adult');
    const sid = crypto.randomBytes(16).toString('hex');
    server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: -1 });

    const r = await request(server.baseUrl, 'GET', '/api/meals/current', {
      headers: { Cookie: `fa_session=${sid}` },
    });
    assert.strictEqual(r.status, 401);
  } finally {
    await server.close();
  }
});

// ============================================================
// Soft-auth paths remain accessible to anonymous callers
// ============================================================

test('/api/auth/me returns authenticated:false when AUTH_TOKEN is set but no credentials are supplied', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/me');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.authenticated, false);
    assert.strictEqual(r.body.user, null);
  } finally {
    await server.close();
  }
});

test('/api/auth/google/start returns 503 when Google is not configured', async () => {
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/google/start');
    assert.strictEqual(r.status, 503);
  } finally {
    await server.close();
  }
});

test('/api/auth/logout clears session cookie even without credentials', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const r = await request(server.baseUrl, 'POST', '/api/auth/logout', { body: {} });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    const setCookie = r.headers['set-cookie'];
    assert.ok(setCookie);
    const header = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
    assert.match(header, /fa_session=/);
    assert.match(header, /Max-Age=0/);
  } finally {
    await server.close();
  }
});

// ============================================================
// Logout with active session deletes the row + clears cookie
// ============================================================

test('logout with active session deletes it from the sessions table', async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const crypto = require('node:crypto');
    const user = server.repos.auth.createUser({ email: 'carol@example.com', name: 'Carol' });
    server.repos.auth.setFamily(user.id, 1, 'adult');
    const sid = crypto.randomBytes(16).toString('hex');
    server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

    const r = await request(server.baseUrl, 'POST', '/api/auth/logout', {
      headers: { Cookie: `fa_session=${sid}` },
      body: {},
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(server.repos.auth.getValidSession(sid), null);
  } finally {
    await server.close();
  }
});

test("/api/auth/sessions lists the caller's sessions and marks current one", async () => {
  const server = await startTestServer({ authToken: 'secret-token-1234567890abcdef' });
  try {
    const crypto = require('node:crypto');
    const user = server.repos.auth.createUser({ email: 'dave@example.com', name: 'Dave' });
    server.repos.auth.setFamily(user.id, 1, 'adult');
    const current = crypto.randomBytes(16).toString('hex');
    const other = crypto.randomBytes(16).toString('hex');
    server.repos.auth.createSession({ id: current, userId: user.id, ttlDays: 30 });
    server.repos.auth.createSession({ id: other, userId: user.id, ttlDays: 30 });

    const r = await request(server.baseUrl, 'GET', '/api/auth/sessions', {
      headers: { Cookie: `fa_session=${current}` },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.sessions.length, 2);
    const currentRow = r.body.sessions.find((s) => s.id === current);
    const otherRow = r.body.sessions.find((s) => s.id === other);
    assert.strictEqual(currentRow.current, true);
    assert.strictEqual(otherRow.current, false);
  } finally {
    await server.close();
  }
});
