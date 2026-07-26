'use strict';

// Regression: Docker auto-sets AUTH_TOKEN. Direct navigation to
// /v2/login must return the SPA HTML (200), not JSON 401.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');

describe('v2 login is reachable with AUTH_TOKEN configured', () => {
  let server;

  before(async () => {
    process.env.AUTH_TOKEN = 't'.repeat(40);
    process.env.SESSION_SECRET = 's'.repeat(64);
    server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  });

  after(async () => {
    if (server) await server.close();
    delete process.env.AUTH_TOKEN;
    delete process.env.SESSION_SECRET;
  });

  test('GET /v2/login → not 401', async () => {
    const r = await request(server.baseUrl, 'GET', '/v2/login');
    assert.notEqual(r.status, 401, `body=${JSON.stringify(r.body)}`);
    // 200 when v2 bundle exists, 404 when missing in bare checkout — either
    // is fine as long as we do not demand authentication for the shell.
    assert.ok([200, 404].includes(r.status), `unexpected status ${r.status}`);
  });

  test('GET /api/auth/config → 200 anonymous', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/auth/config');
    assert.equal(r.status, 200);
  });

  test('GET /api/config → 200 anonymous', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/config');
    assert.equal(r.status, 200);
  });

  test('GET /api/meals still requires auth', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(r.status, 401);
  });
});
