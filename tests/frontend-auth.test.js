'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

before(async () => {
  server = await startTestServer({ authToken: 'frontend-test-token-0123456789abcdef' });
});

after(async () => {
  await server.close();
});

// ============================================================
// /login.html is served to anonymous visitors
// ============================================================

test('GET /login.html serves the static login page without auth', async () => {
  const r = await request(server.baseUrl, 'GET', '/login.html');
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /Logg inn med Google/);
  assert.match(r.raw, /magic-link/i);
  assert.match(r.raw, /personvernerkl/i);
});

test('login.html points Google button at /api/auth/google/start', async () => {
  const r = await request(server.baseUrl, 'GET', '/login.html');
  assert.match(r.raw, /href="\/api\/auth\/google\/start"/);
});

// ============================================================
// auth.js client helper is served and wires the known endpoints
// ============================================================

test('auth.js client script is served and references the backend endpoints', async () => {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Auth JS Family')
      .lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email: 'authjs-user@test', name: 'Auth JS' });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

  const r = await request(server.baseUrl, 'GET', '/js/auth.js', {
    headers: { Cookie: cookieHeader(sid) },
  });
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /\/api\/auth\/me/);
  assert.match(r.raw, /\/api\/auth\/logout/);
  assert.match(r.raw, /login\.html/);
  assert.match(r.raw, /credentials:\s*'include'/);
});

// ============================================================
// index.html is still gated behind auth — anonymous users get 401
// (the client-side bootAuth then redirects to /login.html on its own).
//
// Pre-2026-05-04 this used the bare "/" path. The root-redirect fix
// landed in fix/root-redirect-to-v2 funnels every GET / into /v2/ before
// auth runs, so to keep this test exercising the legacy v1 auth-gate
// (its real purpose) we now ask for the explicit /index.html path.
// Test INTENT is unchanged — auth gate on legacy v1 entry-point.
// CLAUDE.md DEL 6.1: Christer explicitly approved this URL substitution
// in the 2026-05-04 BUG 2 fix instruction ("Alle må passere").
// ============================================================

test('index.html is behind auth when AUTH_TOKEN is configured', async () => {
  const r = await request(server.baseUrl, 'GET', '/index.html');
  assert.strictEqual(r.status, 401);
});

test('index.html is served to authenticated users', async () => {
  // Create a user + session so the cookie passes through authenticate().
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Frontend Auth Family')
      .lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email: 'fe-user@test', name: 'FE User' });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

  const r = await request(server.baseUrl, 'GET', '/index.html', {
    headers: { Cookie: cookieHeader(sid) },
  });
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /Familieassistenten/);
  assert.match(r.raw, /id="userBadge"/);
  assert.match(r.raw, /<script src="\/js\/auth\.js"><\/script>/);
});

// ============================================================
// /api/auth/me contract the client relies on
// ============================================================

test('/api/auth/me returns authenticated=false for anonymous visitors', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/auth/me');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.authenticated, false);
  assert.strictEqual(r.body.user, null);
});

test('/api/auth/me returns the user for a valid session cookie', async () => {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Me-Badge Family')
      .lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email: 'me-badge@test', name: 'Me Badge' });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

  const r = await request(server.baseUrl, 'GET', '/api/auth/me', {
    headers: { Cookie: cookieHeader(sid) },
  });
  assert.strictEqual(r.body.authenticated, true);
  assert.strictEqual(r.body.user.email, 'me-badge@test');
  assert.strictEqual(r.body.user.name, 'Me Badge');
  assert.strictEqual(r.body.user.role, 'owner');
  assert.strictEqual(r.body.user.synthetic, false);
});
