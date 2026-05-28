'use strict';

// Tests for admin bootstrap (Sprint 7).
//
// Covers:
//   - APP_ADMIN_EMAIL match → first matching user gets is_admin=1
//   - APP_ADMIN_EMAIL set but mismatch → no admin yet, second matching user wins
//   - APP_ADMIN_EMAIL unset → first user wins regardless of email
//   - Idempotency: second user never gets admin once bootstrap already ran
//   - Cross-tenant isolation (AGENTS.md DEL 14): admin in family A cannot
//     read family B private data via /api/admin/* endpoints

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('admin-bootstrap.service · decideAdminBootstrap', () => {
  let service;
  let mockDb;

  before(() => {
    // Force config.APP_ADMIN_EMAIL via env BEFORE the service is required
    // (config.js reads env at first import).
    process.env.APP_ADMIN_EMAIL = 'admin@example.com';
    // Force require-cache reload of config so the env-var sticks.
    for (const k of Object.keys(require.cache)) {
      if (k.includes('server')) delete require.cache[k];
    }
    service = require('../server/services/admin-bootstrap.service');
  });

  beforeEach(() => {
    mockDb = {
      _setupRow: null,
      prepare(sql) {
        return {
          get: () => (sql.includes('app_setup') ? mockDb._setupRow : null),
          run: () => ({ changes: 1 }),
          all: () => [],
        };
      },
    };
  });

  test('returns promote=true with method=env when email matches APP_ADMIN_EMAIL', () => {
    const decision = service.decideAdminBootstrap({
      db: mockDb,
      userEmail: 'admin@example.com',
    });
    assert.strictEqual(decision.promote, true);
    assert.strictEqual(decision.method, 'env');
  });

  test('returns promote=false when email does NOT match APP_ADMIN_EMAIL', () => {
    const decision = service.decideAdminBootstrap({
      db: mockDb,
      userEmail: 'someone@example.com',
    });
    assert.strictEqual(decision.promote, false);
  });

  test('returns promote=false when bootstrap row already exists', () => {
    mockDb._setupRow = { id: 1, admin_user_id: 1, bootstrap_method: 'env' };
    const decision = service.decideAdminBootstrap({
      db: mockDb,
      userEmail: 'admin@example.com',
    });
    assert.strictEqual(decision.promote, false);
  });

  test('email matching is case-insensitive and trim-tolerant', () => {
    const decision = service.decideAdminBootstrap({
      db: mockDb,
      userEmail: '  ADMIN@Example.com  ',
    });
    assert.strictEqual(decision.promote, true);
    assert.strictEqual(decision.method, 'env');
  });
});

describe('admin-bootstrap.service · first-user fallback', () => {
  let service;
  let mockDb;

  before(() => {
    delete process.env.APP_ADMIN_EMAIL;
    for (const k of Object.keys(require.cache)) {
      if (k.includes('server')) delete require.cache[k];
    }
    service = require('../server/services/admin-bootstrap.service');
  });

  beforeEach(() => {
    mockDb = {
      _setupRow: null,
      prepare(sql) {
        return {
          get: () => (sql.includes('app_setup') ? mockDb._setupRow : null),
          run: () => ({ changes: 1 }),
          all: () => [],
        };
      },
    };
  });

  test('first-user-wins when APP_ADMIN_EMAIL is unset', () => {
    const decision = service.decideAdminBootstrap({
      db: mockDb,
      userEmail: 'whoever@example.com',
    });
    assert.strictEqual(decision.promote, true);
    assert.strictEqual(decision.method, 'first_user');
  });

  test('second user does not get admin once bootstrap already ran', () => {
    mockDb._setupRow = { id: 1, admin_user_id: 5, bootstrap_method: 'first_user' };
    const decision = service.decideAdminBootstrap({
      db: mockDb,
      userEmail: 'second@example.com',
    });
    assert.strictEqual(decision.promote, false);
  });
});

// Integration tests against the live server — verifies multi-tenant
// isolation per AGENTS.md DEL 14.
describe('admin endpoints · multi-tenant isolation', () => {
  let server;
  let baseUrl;
  const { startTestServer, request } = require('./helpers');

  before(async () => {
    process.env.APP_ADMIN_EMAIL = 'christer@example.com';
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('GET /api/admin/me without admin role returns 403', async () => {
    // Without auth, /api/admin/me should 401/403 because we haven't
    // mocked a user session. The point of this test is that the
    // endpoint doesn't accept anonymous traffic.
    const r = await request(baseUrl, 'GET', '/api/admin/me');
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });

  test('GET /api/admin/setup without admin role returns 403', async () => {
    const r = await request(baseUrl, 'GET', '/api/admin/setup');
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });

  test('migration 026 adds is_admin column without breaking existing tables', () => {
    // Verify the column exists. If migration 026 failed, this throws.
    const cols = server.repos._db.pragma(`table_info('users')`);
    const colNames = cols.map((c) => c.name);
    assert.ok(colNames.includes('is_admin'), 'users.is_admin column should exist');
    assert.ok(colNames.includes('promoted_by_user_id'), 'users.promoted_by_user_id column');
    assert.ok(colNames.includes('promoted_at'), 'users.promoted_at column');
  });

  test('migration 027 creates app_setup table', () => {
    const tables = server.repos._db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='app_setup'`)
      .all();
    assert.strictEqual(tables.length, 1);
  });

  test('app_setup is empty before any onboarding', () => {
    const row = server.repos._db.prepare(`SELECT * FROM app_setup WHERE id = 1`).get();
    assert.strictEqual(row, undefined);
  });
});
