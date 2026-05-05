'use strict';

// Regression coverage for the 2026-05-04 root-redirect fix.
//
// Bug: the bare "/" path leaked one of two failures on the pilot deploy:
//   - Anonymous visitor (no cookie) with AUTH_TOKEN set → 401
//   - Authenticated session-cookie holder → 200 + legacy v1 SPA served
//
// The legacy v1 SPA is still in the image but should only render when an
// operator deliberately navigates to /index.html. Pilot users land on /
// and must always be funnelled into /v2/ (the React app with PilotGuard,
// AuthGuard, OnboardingGuard).
//
// Fix: server/http/server.js intercepts GET / before rate-limit and auth
// and emits a 302 to /v2/. Cookie-agnostic, side-effect-free, only GET.
//
// Tests below cover the scenario matrix from Christer's BUG 2 spec:
//   a. GET / no cookies → 302 /v2/
//   b. GET / with session-cookie → 302 /v2/ (no longer leaks v1)
//   c. GET / with pilot-cookie → 302 /v2/
//   d. GET / with Bearer token → 302 /v2/
//   e. GET /api/* → unchanged (router handles)
//   f. GET /v2/ → unchanged (v2 SPA handler)
//   g. GET /v2/anything → unchanged
//   h. GET /health → unchanged (200, public path)
//   i. GET /privacy.html → unchanged (200, public path)
//   j. POST/PUT/DELETE / → not redirected (router 404)
//   k. GET /index.html → unchanged (legacy v1 still reachable on explicit path)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startTestServer, request } = require('./helpers');

describe('Universal root redirect: GET / → 302 /v2/', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  describe('Anonymous + cookie variants — all redirect to /v2/', () => {
    test('GET / no cookies → 302 /v2/', async () => {
      const r = await request(server.baseUrl, 'GET', '/');
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.location || r.headers.Location, '/v2/');
    });

    test('GET / with session-cookie → 302 /v2/ (no longer leaks v1)', async () => {
      // Build a real session so the cookie would have passed authenticate()
      // before this fix. Pre-fix this would have served public/index.html.
      const fid = Number(
        server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Root Redirect Family')
          .lastInsertRowid
      );
      const user = server.repos.auth.createUser({
        email: 'root-redirect@test',
        name: 'Root Redirect',
      });
      server.repos.auth.setFamily(user.id, fid, 'owner');
      const sid = crypto.randomBytes(32).toString('hex');
      server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });

      const r = await request(server.baseUrl, 'GET', '/', {
        headers: { Cookie: `fa_session=${sid}` },
      });
      assert.strictEqual(r.status, 302, 'session-cookie holder must still be redirected');
      assert.strictEqual(r.headers.location || r.headers.Location, '/v2/');
    });

    test('GET / with bogus pilot-cookie → 302 /v2/', async () => {
      // Even with a fake pilot cookie present, root must redirect — the
      // redirect runs before any cookie processing.
      const r = await request(server.baseUrl, 'GET', '/', {
        headers: { Cookie: 'fa_pilot=anything' },
      });
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.location || r.headers.Location, '/v2/');
    });

    test('GET / with Bearer token → 302 /v2/', async () => {
      // Bearer-auth is the RPi service-mode path. Even an authenticated
      // operator should land on /v2/ first.
      const r = await request(server.baseUrl, 'GET', '/', {
        headers: { Authorization: 'Bearer fake-but-syntactically-valid' },
      });
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.headers.location || r.headers.Location, '/v2/');
    });
  });

  describe('Other paths unchanged — redirect is precise', () => {
    test('GET /v2/ → not redirected (200 or 404 if bundle missing)', async () => {
      const r = await request(server.baseUrl, 'GET', '/v2/');
      assert.notStrictEqual(r.status, 302, '/v2/ itself must not redirect');
      assert.ok(r.status === 200 || r.status === 404, `got ${r.status}`);
    });

    test('GET /v2/anything → handled by v2 SPA (not redirected)', async () => {
      const r = await request(server.baseUrl, 'GET', '/v2/some-route');
      assert.notStrictEqual(r.status, 302, '/v2/ subpath must not redirect');
    });

    test('GET /health → 200 (public path unchanged)', async () => {
      const r = await request(server.baseUrl, 'GET', '/health');
      assert.strictEqual(r.status, 200);
    });

    test('GET /privacy.html → 200 (public path unchanged)', async () => {
      const r = await request(server.baseUrl, 'GET', '/privacy.html');
      assert.strictEqual(r.status, 200);
    });

    test('GET /api/auth/config → not 302 (router handles)', async () => {
      const r = await request(server.baseUrl, 'GET', '/api/auth/config');
      assert.notStrictEqual(r.status, 302, '/api/* must not be intercepted by root-redirect');
    });

    test('GET /index.html → 404 (v1 deleted in Sprint 8, not redirected)', async () => {
      // After Sprint 8 v1-cleanup, /index.html no longer exists. The
      // important assertion here is that the redirect does NOT fire on
      // it — the redirect targets the bare root only. Anything else
      // routes normally and 404s if there is no file.
      const r = await request(server.baseUrl, 'GET', '/index.html');
      assert.notStrictEqual(r.status, 302, '/index.html must not redirect');
      assert.equal(r.status, 404, 'v1 deletion: /index.html no longer served');
    });
  });

  describe('Non-GET methods on / — fall through to router', () => {
    test('POST / → not redirected (router returns 404)', async () => {
      const r = await request(server.baseUrl, 'POST', '/', { body: {} });
      assert.notStrictEqual(r.status, 302, 'POST / must not be intercepted');
      // Router 404 (or 401 if auth gate hits first); we just assert it's
      // not a redirect.
    });

    test('PUT / → not redirected', async () => {
      const r = await request(server.baseUrl, 'PUT', '/', { body: {} });
      assert.notStrictEqual(r.status, 302);
    });

    test('DELETE / → not redirected', async () => {
      const r = await request(server.baseUrl, 'DELETE', '/');
      assert.notStrictEqual(r.status, 302);
    });
  });

  describe('Redirect runs before auth chain (no auth state required)', () => {
    test('Redirect target is /v2/ exactly (no query string, no fragment)', async () => {
      const r = await request(server.baseUrl, 'GET', '/');
      const loc = r.headers.location || r.headers.Location;
      assert.strictEqual(loc, '/v2/', 'absolute redirect target must be /v2/');
    });

    test('Body is empty on 302 (no payload leaked)', async () => {
      const r = await request(server.baseUrl, 'GET', '/');
      assert.strictEqual(r.status, 302);
      assert.strictEqual(r.raw, '', '302 response must have empty body');
    });
  });
});
