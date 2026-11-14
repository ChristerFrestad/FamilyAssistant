'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

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
  return { familyId: fid, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'instance-token-not-for-ha-0123456789' });
});

after(async () => {
  await server.close();
});

test('owner creates a scoped token, sees it once, and can revoke it', async () => {
  const owner = createUser('owner-token@example.com', 'owner', 'Token A');
  const created = await request(server.baseUrl, 'POST', '/api/api-tokens', {
    headers: { Cookie: owner.cookie },
    body: { name: 'Vegg', scopes: ['read', 'meals:cooked'] },
  });
  assert.equal(created.status, 200);
  assert.match(created.body.token, /^fa_/);
  assert.deepEqual(created.body.scopes, ['read', 'meals:cooked']);

  const listed = await request(server.baseUrl, 'GET', '/api/api-tokens', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(created.body.token), false);
  assert.equal(listed.body.tokens[0].name, 'Vegg');

  const admin = await request(server.baseUrl, 'POST', '/api/api-tokens', {
    headers: { Cookie: owner.cookie },
    body: { name: 'Admin', scopes: ['admin'] },
  });
  assert.equal(admin.status, 400);

  const child = createUser('child-token@example.com', 'child', 'Token Child');
  const denied = await request(server.baseUrl, 'POST', '/api/api-tokens', {
    headers: { Cookie: child.cookie },
    body: { name: 'Nei', scopes: ['read'] },
  });
  assert.equal(denied.status, 403);

  const today = await request(server.baseUrl, 'GET', '/api/today', {
    headers: { Authorization: `Bearer ${created.body.token}` },
  });
  assert.equal(today.status, 200);
  assert.equal(today.body.weekYear.length > 0, true);

  const recipes = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Authorization: `Bearer ${created.body.token}` },
  });
  assert.equal(recipes.status, 403);

  const revoked = await request(server.baseUrl, 'DELETE', `/api/api-tokens/${created.body.id}`, {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(revoked.status, 200);
  const after = await request(server.baseUrl, 'GET', '/api/today', {
    headers: { Authorization: `Bearer ${created.body.token}` },
  });
  assert.equal(after.status, 401);
});

test('a token only sees its own family', async () => {
  const a = createUser('iso-a@example.com', 'owner', 'Iso A');
  const b = createUser('iso-b@example.com', 'owner', 'Iso B');
  runWithFamily(b.familyId, () => {
    const recipeId = server.repos.recipes.insert({
      name: 'Hemmelig middag',
      category: 'rask',
      servings: 2,
      sourceType: 'manual',
      ingredients: [{ name: 'salt', qty: null, unit: null }],
    });
    const week = '2094-W10';
    server.repos.mealPlans.setRecipe(week, 0, recipeId, 'planned');
  });
  const created = await request(server.baseUrl, 'POST', '/api/api-tokens', {
    headers: { Cookie: a.cookie },
    body: { name: 'A', scopes: ['read'] },
  });
  const today = await request(server.baseUrl, 'GET', '/api/today', {
    headers: { Authorization: `Bearer ${created.body.token}` },
  });
  assert.equal(today.status, 200);
  assert.equal(JSON.stringify(today.body).includes('Hemmelig middag'), false);

  const stolen = await request(server.baseUrl, 'DELETE', `/api/api-tokens/${created.body.id}`, {
    headers: { Cookie: b.cookie },
  });
  assert.equal(stolen.status, 404);
});
