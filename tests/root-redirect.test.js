'use strict';

// Legacy /v2/* URLs 301 to the unprefixed path. The SPA now lives at /.
// GET / is the app (200 when the bundle exists), not a bounce to /v2/.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startTestServer, request } = require('./helpers');

describe('Legacy /v2 prefix redirect + root is the SPA', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  describe('GET / is not redirected', () => {
    test('GET / no cookies → not 302', async () => {
      const r = await request(server.baseUrl, 'GET', '/');
      assert.notStrictEqual(r.status, 302);
      assert.ok(r.status === 200 || r.status === 404, `got ${r.status}`);
    });

    test('GET / with session-cookie → not 302', async () => {
      const fid = Number(
        server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Root Family')
          .lastInsertRowid
      );
      const user = server.repos.auth.createUser({
        email: 'root-spa@test',
        name: 'Root',
      });
      server.repos.auth.setFamily(user.id, fid, 'owner');
      const sid = crypto.randomBytes(32).toString('hex');
      server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

      const r = await request(server.baseUrl, 'GET', '/', {
        headers: { Cookie: `fa_session=${sid}` },
      });
      assert.notStrictEqual(r.status, 302);
    });

    test('GET / with Bearer token → not 302', async () => {
      const r = await request(server.baseUrl, 'GET', '/', {
        headers: { Authorization: 'Bearer fake-but-syntactically-valid' },
      });
      assert.notStrictEqual(r.status, 302);
    });
  });

  describe('GET /v2/* 301 to the same path without prefix', () => {
    test('GET /v2 → 301 /', async () => {
      const r = await request(server.baseUrl, 'GET', '/v2');
      assert.strictEqual(r.status, 301);
      assert.strictEqual(r.headers.location || r.headers.Location, '/');
    });

    test('GET /v2/ → 301 /', async () => {
      const r = await request(server.baseUrl, 'GET', '/v2/');
      assert.strictEqual(r.status, 301);
      assert.strictEqual(r.headers.location || r.headers.Location, '/');
    });

    test('GET /v2/dashboard → 301 /dashboard', async () => {
      const r = await request(server.baseUrl, 'GET', '/v2/dashboard');
      assert.strictEqual(r.status, 301);
      assert.strictEqual(r.headers.location || r.headers.Location, '/dashboard');
    });

    test('GET /v2/invite/abc?x=1 → 301 /invite/abc?x=1', async () => {
      const r = await request(server.baseUrl, 'GET', '/v2/invite/abc?x=1');
      assert.strictEqual(r.status, 301);
      assert.strictEqual(r.headers.location || r.headers.Location, '/invite/abc?x=1');
    });
  });

  describe('Other paths unchanged', () => {
    test('GET /health → 200', async () => {
      const r = await request(server.baseUrl, 'GET', '/health');
      assert.strictEqual(r.status, 200);
    });

    test('GET /privacy.html → 200', async () => {
      const r = await request(server.baseUrl, 'GET', '/privacy.html');
      assert.strictEqual(r.status, 200);
    });

    test('GET /api/auth/config → not 301/302', async () => {
      const r = await request(server.baseUrl, 'GET', '/api/auth/config');
      assert.notStrictEqual(r.status, 301);
      assert.notStrictEqual(r.status, 302);
    });
  });

  describe('Non-GET methods on / — not redirected', () => {
    test('POST / → not 301/302', async () => {
      const r = await request(server.baseUrl, 'POST', '/', { body: {} });
      assert.notStrictEqual(r.status, 301);
      assert.notStrictEqual(r.status, 302);
    });
  });
});
