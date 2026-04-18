'use strict';

// Phase 15 — feedback endpoints integration tests.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { resetRateLimitForTests } = require('../server/http/feedback-routes');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createUser(email, role, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  if (role === 'owner') server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

function insertRecipe(familyId, name) {
  let id;
  runWithFamily(familyId, () => {
    id = server.repos.recipes.insert({
      name,
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Salt', qty: 1, unit: 'ts' }],
    });
  });
  return id;
}

before(async () => {
  server = await startTestServer({ authToken: 'fb-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

beforeEach(() => {
  resetRateLimitForTests();
});

// ============================================================
// POST /api/feedback
// ============================================================

test('POST /api/feedback without auth → 401', async () => {
  const r = await request(server.baseUrl, 'POST', '/api/feedback', {
    body: { category: 'bug', message: 'anonym' },
  });
  assert.strictEqual(r.status, 401);
});

test('POST /api/feedback with invalid category → 400', async () => {
  const u = createUser('fb-cat@test.invalid', 'owner', 'FB Cat Fam');
  const r = await request(server.baseUrl, 'POST', '/api/feedback', {
    headers: { Cookie: u.cookie },
    body: { category: 'bogus', message: 'hi' },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/feedback with empty message → 400', async () => {
  const u = createUser('fb-empty@test.invalid', 'owner', 'FB Empty Fam');
  const r = await request(server.baseUrl, 'POST', '/api/feedback', {
    headers: { Cookie: u.cookie },
    body: { category: 'praise', message: '   ' },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/feedback with oversize message → 400', async () => {
  const u = createUser('fb-big@test.invalid', 'owner', 'FB Big Fam');
  const r = await request(server.baseUrl, 'POST', '/api/feedback', {
    headers: { Cookie: u.cookie },
    body: { category: 'other', message: 'x'.repeat(2001) },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/feedback with valid body → 201 and writes to DB', async () => {
  const u = createUser('fb-ok@test.invalid', 'owner', 'FB OK Fam');
  const r = await request(server.baseUrl, 'POST', '/api/feedback', {
    headers: { Cookie: u.cookie, 'User-Agent': 'Mozilla/5.0 TestBrowser' },
    body: {
      category: 'suggestion',
      message: 'Gjerne mer kylling',
      rating: 5,
      contactOk: true,
      pageUrl: '/meals',
    },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.ok, true);
  assert.ok(r.body.feedback.id > 0);
  assert.strictEqual(r.body.feedback.category, 'suggestion');
  assert.strictEqual(r.body.feedback.rating, 5);

  const row = server.repos._db
    .prepare('SELECT * FROM feedback WHERE id = ?')
    .get(r.body.feedback.id);
  assert.strictEqual(row.family_id, u.familyId);
  assert.strictEqual(row.user_id, u.userId);
  assert.strictEqual(row.message, 'Gjerne mer kylling');
  assert.strictEqual(row.rating, 5);
  assert.strictEqual(row.contact_ok, 1);
  assert.strictEqual(row.page_url, '/meals');
  assert.ok(/TestBrowser/.test(row.user_agent));
});

test('POST /api/feedback with invalid rating → 400', async () => {
  const u = createUser('fb-rate@test.invalid', 'owner', 'FB Rate Fam');
  const r = await request(server.baseUrl, 'POST', '/api/feedback', {
    headers: { Cookie: u.cookie },
    body: { category: 'other', message: 'hei', rating: 9 },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/feedback rate-limits after 10 submissions per user', async () => {
  const u = createUser('fb-rl@test.invalid', 'owner', 'FB RL Fam');
  for (let i = 0; i < 10; i++) {
    const r = await request(server.baseUrl, 'POST', '/api/feedback', {
      headers: { Cookie: u.cookie },
      body: { category: 'other', message: `msg ${i}` },
    });
    assert.strictEqual(r.status, 201, `submission ${i} should succeed`);
  }
  const r11 = await request(server.baseUrl, 'POST', '/api/feedback', {
    headers: { Cookie: u.cookie },
    body: { category: 'other', message: 'past the limit' },
  });
  assert.strictEqual(r11.status, 429);
  assert.ok(r11.headers['retry-after']);
});

// ============================================================
// POST /api/recipe-feedback
// ============================================================

test('POST /api/recipe-feedback without auth → 401', async () => {
  const r = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    body: { recipeId: 1, rating: 1 },
  });
  assert.strictEqual(r.status, 401);
});

test('POST /api/recipe-feedback with invalid rating → 400', async () => {
  const u = createUser('rf-rate@test.invalid', 'owner', 'RF Rate Fam');
  const recipeId = insertRecipe(u.familyId, 'Test Rett');
  const r = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    headers: { Cookie: u.cookie },
    body: { recipeId, rating: 2 },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/recipe-feedback without recipeId → 400', async () => {
  const u = createUser('rf-noid@test.invalid', 'owner', 'RF NoId Fam');
  const r = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    headers: { Cookie: u.cookie },
    body: { rating: 1 },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/recipe-feedback with valid body → 201 and writes to DB', async () => {
  const u = createUser('rf-ok@test.invalid', 'owner', 'RF OK Fam');
  const recipeId = insertRecipe(u.familyId, 'Likt Rett');
  const r = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    headers: { Cookie: u.cookie },
    body: { recipeId, rating: 1, comment: 'Alle likte denne!' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.recipeFeedback.rating, 1);
  const row = server.repos._db
    .prepare('SELECT * FROM recipe_feedback WHERE id = ?')
    .get(r.body.recipeFeedback.id);
  assert.strictEqual(row.family_id, u.familyId);
  assert.strictEqual(row.user_id, u.userId);
  assert.strictEqual(row.recipe_id, recipeId);
  assert.strictEqual(row.rating, 1);
  assert.strictEqual(row.comment, 'Alle likte denne!');
});

test('POST /api/recipe-feedback upserts — last click wins per (user, recipe)', async () => {
  const u = createUser('rf-upsert@test.invalid', 'owner', 'RF Upsert Fam');
  const recipeId = insertRecipe(u.familyId, 'Kylling Tikka');
  const r1 = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    headers: { Cookie: u.cookie },
    body: { recipeId, rating: 1 },
  });
  assert.strictEqual(r1.status, 201);
  const r2 = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    headers: { Cookie: u.cookie },
    body: { recipeId, rating: -1 },
  });
  assert.strictEqual(r2.status, 201);
  const rows = server.repos._db
    .prepare('SELECT * FROM recipe_feedback WHERE family_id = ? AND user_id = ? AND recipe_id = ?')
    .all(u.familyId, u.userId, recipeId);
  assert.strictEqual(rows.length, 1, 'expected a single upserted row');
  assert.strictEqual(rows[0].rating, -1);
});

test('POST /api/recipe-feedback enforces tenant isolation', async () => {
  const u1 = createUser('rf-iso-a@test.invalid', 'owner', 'Family A');
  const u2 = createUser('rf-iso-b@test.invalid', 'owner', 'Family B');
  const recipeIdA = insertRecipe(u1.familyId, 'A-only recipe');
  // u2 cannot rate u1's recipe.
  const r = await request(server.baseUrl, 'POST', '/api/recipe-feedback', {
    headers: { Cookie: u2.cookie },
    body: { recipeId: recipeIdA, rating: 1 },
  });
  assert.strictEqual(r.status, 403);
});
