'use strict';

// Tests for the strict /api/auth/* rate limit added in Sprint 1 /
// Prompt 2 (server/http/security.js applyAuthRateLimit). The default
// budget is 5 attempts per 15 minutes per IP — we override the env
// to a tiny window for the test so we can exercise both the trip
// and the recovery without sleeping for 15 real minutes.
//
// The non-auth global rate limit is exercised separately by other
// tests; this file is only about the strict auth bucket.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Override the auth rate-limit defaults BEFORE startTestServer requires
// config.js. Set the threshold low enough to trip in 6 requests and
// the window short enough to recover in test-runtime.
process.env.AUTH_RATE_LIMIT_MAX = '3';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '500';

const { startTestServer, request } = require('./helpers');

let server;
let resetBuckets;

before(async () => {
  server = await startTestServer({ authToken: 'auth-rate-limit-test-1234567890abcd' });
  // Resolve the helper through the same require chain the server
  // uses, so we manipulate the SAME bucket maps the rate-limiter
  // reads from.
  ({ _resetRateLimitBuckets: resetBuckets } = require('../server/http/security'));
});

after(async () => {
  await server.close();
  delete process.env.AUTH_RATE_LIMIT_MAX;
  delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
});

beforeEach(() => {
  // Reset both buckets before every test so the order in which Node's
  // test runner schedules tests does not matter.
  if (resetBuckets) resetBuckets();
});

test('auth rate limit trips after AUTH_RATE_LIMIT_MAX requests', async () => {
  // Hit the magic-link start endpoint three times — each one is a
  // valid auth attempt (config returns 503 because Resend is not
  // configured, which still consumes the rate-limit budget).
  for (let i = 0; i < 3; i++) {
    const r = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: `attempt${i}@example.com` },
    });
    // Status under 429 (could be 200/400/503 depending on env). The
    // important thing is that the rate-limiter let it through.
    assert.notEqual(r.status, 429, `Request ${i} hit rate limit too early: ${r.status}`);
  }

  // Fourth request must be 429 — strict rate limit tripped.
  const tripped = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
    body: { email: 'attempt4@example.com' },
  });
  assert.equal(tripped.status, 429, `Expected 429 on 4th attempt, got ${tripped.status}`);
  // Retry-After header should be set with seconds remaining.
  assert.ok(tripped.headers['retry-after'], 'Retry-After header missing on 429');
  // X-Auth-RateLimit-Limit header should advertise the budget.
  assert.equal(tripped.headers['x-auth-ratelimit-limit'], '3');
  assert.equal(tripped.headers['x-auth-ratelimit-remaining'], '0');
});

test('error message identifies the strict auth bucket, not the global one', async () => {
  // Saturate the bucket.
  for (let i = 0; i < 3; i++) {
    await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: `e${i}@example.com` },
    });
  }
  const tripped = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
    body: { email: 'last@example.com' },
  });
  assert.equal(tripped.status, 429);
  // The thrown HttpError should mention "Auth rate limit" so logs
  // can split brute-force traffic from generic 429s.
  const message = JSON.stringify(tripped.body).toLowerCase();
  assert.ok(
    message.includes('auth rate limit'),
    `Expected "Auth rate limit" in error message, got: ${JSON.stringify(tripped.body)}`
  );
});

test('non-auth routes are unaffected by the strict auth bucket', async () => {
  // Saturate the auth bucket first.
  for (let i = 0; i < 3; i++) {
    await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: `e${i}@example.com` },
    });
  }
  // Now the auth bucket is full. A non-auth endpoint should still respond
  // normally (it only counts against the global bucket, which has 300/min
  // headroom in the default config).
  const r = await request(server.baseUrl, 'GET', '/health');
  assert.equal(r.status, 200, `/health was incorrectly rate-limited: ${r.status}`);
});

test('window expiry releases the bucket and lets new requests through', async () => {
  for (let i = 0; i < 3; i++) {
    await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: `early${i}@example.com` },
    });
  }
  // Confirm we are tripped.
  const trip = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
    body: { email: 'trip@example.com' },
  });
  assert.equal(trip.status, 429);

  // Wait out the window (we set it to 500 ms above for fast tests).
  await new Promise((r) => setTimeout(r, 600));

  const recovered = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
    body: { email: 'recovered@example.com' },
  });
  // After window expiry, the request should pass the rate-limiter.
  assert.notEqual(recovered.status, 429, `Bucket did not recover: ${recovered.status}`);
});

// ----------------------------------------------------------------
// Scope tests — ensure non-trigger auth endpoints stay reachable
// even when the strict bucket is saturated.
//
// PR #76 hotfix: the Sprint 1 implementation applied the strict
// bucket to every /api/auth/* request, which meant /api/auth/me
// (called on every frontend route change) and /api/auth/logout
// got rate-limited along with the actual brute-force-targets.
// After 5 navigations a real user got locked out of the app and
// could no longer request a fresh magic-link either.
//
// These tests pin down the new scope: only POST /api/auth/magic-link/start
// and GET /api/auth/google/start hit the strict bucket. Everything
// else falls back to the global limit (300/min default).
// ----------------------------------------------------------------

test('GET /api/auth/me is NOT in the strict auth bucket', async () => {
  // Hit /me more than AUTH_RATE_LIMIT_MAX times. None of the
  // responses should be 429 — the user must be able to keep
  // navigating around the app without tripping the brute-force
  // limiter.
  for (let i = 0; i < 6; i++) {
    const r = await request(server.baseUrl, 'GET', '/api/auth/me');
    assert.notEqual(r.status, 429, `Request ${i + 1} to /me incorrectly rate-limited`);
    // /me returns 200 with authenticated:false when there is no
    // session cookie; we only care that the rate-limiter let it
    // through.
    assert.ok(r.status === 200 || r.status === 401, `/me returned unexpected status ${r.status}`);
  }
});

test('POST /api/auth/logout is NOT in the strict auth bucket', async () => {
  for (let i = 0; i < 6; i++) {
    const r = await request(server.baseUrl, 'POST', '/api/auth/logout', { body: {} });
    assert.notEqual(r.status, 429, `Request ${i + 1} to /logout incorrectly rate-limited`);
  }
});

test('GET /api/auth/magic-link/verify is NOT in the strict auth bucket', async () => {
  // Without a token the handler returns 400 — but the rate-limiter
  // runs first, so what we are pinning down is "the limiter never
  // returned 429 even after >MAX requests".
  for (let i = 0; i < 6; i++) {
    const r = await request(server.baseUrl, 'GET', '/api/auth/magic-link/verify');
    assert.notEqual(r.status, 429, `Request ${i + 1} to /verify incorrectly rate-limited`);
  }
});

test('saturating magic-link/start does NOT lock the user out of /api/auth/me', async () => {
  // Reproduces the exact bug Christer hit during manual end-to-end
  // testing of PR #76: after a few magic-link attempts the same IP
  // could no longer reach /me, so the frontend's AuthContext kept
  // throwing on mount. Buckets are now independent.
  for (let i = 0; i < 4; i++) {
    await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: `victim${i}@example.com` },
    });
  }
  // The auth bucket is now saturated; the next magic-link/start MUST
  // return 429 — the strict scope is still in effect for the
  // legitimate target.
  const tripped = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
    body: { email: 'last@example.com' },
  });
  assert.equal(tripped.status, 429);

  // But /me should still respond normally.
  const me = await request(server.baseUrl, 'GET', '/api/auth/me');
  assert.notEqual(me.status, 429, `/me was incorrectly blocked: ${me.status}`);
});
