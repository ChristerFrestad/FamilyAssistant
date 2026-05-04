'use strict';

// Tests for /health/detailed admin-only endpoint (PR D3).
// Existing /health and /ready already had broad coverage in
// tests/m-week5-performance.test.js and tests/phase22-bootstrap.test.js
// (200 status, structure, ready-on-fresh-server). This file adds the
// new admin-gated detail endpoint.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');

describe('/health/detailed admin endpoint', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('returns 403 without admin role', async () => {
    const r = await request(baseUrl, 'GET', '/health/detailed');
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });

  test('public /health remains anonymous-accessible', async () => {
    const r = await request(baseUrl, 'GET', '/health');
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.raw);
    assert.strictEqual(body.status, 'ok');
    assert.ok(typeof body.uptimeSec === 'number');
  });

  test('public /ready remains anonymous-accessible', async () => {
    const r = await request(baseUrl, 'GET', '/ready');
    assert.ok(r.status === 200 || r.status === 503);
    const body = JSON.parse(r.raw);
    assert.ok(typeof body.ready === 'boolean');
  });
});
