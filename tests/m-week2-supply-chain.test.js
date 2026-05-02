// Uke 2 av ISO/IEC 25010-planen: supply chain + audit + token rotation
//
// Dekker:
//   SBOM-5: token-rotation warning i /ready
//   SBOM-6: audit-log repository — record/getRecent/getByEntity/stats
//   SBOM-6: withAudit-wrapper logger ved DELETE/PUT på profil/sources/receipts
//   SBOM-7: /api/audit og /api/audit/stats endepunkter

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

// ============================================================
// SBOM-6: Audit log repository (unit)
// ============================================================
describe('Uke2 · Audit log repository', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });
  beforeEach(() => {
    server.repos._db.prepare('DELETE FROM audit_log').run();
  });

  test('record() lagrer entry med sha256-hashes', () => {
    server.repos.auditLog.record({
      requestId: 'req-001',
      action: 'DELETE',
      entityType: 'recipe',
      entityId: 42,
      route: '/api/recipes/42',
      before: { id: 42, name: 'Pizza' },
      metadata: { reason: 'cleanup' },
    });
    const rows = server.repos.auditLog.getRecent(10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].requestId, 'req-001');
    assert.equal(rows[0].action, 'DELETE');
    assert.equal(rows[0].entityType, 'recipe');
    assert.equal(rows[0].entityId, '42');
    assert.match(rows[0].beforeHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(rows[0].afterHash, null);
    assert.deepEqual(rows[0].metadata, { reason: 'cleanup' });
  });

  test('record() svelger feil stille (ingen throw)', () => {
    assert.doesNotThrow(() => {
      server.repos.auditLog.record({
        requestId: 'req-002',
        action: 'INVALID_ACTION', // CHECK-constraint vil feile
        entityType: 'test',
        route: '/api/test',
      });
    });
  });

  test('getByEntity() filtrerer riktig', () => {
    const base = { requestId: 'r', action: 'DELETE', route: '/x' };
    server.repos.auditLog.record({ ...base, entityType: 'recipe', entityId: 1 });
    server.repos.auditLog.record({ ...base, entityType: 'recipe', entityId: 2 });
    server.repos.auditLog.record({ ...base, entityType: 'pantry_item', entityId: 'melk' });

    const recipes = server.repos.auditLog.getByEntity('recipe');
    assert.equal(recipes.length, 2);

    const recipe1 = server.repos.auditLog.getByEntity('recipe', 1);
    assert.equal(recipe1.length, 1);
    assert.equal(recipe1[0].entityId, '1');

    const pantry = server.repos.auditLog.getByEntity('pantry_item');
    assert.equal(pantry.length, 1);
    assert.equal(pantry[0].entityId, 'melk');
  });

  test('stats() returnerer total, byAction, byEntity', () => {
    const base = { requestId: 'r', route: '/x' };
    server.repos.auditLog.record({ ...base, action: 'DELETE', entityType: 'recipe' });
    server.repos.auditLog.record({ ...base, action: 'DELETE', entityType: 'recipe' });
    server.repos.auditLog.record({ ...base, action: 'PUT', entityType: 'family_profile' });

    const s = server.repos.auditLog.stats();
    assert.equal(s.total, 3);
    assert.equal(s.byAction.find((r) => r.action === 'DELETE').c, 2);
    assert.equal(s.byAction.find((r) => r.action === 'PUT').c, 1);
    assert.equal(s.byEntity.find((r) => r.entity_type === 'recipe').c, 2);
  });

  test('getRecent() respekterer limit', () => {
    for (let i = 0; i < 5; i++) {
      server.repos.auditLog.record({
        requestId: `r${i}`,
        action: 'DELETE',
        entityType: 'test',
        route: '/x',
      });
    }
    assert.equal(server.repos.auditLog.getRecent(3).length, 3);
    assert.equal(server.repos.auditLog.getRecent(999).length, 5);
  });
});

// ============================================================
// SBOM-6: withAudit wrapper via HTTP (integration)
// ============================================================
describe('Week2 · withAudit wrapper on destructive endpoints', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });
  beforeEach(() => {
    server.repos._db.prepare('DELETE FROM audit_log').run();
  });

  test('PUT /api/profile logges med before/after hashes', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/profile', {
      body: { members: [{ name: 'Test', age: 10 }], allergies: ['nøtter'] },
    });
    assert.equal(res.status, 200);

    const entries = server.repos.auditLog.getByEntity('family_profile');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'PUT');
    assert.equal(entries[0].entityId, 'default');
    assert.match(entries[0].route, /\/api\/profile/);
    assert.match(entries[0].beforeHash, /^sha256:/);
    assert.match(entries[0].afterHash, /^sha256:/);
    // before og after skal være forskjellige siden vi endret
    assert.notEqual(entries[0].beforeHash, entries[0].afterHash);
  });

  test('Failed request genererer IKKE audit-entry', async () => {
    // Invalid body — allergies skal være array
    const res = await request(server.baseUrl, 'PUT', '/api/profile', {
      body: { allergies: 'ikke-en-array' },
    });
    assert.equal(res.status, 400);
    const entries = server.repos.auditLog.getByEntity('family_profile');
    assert.equal(entries.length, 0, 'feilet request skal ikke logges');
  });

  test('DELETE /api/sources/:id logger med before-snapshot', async () => {
    const id = server.repos.recipeSources.insert({
      url: 'https://example.com/feed.rss',
      type: 'rss',
      label: 'Test',
    });

    const res = await request(server.baseUrl, 'DELETE', `/api/sources/${id}`);
    assert.equal(res.status, 200);

    const entries = server.repos.auditLog.getByEntity('recipe_source');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'DELETE');
    assert.equal(entries[0].entityId, String(id));
    assert.match(entries[0].beforeHash, /^sha256:/);
    assert.equal(entries[0].afterHash, null);
  });
});

// ============================================================
// SBOM-7: /api/audit endepunkter
// ============================================================
describe('Uke2 · /api/audit endepunkter', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });
  beforeEach(() => {
    server.repos._db.prepare('DELETE FROM audit_log').run();
  });

  test('GET /api/audit returnerer entries array', async () => {
    server.repos.auditLog.record({
      requestId: 'r1',
      action: 'DELETE',
      entityType: 'test',
      route: '/x',
    });
    const res = await request(server.baseUrl, 'GET', '/api/audit');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.entries));
    assert.equal(res.body.count, 1);
    assert.ok(res.body.note);
  });

  test('GET /api/audit?entityType=recipe filtrerer', async () => {
    server.repos.auditLog.record({
      requestId: 'r1',
      action: 'DELETE',
      entityType: 'recipe',
      route: '/x',
    });
    server.repos.auditLog.record({
      requestId: 'r2',
      action: 'DELETE',
      entityType: 'pantry_item',
      route: '/x',
    });
    const res = await request(server.baseUrl, 'GET', '/api/audit?entityType=recipe');
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.entries[0].entityType, 'recipe');
  });

  test('GET /api/audit?limit=2 respekterer limit', async () => {
    for (let i = 0; i < 5; i++) {
      server.repos.auditLog.record({
        requestId: `r${i}`,
        action: 'DELETE',
        entityType: 'test',
        route: '/x',
      });
    }
    const res = await request(server.baseUrl, 'GET', '/api/audit?limit=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.entries.length, 2);
  });

  test('GET /api/audit/stats returnerer aggregater', async () => {
    server.repos.auditLog.record({
      requestId: 'r1',
      action: 'DELETE',
      entityType: 'recipe',
      route: '/x',
    });
    const res = await request(server.baseUrl, 'GET', '/api/audit/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.ok(Array.isArray(res.body.byAction));
    assert.ok(Array.isArray(res.body.byEntity));
  });
});

// ============================================================
// SBOM-5: Token rotation warning i /ready
// ============================================================
describe('Uke2 · Token rotation warning i /ready', () => {
  test('tokenAgeDays er null når AUTH_TOKEN_CREATED_AT ikke er satt', async () => {
    delete process.env.AUTH_TOKEN;
    delete process.env.AUTH_TOKEN_CREATED_AT;
    const server = await startTestServer();
    try {
      const res = await request(server.baseUrl, 'GET', '/ready');
      assert.equal(res.body.tokenAgeDays, null);
      assert.ok(!res.body.warnings.some((w) => w.startsWith('auth_token_stale')));
    } finally {
      await server.close();
    }
  });

  test('tokenAgeDays beregnes riktig når CREATED_AT er satt', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    process.env.AUTH_TOKEN = 'a'.repeat(32);
    process.env.AUTH_TOKEN_CREATED_AT = tenDaysAgo;
    const server = await startTestServer({ authToken: 'a'.repeat(32) });
    try {
      const res = await request(server.baseUrl, 'GET', '/ready');
      assert.ok(res.body.tokenAgeDays >= 9 && res.body.tokenAgeDays <= 11);
      // 10 dager < default 90 → ingen warning
      assert.ok(!res.body.warnings.some((w) => w.startsWith('auth_token_stale')));
    } finally {
      delete process.env.AUTH_TOKEN;
      delete process.env.AUTH_TOKEN_CREATED_AT;
      await server.close();
    }
  });

  test('warning flagges når token er eldre enn MAX_AGE_DAYS', async () => {
    const veryOld = new Date(Date.now() - 200 * 86400000).toISOString();
    process.env.AUTH_TOKEN = 'b'.repeat(32);
    process.env.AUTH_TOKEN_CREATED_AT = veryOld;
    process.env.AUTH_TOKEN_MAX_AGE_DAYS = '90';
    const server = await startTestServer({ authToken: 'b'.repeat(32) });
    try {
      const res = await request(server.baseUrl, 'GET', '/ready');
      assert.ok(res.body.tokenAgeDays >= 199);
      const staleWarn = res.body.warnings.find((w) => w.startsWith('auth_token_stale'));
      assert.ok(staleWarn, `forventet auth_token_stale warning, fikk: ${res.body.warnings}`);
    } finally {
      delete process.env.AUTH_TOKEN;
      delete process.env.AUTH_TOKEN_CREATED_AT;
      delete process.env.AUTH_TOKEN_MAX_AGE_DAYS;
      await server.close();
    }
  });
});
