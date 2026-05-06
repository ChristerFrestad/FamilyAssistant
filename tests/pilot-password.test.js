'use strict';

// Tests for the pre-auth pilot-password gate.
//
// Covers:
//   - GET /api/pilot/status reports correct flags in all four states
//     (PILOT_MODE on/off × cookie present/absent).
//   - POST /api/auth/pilot-password rejects empty / wrong / right passwords.
//   - Rate-limit kicks in after 5 attempts/IP/10 min and returns 429 with
//     Retry-After.
//   - Successful login sets the pilot cookie; subsequent /api/* calls go
//     through.
//   - Audit log records every attempt with success flag.
//   - When PILOT_MODE is off the gate is a no-op.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Set pilot env BEFORE startTestServer requires server modules.
process.env.PILOT_MODE = 'true';
process.env.PILOT_PASSWORD = 'pilot-secret-XYZ-123';

const { startTestServer, request } = require('./helpers');

// IMPORTANT: pilotPasswordService is required LAZILY inside resetEach()
// because helpers.startTestServer() clears server/* from require.cache
// when it loads. Requiring at the top would bind to a stale instance
// that the running server isn't using, so resetRateLimitForTests()
// would clear the wrong Map.
function pilotPasswordService() {
  return require('../server/services/pilot-password.service');
}

describe('Pilot password gate (PILOT_MODE=true)', () => {
  let server;
  let baseUrl;

  before(async () => {
    pilotPasswordService().resetRateLimitForTests();
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
  });

  // node:test does not propagate beforeEach into nested describe blocks,
  // so each sub-describe declares its own reset.
  function resetEach() {
    pilotPasswordService().resetRateLimitForTests();
  }

  describe('status endpoint', () => {
    beforeEach(resetEach);

    test('reports pilotMode=true, authenticated=false without cookie', async () => {
      const r = await request(baseUrl, 'GET', '/api/pilot/status');
      assert.strictEqual(r.status, 200);
      const body = JSON.parse(r.raw);
      assert.strictEqual(body.pilotMode, true);
      assert.strictEqual(body.pilotAuthenticated, false);
    });

    test('reports authenticated=true with valid cookie', async () => {
      const loginRes = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'pilot-secret-XYZ-123' },
      });
      const setCookie = loginRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      const cookieMatch = /fa_pilot=([^;]+)/.exec(cookieStr);
      assert.ok(cookieMatch, 'expected fa_pilot cookie');

      const r = await request(baseUrl, 'GET', '/api/pilot/status', {
        headers: { Cookie: `fa_pilot=${cookieMatch[1]}` },
      });
      const body = JSON.parse(r.raw);
      assert.strictEqual(body.pilotMode, true);
      assert.strictEqual(body.pilotAuthenticated, true);
    });
  });

  describe('password verification', () => {
    beforeEach(resetEach);

    test('wrong password returns 401 with attemptsRemaining', async () => {
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'wrong' },
      });
      assert.strictEqual(r.status, 401);
      const body = JSON.parse(r.raw);
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.code, 'wrong_password');
      assert.ok(typeof body.attemptsRemaining === 'number');
      assert.ok(body.attemptsRemaining >= 0 && body.attemptsRemaining <= 4);
    });

    test('empty password returns 401', async () => {
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: '' },
      });
      assert.strictEqual(r.status, 401);
      assert.strictEqual(JSON.parse(r.raw).code, 'wrong_password');
    });

    test('correct password returns 200 with HttpOnly Set-Cookie', async () => {
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'pilot-secret-XYZ-123' },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.raw).ok, true);
      const setCookie = r.headers['set-cookie'];
      assert.ok(setCookie, 'expected Set-Cookie header on success');
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      assert.match(cookieStr, /fa_pilot=/);
      assert.match(cookieStr, /HttpOnly/);
      assert.match(cookieStr, /SameSite=Lax/);
    });
  });

  describe('rate limit', () => {
    beforeEach(resetEach);

    test('after 5 failed attempts returns 429 with Retry-After header', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
          body: { password: 'wrong' },
        });
        assert.strictEqual(r.status, 401, `attempt ${i + 1} should be 401, got ${r.status}`);
      }
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'wrong' },
      });
      assert.strictEqual(r.status, 429);
      assert.ok(r.headers['retry-after'], 'expected Retry-After header on 429');
      const body = JSON.parse(r.raw);
      assert.strictEqual(body.code, 'rate_limited');
      assert.ok(typeof body.retryAfterSeconds === 'number');
    });

    test('rate-limited responses do not leak password correctness', async () => {
      for (let i = 0; i < 6; i++) {
        await request(baseUrl, 'POST', '/api/auth/pilot-password', {
          body: { password: 'wrong' },
        });
      }
      // Now the correct password should also be rate-limited.
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'pilot-secret-XYZ-123' },
      });
      assert.strictEqual(r.status, 429);
    });
  });

  describe('audit log', () => {
    beforeEach(resetEach);

    test('successful and failed attempts are recorded', async () => {
      await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'wrong' },
      });
      await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'pilot-secret-XYZ-123' },
      });
      const recent = server.repos.pilotPasswordAttempts.recent(10);
      assert.ok(recent.length >= 2);
      const success = recent.find((r) => r.success === 1);
      const failure = recent.find((r) => r.success === 0);
      assert.ok(success, 'expected at least one success row');
      assert.ok(failure, 'expected at least one failure row');
      assert.ok(success.ip_address, 'IP should be recorded');
      assert.ok(success.attempted_at, 'timestamp should be recorded');
    });
  });

  describe('middleware enforcement', () => {
    beforeEach(resetEach);

    test('no cookie → /api/auth/me returns 403', async () => {
      const r = await request(baseUrl, 'GET', '/api/auth/me');
      assert.strictEqual(r.status, 403);
    });

    test('with valid cookie → /api/auth/me proceeds (no longer 403)', async () => {
      const loginRes = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'pilot-secret-XYZ-123' },
      });
      const setCookie = loginRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      const cookieMatch = /fa_pilot=([^;]+)/.exec(cookieStr);
      const r = await request(baseUrl, 'GET', '/api/auth/me', {
        headers: { Cookie: `fa_pilot=${cookieMatch[1]}` },
      });
      assert.notStrictEqual(r.status, 403);
    });

    test('privacy.html bypasses the pilot gate', async () => {
      const r = await request(baseUrl, 'GET', '/privacy.html');
      assert.strictEqual(r.status, 200);
    });

    test('privacy-en.html bypasses the pilot gate', async () => {
      const r = await request(baseUrl, 'GET', '/privacy-en.html');
      assert.strictEqual(r.status, 200);
    });
  });

  // External auth flows must reach their handlers without solving the
  // pilot gate first — the link target IS the auth signal (HMAC-signed
  // magic-link token, OAuth state, invitation token). Bug fix
  // 2026-05-06: a real pilot user clicked a magic-link in their email
  // and got 403 Pilot password required because the verify endpoint
  // was not in the bypass list. Each test below asserts the gate does
  // not refuse the request — the handler is free to return whatever
  // it likes (including 4xx for invalid tokens), as long as the 403
  // is not the gate's "Pilot password required."
  describe('External auth flows bypass the pilot gate', () => {
    beforeEach(resetEach);

    function notPilotForbidden(r) {
      // The gate emits exactly: {title:'Forbidden',status:403,detail:'Pilot password required'}
      // Any 4xx with a different detail (e.g. invalid_token, not_found)
      // means the handler ran — that is the success criterion.
      if (r.status !== 403) return true;
      const detail = (r.body && r.body.detail) || '';
      return !/pilot password required/i.test(detail);
    }

    test('GET /api/auth/magic-link/verify reaches the handler', async () => {
      const r = await request(baseUrl, 'GET', '/api/auth/magic-link/verify?token=invalid');
      // Handler returns 401 / 4xx for an invalid token. The gate's 403
      // would block before the handler runs; either way the bug is
      // fixed if the response is NOT the gate's 403.
      assert.ok(
        notPilotForbidden(r),
        `magic-link verify should not be 403'd by pilot gate, got ${r.status} ${r.raw}`
      );
    });

    test('POST /api/auth/magic-link/start reaches the handler', async () => {
      const r = await request(baseUrl, 'POST', '/api/auth/magic-link/start', {
        body: { email: 'someone@example.com' },
      });
      // Handler returns 200 (idempotent send) or 503 if Resend not
      // configured. Anything other than the gate's 403 is fine.
      assert.ok(
        notPilotForbidden(r),
        `magic-link start should not be 403'd by pilot gate, got ${r.status} ${r.raw}`
      );
    });

    test('GET /api/invitations/:token reaches the handler', async () => {
      const r = await request(baseUrl, 'GET', '/api/invitations/some-fake-token');
      // Handler returns 404 / 410 for unknown / expired tokens.
      assert.ok(
        notPilotForbidden(r),
        `invitation peek should not be 403'd by pilot gate, got ${r.status} ${r.raw}`
      );
    });

    test('non-bypassed /api/* still 403s without pilot cookie', async () => {
      // Sanity check: the bypass is targeted, not a wholesale opening.
      // /api/today is a normal API path and must still demand the gate.
      const r = await request(baseUrl, 'GET', '/api/today');
      assert.strictEqual(r.status, 403);
      assert.match(r.body.detail, /pilot password required/i);
    });
  });

  // A valid session cookie means the visitor has already authenticated
  // (via magic-link, OAuth, or invitation accept) — the pilot-gate's
  // job is to keep ANONYMOUS visitors out, so an authenticated visitor
  // is by definition past that bar. Without this, every authenticated
  // user would 403 on every /api/* call until they ALSO entered the
  // pilot password, defeating the soft-launch UX.
  describe('Session cookie honored as pilot-auth', () => {
    beforeEach(resetEach);

    function makeSessionCookie(repos) {
      // Pre-create a user + session row directly in the repo, then
      // mint a cookie value matching SESSION_COOKIE_NAME.
      const user = repos.auth.createUser({
        email: `pilot-session-${Date.now()}@example.com`,
        name: 'Pilot Session User',
      });
      const sessionId = require('node:crypto').randomBytes(16).toString('hex');
      repos.auth.createSession({ id: sessionId, userId: user.id, ttlDays: 30 });
      return `fa_session=${sessionId}`;
    }

    test('valid session cookie → /api/auth/me proceeds (no pilot cookie needed)', async () => {
      const cookie = makeSessionCookie(server.repos);
      const r = await request(baseUrl, 'GET', '/api/auth/me', {
        headers: { Cookie: cookie },
      });
      // The handler MAY return 200 with user info or 401 for some
      // legacy reasons, but it MUST NOT be the gate's 403.
      assert.notStrictEqual(
        r.status,
        403,
        `session-authenticated /api/auth/me should not be 403'd, got ${r.status} ${r.raw}`
      );
    });

    test('garbage session cookie still 403s (gate refuses fake sessions)', async () => {
      // A cookie value that does not resolve to a real session must
      // not bypass the gate — otherwise we would let anyone through
      // by sending any random fa_session string.
      const r = await request(baseUrl, 'GET', '/api/auth/me', {
        headers: { Cookie: 'fa_session=this-is-not-a-real-session-id' },
      });
      assert.strictEqual(r.status, 403);
      assert.match(r.body.detail, /pilot password required/i);
    });
  });
});

describe('Pilot password gate (PILOT_MODE=false)', () => {
  let server;
  let baseUrl;

  before(async () => {
    delete process.env.PILOT_MODE;
    delete process.env.PILOT_PASSWORD;
    pilotPasswordService().resetRateLimitForTests();
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
    // Restore for any tests downstream.
    process.env.PILOT_MODE = 'true';
    process.env.PILOT_PASSWORD = 'pilot-secret-XYZ-123';
  });

  test('GET /api/pilot/status reports pilotMode=false, pilotAuthenticated=true', async () => {
    const r = await request(baseUrl, 'GET', '/api/pilot/status');
    const body = JSON.parse(r.raw);
    assert.strictEqual(body.pilotMode, false);
    assert.strictEqual(body.pilotAuthenticated, true);
  });

  test('POST /api/auth/pilot-password returns 503 pilot_disabled', async () => {
    const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
      body: { password: 'anything' },
    });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(JSON.parse(r.raw).code, 'pilot_disabled');
  });
});
