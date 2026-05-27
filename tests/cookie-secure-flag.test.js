'use strict';

// Regression coverage for the 2026-05-04 cookie-Secure-flag fix.
//
// Bug: cookies were emitted with `Secure` whenever `NODE_ENV=production`,
// which made browsers silently drop them on plain-HTTP deploys (LAN
// pilot at http://192.168.50.123:7777). Pilot users solved the gate
// password but the cookie never persisted, so the next request was
// rejected by the pilot-gate.
//
// Fix: every cookie set by the auth layer now derives the `Secure` flag
// from `isSecureRequest(req)` exclusively — no `NODE_ENV` short-circuit.
// `isSecureRequest` already covers the three real signals:
//   1. process.env.HTTPS_TERMINATED === 'true' (operator opt-in for
//      reverse-proxy terminations like Cloudflare Tunnel)
//   2. X-Forwarded-Proto: https header (set by most TLS-terminating proxies)
//   3. socket.encrypted === true (direct HTTPS without proxy)
//
// Tests below run with NODE_ENV=production (the env that *triggered* the
// bug) and walk every combination of the three signals to verify the
// matrix matches expectations:
//
//   HTTPS_TERMINATED | X-Forwarded-Proto | socket.encrypted | Secure?
//   -----------------|-------------------|------------------|---------
//   true             | (any)             | (any)            | yes
//   (unset)          | https             | (any)            | yes
//   (unset)          | (other/unset)     | true             | yes
//   (unset)          | (other/unset)     | false            | NO  ← LAN pilot
//
// Cookies covered:
//   - fa_session   (server/auth/sessions.js: setSessionCookie / clearSessionCookie)
//   - fa_pilot     (server/auth/routes.js: setPilotCookie — accessed via the
//                   public POST /api/auth/pilot-password endpoint)
//   - fa_oauth_state (server/auth/routes.js: handleGoogleStart — accessed via
//                   GET /api/auth/google/start; only validated indirectly here
//                   via the helper since enabling Google requires GOOGLE_CLIENT_ID)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Reset module cache so the test gets fresh config each run, like other tests.
function clearServerCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(path.join('server', '')) || key.includes('server/')) {
      delete require.cache[key];
    }
  }
}

// Build a mock res that captures Set-Cookie headers like node:http would.
function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return headers[name];
    },
  };
}

// Build a mock req with a tunable env. The auth helpers read three things
// from req: req.headers.cookie, req.headers['x-forwarded-proto'], and
// req.socket.encrypted. We expose all three as parameters.
function mockReq({ xForwardedProto, encrypted } = {}) {
  return {
    headers: xForwardedProto ? { 'x-forwarded-proto': xForwardedProto } : {},
    socket: { encrypted: encrypted === true },
  };
}

// Read the value of a cookie attribute (e.g. 'Secure') out of a Set-Cookie
// header value. Returns true if the bare attribute is present, otherwise
// false. Case-insensitive on the attribute name.
function hasAttribute(setCookieHeader, attr) {
  if (!setCookieHeader) return false;
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const h of headers) {
    const parts = String(h).split(';');
    for (const p of parts) {
      if (p.trim().toLowerCase() === attr.toLowerCase()) return true;
    }
  }
  return false;
}

// Same, but locate the cookie by name first and inspect only that one.
function setCookieFor(setCookieHeader, cookieName) {
  if (!setCookieHeader) return null;
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const h of headers) {
    const first = String(h).split(';')[0].split('=')[0].trim();
    if (first === cookieName) return h;
  }
  return null;
}

// Drive the test under production-like env. Set BEFORE require so config
// validation picks up the flags. NODE_ENV=production triggers the env that
// previously made the bug observable; AUTH_TOKEN is required in production
// (server/config.js refuses to boot otherwise) so we provide a 32-char
// dummy that satisfies the validator.
process.env.NODE_ENV = 'production';
process.env.AUTH_TOKEN = 'cookie-secure-flag-test-token-1234567890abcdef';
process.env.SESSION_SECRET = 'test-session-secret-1234567890abcdef1234567890abcdef';
process.env.SESSION_COOKIE_NAME = 'fa_session';
process.env.PILOT_COOKIE_NAME = 'fa_pilot';
process.env.PILOT_MODE = 'true';
process.env.PILOT_PASSWORD = 'test-pilot-password';
process.env.ALLOWED_ORIGINS = 'http://localhost:7777';
process.env.LOG_LEVEL = 'fatal';

describe('Cookie Secure flag — production env, HTTP vs HTTPS detection', () => {
  let setSessionCookie;
  let clearSessionCookie;
  let isSecureRequest;
  let serializeCookie;

  before(() => {
    clearServerCache();
    ({
      setSessionCookie,
      clearSessionCookie,
      isSecureRequest,
    } = require('../server/auth/sessions'));
    ({ serializeCookie } = require('../server/auth/cookies'));
  });

  after(() => {
    delete process.env.HTTPS_TERMINATED;
  });

  describe('isSecureRequest helper', () => {
    test('HTTPS_TERMINATED=true → secure regardless of socket / header', () => {
      process.env.HTTPS_TERMINATED = 'true';
      try {
        assert.strictEqual(isSecureRequest(mockReq()), true);
        assert.strictEqual(
          isSecureRequest(mockReq({ xForwardedProto: 'http' })),
          true,
          'env-flag wins over header'
        );
      } finally {
        delete process.env.HTTPS_TERMINATED;
      }
    });

    test('X-Forwarded-Proto: https → secure', () => {
      delete process.env.HTTPS_TERMINATED;
      assert.strictEqual(isSecureRequest(mockReq({ xForwardedProto: 'https' })), true);
    });

    test('socket.encrypted=true → secure', () => {
      delete process.env.HTTPS_TERMINATED;
      assert.strictEqual(isSecureRequest(mockReq({ encrypted: true })), true);
    });

    test('LAN pilot (HTTP, no proxy headers) → NOT secure', () => {
      delete process.env.HTTPS_TERMINATED;
      assert.strictEqual(isSecureRequest(mockReq()), false);
      assert.strictEqual(
        isSecureRequest(mockReq({ xForwardedProto: 'http', encrypted: false })),
        false
      );
    });
  });

  describe('Session cookie (fa_session)', () => {
    test('LAN pilot env: NODE_ENV=production + HTTP → no Secure flag', () => {
      delete process.env.HTTPS_TERMINATED;
      const res = mockRes();
      setSessionCookie(res, mockReq(), 'session-id-1');
      const cookie = setCookieFor(res.headers['Set-Cookie'], 'fa_session');
      assert.ok(cookie, 'fa_session cookie must be set');
      assert.strictEqual(
        hasAttribute(cookie, 'Secure'),
        false,
        'Secure must NOT be set on plain HTTP — browsers would drop the cookie'
      );
      assert.ok(hasAttribute(cookie, 'HttpOnly'), 'HttpOnly must always be set');
    });

    test('Cloudflare Tunnel env (HTTPS_TERMINATED=true) → Secure flag set', () => {
      process.env.HTTPS_TERMINATED = 'true';
      try {
        const res = mockRes();
        setSessionCookie(res, mockReq(), 'session-id-2');
        const cookie = setCookieFor(res.headers['Set-Cookie'], 'fa_session');
        assert.ok(cookie);
        assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
      } finally {
        delete process.env.HTTPS_TERMINATED;
      }
    });

    test('Reverse proxy with x-forwarded-proto=https → Secure flag set', () => {
      delete process.env.HTTPS_TERMINATED;
      const res = mockRes();
      setSessionCookie(res, mockReq({ xForwardedProto: 'https' }), 'session-id-3');
      const cookie = setCookieFor(res.headers['Set-Cookie'], 'fa_session');
      assert.ok(cookie);
      assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
    });

    test('Direct HTTPS (socket.encrypted) → Secure flag set', () => {
      delete process.env.HTTPS_TERMINATED;
      const res = mockRes();
      setSessionCookie(res, mockReq({ encrypted: true }), 'session-id-4');
      const cookie = setCookieFor(res.headers['Set-Cookie'], 'fa_session');
      assert.ok(cookie);
      assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
    });

    test('clearSessionCookie respects the same matrix', () => {
      delete process.env.HTTPS_TERMINATED;

      // Plain HTTP — no Secure
      let res = mockRes();
      clearSessionCookie(res, mockReq());
      let cookie = setCookieFor(res.headers['Set-Cookie'], 'fa_session');
      assert.ok(cookie, 'clear must still emit a Set-Cookie');
      assert.strictEqual(hasAttribute(cookie, 'Secure'), false);

      // HTTPS_TERMINATED — Secure must match the original cookie that
      // we are trying to clear, otherwise some browsers will not match
      // and the cookie persists.
      process.env.HTTPS_TERMINATED = 'true';
      try {
        res = mockRes();
        clearSessionCookie(res, mockReq());
        cookie = setCookieFor(res.headers['Set-Cookie'], 'fa_session');
        assert.ok(cookie);
        assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
      } finally {
        delete process.env.HTTPS_TERMINATED;
      }
    });
  });

  describe('Pilot cookie (fa_pilot) — direct serializeCookie path', () => {
    // The pilot-cookie set-helper lives inside server/auth/routes.js (closed
    // over `req` and `res` from the request handler) and is not exported.
    // We exercise it via the public POST /api/auth/pilot-password endpoint
    // in a separate describe-block below using startTestServer. This
    // describe-block validates the underlying serializeCookie + isSecureRequest
    // contract that the pilot-cookie helper relies on, so the unit-level
    // wiring is covered without a full HTTP round-trip.

    test('serializeCookie + isSecureRequest emits no Secure on HTTP', () => {
      delete process.env.HTTPS_TERMINATED;
      const cookie = serializeCookie('fa_pilot', 'value', {
        maxAge: 86400,
        httpOnly: true,
        secure: isSecureRequest(mockReq()),
        sameSite: 'Lax',
        path: '/',
      });
      assert.strictEqual(hasAttribute(cookie, 'Secure'), false);
    });

    test('serializeCookie + isSecureRequest emits Secure on HTTPS_TERMINATED', () => {
      process.env.HTTPS_TERMINATED = 'true';
      try {
        const cookie = serializeCookie('fa_pilot', 'value', {
          maxAge: 86400,
          httpOnly: true,
          secure: isSecureRequest(mockReq()),
          sameSite: 'Lax',
          path: '/',
        });
        assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
      } finally {
        delete process.env.HTTPS_TERMINATED;
      }
    });
  });
});

// ============================================================
// Integration: actual HTTP round-trip on POST /api/auth/pilot-password
// ============================================================
//
// startTestServer hardcodes NODE_ENV=test, so the production env-bug cannot
// be reproduced via the normal helper. We still want to verify that the
// real handler path emits the cookie with the right flags when
// HTTPS_TERMINATED is toggled. The two-axis check (env-flag ON, env-flag
// OFF) is enough — the unit tests above already cover X-Forwarded-Proto
// and socket.encrypted. Together they prove every lookup path.

describe('Pilot cookie — full HTTP round-trip (POST /api/auth/pilot-password)', () => {
  // helpers.js sets NODE_ENV=test, so the bug-trigger (`secure` from
  // NODE_ENV alone) cannot manifest here. What we ARE testing: that the
  // real handler reads `isSecureRequest(req)` and that env-toggling is
  // observable on the wire. This guards against regression of the
  // ctx.req → setPilotCookie wiring (the `req` parameter add).
  let server;
  let baseUrl;

  before(async () => {
    process.env.PILOT_MODE = 'true';
    process.env.PILOT_PASSWORD = 'test-pilot-password';
    process.env.SESSION_SECRET = 'test-session-secret-1234567890abcdef1234567890abcdef';

    clearServerCache();
    require('../server/services/pilot-password.service').resetRateLimitForTests();

    const { startTestServer } = require('./helpers');
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
    delete process.env.HTTPS_TERMINATED;
  });

  test('HTTP request, no env-flag → fa_pilot Set-Cookie has no Secure', async () => {
    delete process.env.HTTPS_TERMINATED;
    const { request } = require('./helpers');
    const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
      body: { password: 'test-pilot-password' },
    });
    assert.strictEqual(r.status, 200);
    const setCookie = r.headers['set-cookie'];
    const cookie = setCookieFor(setCookie, 'fa_pilot');
    assert.ok(cookie, 'fa_pilot cookie must be present');
    assert.strictEqual(
      hasAttribute(cookie, 'Secure'),
      false,
      'Secure must NOT be set on plain HTTP'
    );
    assert.ok(hasAttribute(cookie, 'HttpOnly'));
  });

  test('HTTPS_TERMINATED=true → fa_pilot Set-Cookie has Secure', async () => {
    process.env.HTTPS_TERMINATED = 'true';
    try {
      // Reset rate-limit so this attempt isn't blocked by the previous one
      // (the test above may have used up an attempt for the same IP).
      require('../server/services/pilot-password.service').resetRateLimitForTests();
      const { request } = require('./helpers');
      const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
        body: { password: 'test-pilot-password' },
      });
      assert.strictEqual(r.status, 200);
      const setCookie = r.headers['set-cookie'];
      const cookie = setCookieFor(setCookie, 'fa_pilot');
      assert.ok(cookie);
      assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
    } finally {
      delete process.env.HTTPS_TERMINATED;
    }
  });

  test('X-Forwarded-Proto: https header → fa_pilot Set-Cookie has Secure', async () => {
    delete process.env.HTTPS_TERMINATED;
    require('../server/services/pilot-password.service').resetRateLimitForTests();
    const { request } = require('./helpers');
    const r = await request(baseUrl, 'POST', '/api/auth/pilot-password', {
      body: { password: 'test-pilot-password' },
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.strictEqual(r.status, 200);
    const setCookie = r.headers['set-cookie'];
    const cookie = setCookieFor(setCookie, 'fa_pilot');
    assert.ok(cookie);
    assert.strictEqual(hasAttribute(cookie, 'Secure'), true);
  });
});
