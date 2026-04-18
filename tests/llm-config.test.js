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

function createUser(email, role, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  if (role === 'owner') server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'llm-test-token-0123456789abcdef' });
});

after(async () => {
  await server.close();
});

// ============================================================
// Crypto + repo roundtrip
// ============================================================

test('crypto roundtrip preserves the plaintext', () => {
  const { encrypt, decrypt } = require('../server/auth/crypto');
  const plain = 'sk-very-secret-key-1234567890';
  const enc = encrypt(plain);
  assert.notStrictEqual(enc, plain);
  assert.strictEqual(decrypt(enc), plain);
});

test('tampered ciphertext fails decryption', () => {
  const { encrypt, decrypt } = require('../server/auth/crypto');
  const enc = encrypt('hello');
  const tampered = enc.slice(0, -4) + 'AAAA';
  assert.throws(() => decrypt(tampered));
});

test('repo upsert stores key as ciphertext, never as plaintext', () => {
  const owner = createUser('repo-enc@llm.test', 'owner', 'Repo Enc Family');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    apiKey: 'sk-ant-plaintext-should-not-be-stored',
    updatedBy: owner.userId,
  });
  const row = server.repos.llmConfig.getForFamily(owner.familyId);
  assert.ok(row.api_key_encrypted);
  assert.notStrictEqual(row.api_key_encrypted, 'sk-ant-plaintext-should-not-be-stored');
  assert.ok(!row.api_key_encrypted.includes('plaintext'));
});

// ============================================================
// GET /api/family/llm
// ============================================================

test('GET /api/family/llm returns null config when unset', async () => {
  const owner = createUser('get-unset@llm.test', 'owner', 'Get Unset');
  const r = await request(server.baseUrl, 'GET', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config, null);
});

test('GET /api/family/llm returns hasKey flag, never the key', async () => {
  const owner = createUser('get-has@llm.test', 'owner', 'Get HasKey');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-plain',
    updatedBy: owner.userId,
  });
  const r = await request(server.baseUrl, 'GET', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config.backend, 'openai');
  assert.strictEqual(r.body.config.model, 'gpt-4o-mini');
  assert.strictEqual(r.body.config.hasKey, true);
  // The key must not appear anywhere in the response body.
  assert.ok(!JSON.stringify(r.body).includes('sk-plain'));
});

// ============================================================
// PUT /api/family/llm
// ============================================================

test('PUT /api/family/llm rejects unsupported backend', async () => {
  const owner = createUser('put-bad@llm.test', 'owner', 'PUT bad');
  const r = await request(server.baseUrl, 'PUT', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
    body: { backend: 'gemini', apiKey: 'sk' },
  });
  assert.strictEqual(r.status, 400);
});

test('PUT /api/family/llm owner can set a new config', async () => {
  const owner = createUser('put-ok@llm.test', 'owner', 'PUT OK');
  const r = await request(server.baseUrl, 'PUT', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
    body: {
      backend: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      apiKey: 'sk-ant-xxx',
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config.backend, 'anthropic');
  assert.strictEqual(r.body.config.hasKey, true);
});

test('PUT /api/family/llm rejects adult (owner only)', async () => {
  const adult = createUser('put-adult@llm.test', 'adult', 'PUT Adult');
  const r = await request(server.baseUrl, 'PUT', '/api/family/llm', {
    headers: { Cookie: adult.cookie },
    body: { backend: 'anthropic', apiKey: 'x' },
  });
  assert.strictEqual(r.status, 403);
});

test('PUT with apiKey undefined keeps the existing key', async () => {
  const owner = createUser('put-keep@llm.test', 'owner', 'PUT Keep');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'anthropic',
    apiKey: 'sk-original',
    updatedBy: owner.userId,
  });
  const r = await request(server.baseUrl, 'PUT', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
    body: { backend: 'anthropic', model: 'claude-sonnet-4-6' }, // no apiKey
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config.hasKey, true);
  assert.strictEqual(r.body.config.model, 'claude-sonnet-4-6');
});

test("PUT with apiKey='' clears the stored key", async () => {
  const owner = createUser('put-clear@llm.test', 'owner', 'PUT Clear');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'anthropic',
    apiKey: 'sk-original',
    updatedBy: owner.userId,
  });
  const r = await request(server.baseUrl, 'PUT', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
    body: { backend: 'anthropic', apiKey: '' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config.hasKey, false);
});

test('PUT for ollama does not require apiKey and stores baseUrl', async () => {
  const owner = createUser('put-ollama@llm.test', 'owner', 'PUT Ollama');
  const r = await request(server.baseUrl, 'PUT', '/api/family/llm', {
    headers: { Cookie: owner.cookie },
    body: {
      backend: 'ollama',
      model: 'qwen2.5:3b',
      baseUrl: 'http://rpi.local:11434',
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.config.backend, 'ollama');
  assert.strictEqual(r.body.config.baseUrl, 'http://rpi.local:11434');
  assert.strictEqual(r.body.config.hasKey, false);
});

// ============================================================
// POST /api/family/llm/test — uses current stored config
// ============================================================

test('POST /test returns 412 when no config row exists', async () => {
  const owner = createUser('test-none@llm.test', 'owner', 'Test None');
  const r = await request(server.baseUrl, 'POST', '/api/family/llm/test', {
    headers: { Cookie: owner.cookie },
    body: {},
  });
  assert.strictEqual(r.status, 412);
  assert.strictEqual(r.body.error, 'llm_not_configured');
});

test('POST /test returns 412 when Anthropic has no stored key', async () => {
  const owner = createUser('test-nokey@llm.test', 'owner', 'Test NoKey');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'anthropic',
    model: null,
    apiKey: undefined,
    updatedBy: owner.userId,
  });
  const r = await request(server.baseUrl, 'POST', '/api/family/llm/test', {
    headers: { Cookie: owner.cookie },
    body: {},
  });
  assert.strictEqual(r.status, 412);
});

// ============================================================
// Dispatcher: getClientForFamily honours per-family config
// ============================================================

test('getClientForFamily returns an Anthropic client for anthropic config', () => {
  const { getClientForFamily } = require('../server/llm/per-family');
  const owner = createUser('disp-anthropic@llm.test', 'owner', 'Disp Anthropic');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'anthropic',
    apiKey: 'sk-ant-test',
    updatedBy: owner.userId,
  });
  const client = getClientForFamily(server.repos, owner.familyId);
  assert.strictEqual(client.backend, 'anthropic');
  assert.ok(typeof client.chat === 'function');
});

test('getClientForFamily returns an Ollama client without key', () => {
  const { getClientForFamily } = require('../server/llm/per-family');
  const owner = createUser('disp-ollama@llm.test', 'owner', 'Disp Ollama');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'ollama',
    model: 'qwen2.5:3b',
    baseUrl: 'http://localhost:11434',
    apiKey: undefined,
    updatedBy: owner.userId,
  });
  const client = getClientForFamily(server.repos, owner.familyId);
  assert.strictEqual(client.backend, 'ollama');
});

test('getClientForFamily throws NotConfiguredError when row is missing', () => {
  const { getClientForFamily, NotConfiguredError } = require('../server/llm/per-family');
  const owner = createUser('disp-missing@llm.test', 'owner', 'Disp Missing');
  assert.throws(
    () => getClientForFamily(server.repos, owner.familyId),
    (err) => err instanceof NotConfiguredError
  );
});

test('getClientForFamily throws NotConfiguredError when cloud backend has no key', () => {
  const { getClientForFamily, NotConfiguredError } = require('../server/llm/per-family');
  const owner = createUser('disp-nokey@llm.test', 'owner', 'Disp NoKey');
  server.repos.llmConfig.upsert(owner.familyId, {
    backend: 'openai',
    updatedBy: owner.userId,
  });
  assert.throws(
    () => getClientForFamily(server.repos, owner.familyId),
    (err) => err instanceof NotConfiguredError
  );
});
