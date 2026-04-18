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

function createOwner(email, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'family-ui-test-token-012345678901' });
});

after(async () => {
  await server.close();
});

// ============================================================
// Static assets
// ============================================================

test('family-ui.js is served to authenticated users', async () => {
  const owner = createOwner('ui-owner@test', 'UI Fam');
  const r = await request(server.baseUrl, 'GET', '/js/family-ui.js', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /renderSettingsFamily/);
  assert.match(r.raw, /renderSettingsFamilyLlm/);
  assert.match(r.raw, /LLM_PROVIDERS/);
  assert.match(r.raw, /createInvite/);
});

test('index.html references the new family settings panels', async () => {
  const owner = createOwner('ui-index@test', 'UI Index');
  const r = await request(server.baseUrl, 'GET', '/', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /id="settingsFamily"/);
  assert.match(r.raw, /id="settingsFamilyLlm"/);
  assert.match(r.raw, /<script src="\/js\/family-ui\.js"><\/script>/);
});

// ============================================================
// Backend endpoints the UI depends on
// ============================================================

test('GET /api/family returns the shape family-ui.js expects', async () => {
  const owner = createOwner('ui-shape@test', 'UI Shape');
  server.repos.family.addMember(owner.familyId, { name: 'Kari', category: 'adult' });
  const r = await request(server.baseUrl, 'GET', '/api/family', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  // family-ui.js reads these exact keys.
  assert.ok(r.body.family.name);
  assert.ok(Array.isArray(r.body.profileMembers));
  assert.ok(Array.isArray(r.body.users));
  assert.ok(typeof r.body.portionSum === 'number');
  const mem = r.body.profileMembers[0];
  assert.ok(typeof mem.portionFactor === 'number');
  assert.ok(typeof mem.category === 'string');
});

test('GET /api/family/llm returns config with hasKey flag', async () => {
  const owner = createOwner('ui-llm@test', 'UI LLM');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    apiKey: 'sk-ui-test',
    updatedBy: owner.userId,
  });
  const r = await request(server.baseUrl, 'GET', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config.backend, 'anthropic');
  assert.strictEqual(r.body.config.hasKey, true);
  // The key must not leak through this endpoint — family-ui.js relies on that.
  assert.ok(!JSON.stringify(r.body).includes('sk-ui-test'));
});
