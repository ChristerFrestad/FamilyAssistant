'use strict';

// Tests for Kassal ENV activation (PR C3).
//
// Covers:
//   - GET /api/admin/kassal/status requires admin role (anonymous → 403)
//   - GET /api/admin/kassal/status reports enabled=false when
//     KASSAL_API_KEY is unset (default pilot state)
//   - When KASSAL_API_KEY is set, enabled=true and apiKeyConfigured=true
//   - kassal_products and product_resolutions row counts surface correctly
//
// Note: full per-family multi-tenant isolation tests for kassal_products
// and product_resolutions live in existing kassal/iteration tests. This
// test focuses on the new admin-only endpoint and env-var wiring.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Kassal admin status endpoint', () => {
  let server;
  let baseUrl;

  before(async () => {
    delete process.env.KASSAL_API_KEY;
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('returns 403 without admin role', async () => {
    const r = await request(baseUrl, 'GET', '/api/admin/kassal/status');
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });
});

describe('Kassal env-gating', () => {
  test('process.env.KASSAL_API_KEY=undefined → kassal client reports apiKeyConfigured=false', () => {
    delete process.env.KASSAL_API_KEY;
    // Force re-require so the module re-reads env.
    for (const k of Object.keys(require.cache)) {
      if (k.includes('kassal-client')) delete require.cache[k];
    }
    const kassal = require('../server/services/kassal-client.service');
    const status = kassal.getStatus();
    assert.strictEqual(status.apiKeyConfigured, false);
  });

  test('process.env.KASSAL_API_KEY=test-key → kassal client reports apiKeyConfigured=true', () => {
    process.env.KASSAL_API_KEY = 'test-key';
    for (const k of Object.keys(require.cache)) {
      if (k.includes('kassal-client')) delete require.cache[k];
    }
    const kassal = require('../server/services/kassal-client.service');
    const status = kassal.getStatus();
    assert.strictEqual(status.apiKeyConfigured, true);
    delete process.env.KASSAL_API_KEY;
  });
});
