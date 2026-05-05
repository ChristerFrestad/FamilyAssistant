'use strict';

// Tests for the /v2/* sub-app handler in server/http/server.js.
//
// Sprint 8 (2026-05-05) revision: the legacy v1 frontend was deleted, so
// assertions that exercised /index.html and /js/core.js as legacy assets
// are gone. The remaining assertions verify:
//
//   1. GET /v2/ serves public/v2/index.html
//   2. GET /v2 (no trailing slash) serves public/v2/index.html
//   3. GET /v2/routing-test serves public/v2/index.html (SPA fallback)
//   4. GET /v2/nested/client/route also falls back to v2 index.html
//   5. GET /v2/assets/main.js serves the direct file
//   6. GET /v2/../etc/passwd is blocked (path traversal)
//   7. GET / redirects to /v2/ (root-redirect from PR #117)
//   8. GET /index.html → 404 (v1 deleted in Sprint 8)
//   9. GET /js/core.js → 404 (v1 assets deleted)
//  10. GET /api/unknown returns 404 (not HTML fallback)
//  11. With public/v2/ missing, /v2 returns 404 (no v1 fallback to leak to)
//
// The test creates a minimal public/v2/ fixture before running and
// restores any existing build after, so it works both before and after
// `npm run build:client` has populated public/v2/.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, request } = require('./helpers');

const REPO_ROOT = path.join(__dirname, '..');
const V2_DIR = path.join(REPO_ROOT, 'public', 'v2');
const V2_BACKUP = V2_DIR + '.test-backup';

let server;
let restoreBackup = false;

before(async () => {
  // If an existing Vite build is present, move it aside so the test
  // controls fixture contents. We restore it in after().
  if (fs.existsSync(V2_DIR)) {
    fs.renameSync(V2_DIR, V2_BACKUP);
    restoreBackup = true;
  }
  // Minimal fixture for the test.
  fs.mkdirSync(path.join(V2_DIR, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(V2_DIR, 'index.html'),
    '<!doctype html><html><body><div id="root">v2 test fixture</div></body></html>'
  );
  fs.writeFileSync(
    path.join(V2_DIR, 'assets', 'main.js'),
    '// v2 test fixture asset\nconsole.log("fixture");'
  );

  // Intentionally no authToken — static-serving does not require auth
  // for this test, and the LOCAL_USER legacy fallback keeps requests
  // flowing through to the static handler when AUTH_TOKEN is unset.
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
  // Remove fixture, restore backup if any.
  fs.rmSync(V2_DIR, { recursive: true, force: true });
  if (restoreBackup && fs.existsSync(V2_BACKUP)) {
    fs.renameSync(V2_BACKUP, V2_DIR);
  }
});

// ============================================================
// v2 serving
// ============================================================

test('GET /v2/ serves public/v2/index.html', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'), 'expected v2 fixture content');
});

test('GET /v2 (no trailing slash) serves public/v2/index.html', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'));
});

test('GET /v2/routing-test falls back to public/v2/index.html (SPA)', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/routing-test');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'), 'SPA fallback must serve the v2 index.html');
});

test('GET /v2/nested/client/route also falls back to v2 index.html', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/nested/client/route');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'));
});

test('GET /v2/assets/main.js serves the direct file', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/assets/main.js');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture asset'));
});

test('GET /v2/assets/../../etc/passwd is blocked (path traversal)', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/assets/../../etc/passwd');
  // The URL parser normalises the path so it leaves /v2/ entirely.
  // tryServeV2App returns false; the catch-all 404s. Either way no
  // file outside the public tree may leak.
  if (r.status === 200) {
    assert.ok(!r.raw.includes('root:'), 'must not leak /etc/passwd');
  } else {
    assert.ok(r.status === 404 || r.status === 403, `unexpected status ${r.status}`);
  }
});

// ============================================================
// V1 deletion contract (Sprint 8)
// ============================================================

test('GET / redirects to /v2/ (PR #117 root-redirect)', async () => {
  // The bare root is unconditionally redirected to /v2/. See
  // tests/root-redirect.test.js for the full matrix; this single
  // assertion ensures the v2-app-serving file also exercises it.
  const r = await request(server.baseUrl, 'GET', '/');
  assert.equal(r.status, 302);
  assert.strictEqual(r.headers.location || r.headers.Location, '/v2/');
});

test('GET /index.html → 404 (v1 deleted in Sprint 8)', async () => {
  // public/index.html no longer exists. The catch-all routes through
  // tryServeV2App (which only matches /v2/*) and tryServePublicFile
  // (which whitelists /privacy.html, /terms.html, etc.) and then 404s.
  const r = await request(server.baseUrl, 'GET', '/index.html');
  assert.equal(r.status, 404);
});

test('GET /js/core.js → 404 (v1 assets deleted in Sprint 8)', async () => {
  const r = await request(server.baseUrl, 'GET', '/js/core.js');
  assert.equal(r.status, 404);
});

test('GET /api/unknown returns 404 (not an HTML fallback)', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/unknown-endpoint');
  assert.equal(r.status, 404);
  assert.ok(!r.raw.includes('v2 test fixture'), '/api/* must never fall back to a v2 index.html');
});

// ============================================================
// Graceful degradation: public/v2/ missing (pre-build state)
// ============================================================

test('When public/v2/ is removed, /v2 returns 404 (no v1 fallback to leak)', async () => {
  // Temporarily hide the v2 fixture for this single test.
  fs.renameSync(V2_DIR, V2_DIR + '.hidden');
  try {
    const r = await request(server.baseUrl, 'GET', '/v2/anything');
    // Pre-Sprint 8 the catch-all fell through to legacy v1 SPA-fallback,
    // so this used to be 200 (v1 served). After v1 deletion the request
    // 404s cleanly — no leak, no crash.
    assert.equal(r.status, 404, 'expected 404 when v2 dir is missing');
  } finally {
    fs.renameSync(V2_DIR + '.hidden', V2_DIR);
  }
});
