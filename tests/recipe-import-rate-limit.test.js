'use strict';

// Verifies that the global rate-limit (server/http/security.js
// rateLimit) is enforced on the recipe-import endpoints. There is
// no endpoint-specific limit on /api/recipes/import* — the only
// budget is the global per-IP bucket, so this test exists to make
// sure a future refactor that introduces a fast-path or skips the
// middleware chain does not silently disable the limit on these
// endpoints. Recipe-import is a higher-cost path (LLM round-trip
// and image OCR), so abuse here is more expensive than a generic
// API call.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Drop the global rate-limit to a tiny window BEFORE startTestServer
// requires config.js. 4 hits + 1 trip + a few headroom requests fit
// comfortably inside the test budget without sleeping.
process.env.RATE_LIMIT_MAX = '4';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const { startTestServer, request } = require('./helpers');

let server;
let resetBuckets;
const TOKEN = 'recipe-import-rate-limit-1234567890abcdef';

before(async () => {
  server = await startTestServer({ authToken: TOKEN });
  ({ _resetRateLimitBuckets: resetBuckets } = require('../server/http/security'));
});

after(async () => {
  await server.close();
  delete process.env.RATE_LIMIT_MAX;
  delete process.env.RATE_LIMIT_WINDOW_MS;
});

test('POST /api/recipes/import is gated by the global rate limit', async () => {
  if (resetBuckets) resetBuckets();

  // Use a deliberately invalid body so the handler short-circuits at
  // validation rather than calling the LLM. The point is to exercise
  // the middleware chain, not the import service.
  const invalidBody = { text: '' };

  // Burn the entire budget — every reply should be < 429 (validation
  // 400 or similar). If any of these come back 429, the limit is set
  // too tight for the assertion.
  for (let i = 0; i < 4; i += 1) {
    const r = await request(server.baseUrl, 'POST', '/api/recipes/import', {
      token: TOKEN,
      body: invalidBody,
    });
    assert.notEqual(r.status, 429, `Request ${i + 1} tripped rate limit too early: ${r.status}`);
  }

  // The 5th hit must be 429 with Retry-After + rate-limit headers.
  const tripped = await request(server.baseUrl, 'POST', '/api/recipes/import', {
    token: TOKEN,
    body: invalidBody,
  });
  assert.equal(tripped.status, 429, `Expected 429 on 5th call, got ${tripped.status}`);
  assert.ok(tripped.headers['retry-after'], 'Retry-After header missing on 429');
  assert.equal(tripped.headers['x-ratelimit-limit'], '4');
  assert.equal(tripped.headers['x-ratelimit-remaining'], '0');
});

test('POST /api/recipes/import/image is gated by the same global limit', async () => {
  if (resetBuckets) resetBuckets();

  // Missing imageBase64 → 400 from handler. The middleware chain still
  // counts the hit before the handler runs, which is what we test.
  const invalidBody = { mime: 'image/png' };

  for (let i = 0; i < 4; i += 1) {
    const r = await request(server.baseUrl, 'POST', '/api/recipes/import/image', {
      token: TOKEN,
      body: invalidBody,
    });
    assert.notEqual(r.status, 429, `Image-import request ${i + 1} tripped too early: ${r.status}`);
  }

  const tripped = await request(server.baseUrl, 'POST', '/api/recipes/import/image', {
    token: TOKEN,
    body: invalidBody,
  });
  assert.equal(
    tripped.status,
    429,
    `Image import: expected 429 on 5th call, got ${tripped.status}`
  );
  assert.ok(tripped.headers['retry-after'], 'Retry-After header missing on 429');
});

test('rate limit is per-IP, not per-endpoint — different routes share the budget', async () => {
  if (resetBuckets) resetBuckets();

  // Two import calls + two unrelated calls should exhaust the budget
  // of 4. The fifth — regardless of endpoint — must trip.
  for (let i = 0; i < 2; i += 1) {
    const r = await request(server.baseUrl, 'POST', '/api/recipes/import', {
      token: TOKEN,
      body: { text: '' },
    });
    assert.notEqual(r.status, 429);
  }
  for (let i = 0; i < 2; i += 1) {
    const r = await request(server.baseUrl, 'GET', '/api/status', { token: TOKEN });
    assert.notEqual(r.status, 429);
  }

  const tripped = await request(server.baseUrl, 'POST', '/api/recipes/import/image', {
    token: TOKEN,
    body: { mime: 'image/png' },
  });
  assert.equal(
    tripped.status,
    429,
    `Expected the shared per-IP bucket to trip on 5th call, got ${tripped.status}`
  );
});
