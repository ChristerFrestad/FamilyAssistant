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

function createUser(email, role) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(`Family-${role}-${email}`)
      .lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { cookie: cookieHeader(sid), familyId: fid, userId: user.id };
}

before(async () => {
  // AUTH_TOKEN is set so anonymous requests are rejected — every call
  // below must carry a session cookie to reach the route handler.
  server = await startTestServer({ authToken: 'role-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

// ============================================================
// Child cannot mutate
// ============================================================

test('child cannot POST /api/pantry/add (403)', async () => {
  const child = createUser('child-pantry@role.test', 'child');
  const r = await request(server.baseUrl, 'POST', '/api/pantry/add?productKey=melk', {
    headers: { Cookie: child.cookie },
    body: { qty: 1, unit: 'l' },
  });
  assert.strictEqual(r.status, 403);
});

test('child cannot PUT /api/meals/swap (403)', async () => {
  const child = createUser('child-meals@role.test', 'child');
  const r = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
    headers: { Cookie: child.cookie },
    body: { weekYear: '2026-20', fromDay: 0, toDay: 1 },
  });
  assert.strictEqual(r.status, 403);
});

test('child cannot POST /api/shopping/generate (403)', async () => {
  const child = createUser('child-shop@role.test', 'child');
  const r = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
    headers: { Cookie: child.cookie },
    body: { weekYear: '2026-20' },
  });
  assert.strictEqual(r.status, 403);
});

test('child cannot POST /api/calendar/events (403)', async () => {
  const child = createUser('child-cal@role.test', 'child');
  const r = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: child.cookie },
    body: { title: 'test', date: '2026-05-01' },
  });
  assert.strictEqual(r.status, 403);
});

test('child cannot PUT /api/profile (403)', async () => {
  const child = createUser('child-profile@role.test', 'child');
  const r = await request(server.baseUrl, 'PUT', '/api/profile', {
    headers: { Cookie: child.cookie },
    body: { members: ['X'] },
  });
  assert.strictEqual(r.status, 403);
});

test('child cannot POST /api/llm/chat (403)', async () => {
  const child = createUser('child-chat@role.test', 'child');
  const r = await request(server.baseUrl, 'POST', '/api/llm/chat', {
    headers: { Cookie: child.cookie },
    body: { message: 'hello' },
  });
  assert.strictEqual(r.status, 403);
});

// ============================================================
// Child can still do low-privilege things
// ============================================================

test('child can GET /api/pantry (200)', async () => {
  const child = createUser('child-read@role.test', 'child');
  const r = await request(server.baseUrl, 'GET', '/api/pantry', {
    headers: { Cookie: child.cookie },
  });
  assert.strictEqual(r.status, 200);
});

test('child can PUT /api/chores/complete (the plan allows it)', async () => {
  const child = createUser('child-chore@role.test', 'child');
  // A non-existent chore schedule is OK — we only care that auth passes and
  // reaches the handler; the handler may then no-op or return its own error.
  const r = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: child.cookie },
    body: { choreId: 999999, weekYear: '2026-20' },
  });
  assert.notStrictEqual(r.status, 403);
});

test('child can PUT /api/notifications/read (any authenticated role)', async () => {
  const child = createUser('child-notif@role.test', 'child');
  const r = await request(server.baseUrl, 'PUT', '/api/notifications/read', {
    headers: { Cookie: child.cookie },
  });
  assert.notStrictEqual(r.status, 403);
});

// ============================================================
// Adult has full mutation access (except owner-only)
// ============================================================

test('adult can POST /api/pantry/add (not 403)', async () => {
  const adult = createUser('adult-pantry@role.test', 'adult');
  server.repos._db
    .prepare(
      "INSERT OR IGNORE INTO products(key, product_name, category, pack_size, unit) VALUES('adult-milk','Milk','meieri',1,'l')"
    )
    .run();
  const r = await request(server.baseUrl, 'POST', '/api/pantry/add?productKey=adult-milk', {
    headers: { Cookie: adult.cookie },
    body: { qty: 1, unit: 'l' },
  });
  assert.notStrictEqual(r.status, 403);
});

test('adult cannot POST /api/settings/env (owner only) — 403', async () => {
  const adult = createUser('adult-env@role.test', 'adult');
  const r = await request(server.baseUrl, 'POST', '/api/settings/env', {
    headers: { Cookie: adult.cookie },
    body: { key: 'FOO', value: 'bar' },
  });
  assert.strictEqual(r.status, 403);
});

test('adult cannot POST /api/integrations/kassal/test (owner only) — 403', async () => {
  const adult = createUser('adult-int@role.test', 'adult');
  const r = await request(server.baseUrl, 'POST', '/api/integrations/kassal/test', {
    headers: { Cookie: adult.cookie },
    body: {},
  });
  assert.strictEqual(r.status, 403);
});

// ============================================================
// Owner can do everything
// ============================================================

test('owner cannot POST /api/settings/env (instance admin only) — 403', async () => {
  const owner = createUser('owner-env@role.test', 'owner');
  const r = await request(server.baseUrl, 'POST', '/api/settings/env', {
    headers: { Cookie: owner.cookie },
    body: { key: 'KASSAL_API_KEY', value: 'kassaltoken12345678' },
  });
  assert.strictEqual(r.status, 403);
});

test('admin can POST /api/settings/env (not 403)', async () => {
  const owner = createUser('admin-env@role.test', 'owner');
  server.repos._db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(owner.userId);
  const r = await request(server.baseUrl, 'POST', '/api/settings/env', {
    headers: { Cookie: owner.cookie },
    body: { key: 'KASSAL_API_KEY', value: 'kassaltoken12345678' },
  });
  assert.notStrictEqual(r.status, 403);
});

test('owner cannot POST /api/integrations/kassal/test (admin only) — 403', async () => {
  const owner = createUser('owner-int@role.test', 'owner');
  const r = await request(server.baseUrl, 'POST', '/api/integrations/kassal/test', {
    headers: { Cookie: owner.cookie },
    body: {},
  });
  assert.strictEqual(r.status, 403);
});

// ============================================================
// Bearer-token fallback grants synthetic owner
// ============================================================

test('bearer-token RPi fallback can hit owner endpoints', async () => {
  const r = await request(server.baseUrl, 'PUT', '/api/family', {
    token: 'role-test-token-abcdef0123456789',
    body: { name: 'Local family' },
  });
  assert.notStrictEqual(r.status, 401);
  assert.notStrictEqual(r.status, 403);
});
