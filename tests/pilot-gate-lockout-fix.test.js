'use strict';

// Regression tests for the pilot-gate lockout fix (fix/pilot-gate-lockout).
//
// Bug: when AUTH_TOKEN is set (every production deploy) and PILOT_MODE=true,
// every visitor entered an infinite 401 loop:
//
//   GET /        → 302 → /v2/    (pilot-gate redirect)
//   GET /v2/     → 401            (authenticate: not in PUBLIC_PATHS)
//   GET /login.html → 302 → /v2/  (pilot-gate redirect)
//   GET /v2/     → 401
//   ... loop
//
// Root cause: /v2/ + assets were in PILOT_GATE_BYPASS_PATHS but NOT in
// PUBLIC_PATHS, so pilot-gate let them through but authenticate() then
// rejected them because no Bearer/session was present and AUTH_TOKEN
// was configured.
//
// Fix: make /v2/, /v2/index.html, and /v2/assets/* public. Frontend
// PilotGuard then loads, fetches /api/pilot/status, and renders the
// PilotPasswordGate UI when needed.
//
// Tests below set AUTH_TOKEN+PILOT_MODE+PILOT_PASSWORD to reproduce
// the production environment that triggered the bug, then verify:
//   1. /v2/ returns 200 even without auth (bundle loads → gate renders)
//   2. /api/pilot/status is reachable without auth (gate UI fetches it)
//   3. Wrong /api/* paths still 403 with pilot password required
//   4. After pilot-cookie is set, normal auth flow resumes
//   5. /api/auth/magic-link/verify is NOT in pilot-bypass (intentional)

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Set production-like env BEFORE startTestServer requires server modules.
process.env.AUTH_TOKEN = 'test-auth-token-1234567890abcdef1234567890abcdef';
process.env.SESSION_SECRET = 'test-session-secret-1234567890abcdef1234567890abcdef';
process.env.PILOT_MODE = 'true';
process.env.PILOT_PASSWORD = 'test-pilot-password';
process.env.MAGIC_LINK_CONSOLE = 'true';
process.env.ALLOWED_ORIGINS = 'http://localhost:7777';

const { startTestServer, request } = require('./helpers');

function pilotPasswordService() {
  return require('../server/services/pilot-password.service');
}

describe('Pilot-gate lockout regression (production-like env)', () => {
  let server;
  let baseUrl;

  before(async () => {
    pilotPasswordService().resetRateLimitForTests();
    server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
  });

  describe('Bundle reachability (the actual bug)', () => {
    beforeEach(() => pilotPasswordService().resetRateLimitForTests());

    test('GET /v2/ returns 200 anonymous (bundle loads → gate can render)', async () => {
      const r = await request(baseUrl, 'GET', '/v2/');
      assert.notStrictEqual(r.status, 401, 'should not 401 — bundle must load');
      assert.notStrictEqual(r.status, 302, 'should not 302 — already at /v2/');
      // Either 200 (bundle exists) or 404 (bundle not built yet) is fine —
      // both mean auth let it through. The bug was 401 before this fix.
      assert.ok(r.status === 200 || r.status === 404, `got ${r.status}`);
    });

    test('GET /v2/index.html returns 200 anonymous', async () => {
      const r = await request(baseUrl, 'GET', '/v2/index.html');
      assert.notStrictEqual(r.status, 401);
      assert.notStrictEqual(r.status, 302);
    });

    test('GET /v2/assets/main.js (representative asset) returns non-401 anonymous', async () => {
      const r = await request(baseUrl, 'GET', '/v2/assets/main.js');
      assert.notStrictEqual(r.status, 401, 'asset must be reachable for bundle to mount');
    });

    test('GET / (legacy root) redirects to /v2/ via pilot-gate (still expected behaviour)', async () => {
      const r = await request(baseUrl, 'GET', '/');
      assert.strictEqual(r.status, 302);
      const location = r.headers.location || r.headers.Location;
      assert.match(String(location), /\/v2\/?$/);
    });
  });

  describe('Gate API reachability (so PilotGuard can fetch status)', () => {
    beforeEach(() => pilotPasswordService().resetRateLimitForTests());

    test('GET /api/pilot/status reachable anonymous, reports gated state', async () => {
      const r = await request(baseUrl, 'GET', '/api/pilot/status');
      assert.strictEqual(r.status, 200);
      const body = JSON.parse(r.raw);
      assert.strictEqual(body.pilotMode, true);
      assert.strictEqual(body.pilotAuthenticated, false);
    });

    test('POST /api/auth/pilot-password reachable anonymous', async () => {
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'wrong' },
      });
      // 401 (wrong password) is the right response — the call was reachable.
      // Pre-fix this would be 401 too but for the wrong reason (auth-required
      // before pilot-gate even checked the password). Net: same status code,
      // different code path. The pilot-bypass list is what matters.
      assert.strictEqual(r.status, 401);
      const body = JSON.parse(r.raw);
      assert.strictEqual(body.code, 'wrong_password');
    });
  });

  describe('Other /api/* still gated (pilot-mode enforcement intact)', () => {
    beforeEach(() => pilotPasswordService().resetRateLimitForTests());

    test('GET /api/meals/current → 403 without pilot cookie', async () => {
      const r = await request(baseUrl, 'GET', '/api/meals/current');
      assert.strictEqual(r.status, 403, 'pilot-gate must still block /api/* without cookie');
    });

    test('GET /api/admin/me → 403 without pilot cookie', async () => {
      const r = await request(baseUrl, 'GET', '/api/admin/me');
      assert.strictEqual(r.status, 403);
    });

    test('Magic-link verify bypasses pilot-gate (token is the auth)', async () => {
      // Updated 2026-05-06: pilot-gate is a formality to keep random
      // visitors away from the wizard, NOT a real auth mechanism.
      // Core auth flows must never depend on pilot-password being on,
      // because PILOT_MODE is a temporary toggle the operator flips
      // off whenever the soft-launch ends.
      //
      // The previous "same browser" assumption (pilot password before
      // session) broke once Sprint 9 invitations + Sprint 10 multi-
      // deploy made it normal for a magic-link to be clicked on a
      // different device than the one that solved the gate. Real
      // pilot user got 403 in production 2026-05-06.
      //
      // The HMAC-signed magic-link token is itself sufficient auth —
      // the verify-handler validates it before creating a session.
      const r = await request(baseUrl, 'GET', '/api/auth/magic-link/verify?token=fake');
      // Handler returns 4xx for invalid token (e.g. 401 invalid_token).
      // The pilot-gate's 403 "Pilot password required" must NOT appear
      // here — that was the pre-fix bug.
      assert.notStrictEqual(r.status, 403, 'magic-link verify must NOT be pilot-gated');
    });
  });

  describe('After pilot-password: normal auth flow resumes', () => {
    beforeEach(() => pilotPasswordService().resetRateLimitForTests());

    test('correct password → cookie → /api/auth/me reachable', async () => {
      // 1. Submit correct password
      const loginRes = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'test-pilot-password' },
      });
      assert.strictEqual(loginRes.status, 200);
      const setCookie = loginRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      const cookieMatch = /fa_pilot=([^;]+)/.exec(cookieStr);
      assert.ok(cookieMatch, 'expected fa_pilot cookie on success');

      // 2. /api/auth/me with pilot cookie → no longer pilot-gated
      const meRes = await request(baseUrl, 'GET', '/api/auth/me', {
        headers: { Cookie: `fa_pilot=${cookieMatch[1]}` },
      });
      assert.notStrictEqual(meRes.status, 403, 'should pass pilot-gate now');
      // /api/auth/me is soft-auth → returns 200 with authenticated:false
      assert.strictEqual(meRes.status, 200);
      const meBody = JSON.parse(meRes.raw);
      assert.strictEqual(meBody.authenticated, false);
    });

    test('correct password → cookie → /api/meals/current resumes auth chain', async () => {
      const loginRes = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'test-pilot-password' },
      });
      const setCookie = loginRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      const cookieMatch = /fa_pilot=([^;]+)/.exec(cookieStr);

      // /api/meals/current is NOT soft-auth and AUTH_TOKEN is set.
      // After pilot-cookie passes pilot-gate, authenticate() runs and
      // (no session, no Bearer, AUTH_TOKEN configured) → 401.
      // Pre-fix this would be 403 from pilot-gate. Post-fix: 401 from
      // authenticate (gate let it through, real auth still required).
      const r = await request(baseUrl, 'GET', '/api/meals/current', {
        headers: { Cookie: `fa_pilot=${cookieMatch[1]}` },
      });
      assert.strictEqual(r.status, 401, 'pilot-gate passed; real auth still required');
    });
  });

  describe('Static legal pages still work in pilot-mode', () => {
    test('/privacy.html anonymous → 200', async () => {
      const r = await request(baseUrl, 'GET', '/privacy.html');
      assert.strictEqual(r.status, 200);
    });

    test('/privacy-en.html anonymous → 200', async () => {
      const r = await request(baseUrl, 'GET', '/privacy-en.html');
      assert.strictEqual(r.status, 200);
    });

    test('/terms.html anonymous → 200', async () => {
      const r = await request(baseUrl, 'GET', '/terms.html');
      assert.strictEqual(r.status, 200);
    });
  });

  describe('isPublicPath unit-level coverage', () => {
    const { isPublicPath } = require('../server/auth/middleware');

    test('classic public paths still recognised', () => {
      assert.strictEqual(isPublicPath('/health'), true);
      assert.strictEqual(isPublicPath('/ready'), true);
      assert.strictEqual(isPublicPath('/privacy.html'), true);
      // Sprint 8 (2026-05-05): /login.html was removed from PUBLIC_PATHS
      // when the v1 frontend was deleted. The v2 React app handles login
      // under /v2/login. /sw.js (the tombstone) is the new public entry.
      assert.strictEqual(isPublicPath('/sw.js'), true);
    });

    test('v2 SPA shell paths recognised as public', () => {
      assert.strictEqual(isPublicPath('/v2'), true);
      assert.strictEqual(isPublicPath('/v2/'), true);
      assert.strictEqual(isPublicPath('/v2/index.html'), true);
    });

    test('v2 assets recognised as public', () => {
      assert.strictEqual(isPublicPath('/v2/assets/main-abc.js'), true);
      assert.strictEqual(isPublicPath('/v2/assets/main.css'), true);
      assert.strictEqual(isPublicPath('/v2/assets/Geist.woff2'), true);
    });

    test('non-v2 API paths NOT public (still go through auth)', () => {
      assert.strictEqual(isPublicPath('/api/meals/current'), false);
      assert.strictEqual(isPublicPath('/api/auth/me'), false);
      assert.strictEqual(isPublicPath('/api/admin/me'), false);
    });

    test('non-asset v2 sub-paths NOT public (defensive)', () => {
      // Future-proof: if someone adds /v2/api/foo it should NOT be auto-public.
      // Only the specific shell paths and /v2/assets/* are public.
      assert.strictEqual(isPublicPath('/v2/api/secret'), false);
      assert.strictEqual(isPublicPath('/v2/admin'), false);
    });

    test('pilot-gate bootstrap endpoints are public', () => {
      // These must reach their handlers without auth so the gate UI
      // can render and the password can be submitted.
      assert.strictEqual(isPublicPath('/api/pilot/status'), true);
      assert.strictEqual(isPublicPath('/api/auth/pilot-password'), true);
    });
  });
});
