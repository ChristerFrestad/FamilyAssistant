'use strict';

// Tests for Fase 1a — the /v2/* sub-app handler in server/http/server.js.
//
// Verifies that:
//   1. GET /v2/ serves public/v2/index.html
//   2. GET /v2 (no trailing slash) serves public/v2/index.html
//   3. GET /v2/routing-test serves public/v2/index.html (SPA fallback)
//   4. GET /v2/assets/main.js serves the direct file
//   5. GET /v2/../etc/passwd is blocked (path traversal)
//   6. GET / still serves public/index.html (legacy app untouched)
//   7. GET /js/core.js still serves the existing legacy asset
//   8. GET /api/unknown returns 404 (not HTML fallback)
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
  assert.ok(
    r.raw.includes('v2 test fixture'),
    'SPA fallback should serve the v2 index.html, not the legacy one'
  );
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
  // Normalized by URL parsing — the path leaves /v2/ entirely, so tryServeV2App
  // returns false and either legacy fallback or 404 kicks in. Either way it
  // must NOT leak a file outside the public tree.
  // Accept 200 iff content is NOT /etc/passwd contents, or 404.
  if (r.status === 200) {
    assert.ok(!r.raw.includes('root:'), 'must not leak /etc/passwd');
  } else {
    assert.ok(r.status === 404 || r.status === 403, `unexpected status ${r.status}`);
  }
});

// ============================================================
// Legacy app isolation
// ============================================================

test('GET / still serves public/index.html (legacy app untouched)', async () => {
  const r = await request(server.baseUrl, 'GET', '/');
  assert.equal(r.status, 200);
  // Legacy index.html contains either 'Familieassistenten' or app-specific
  // strings. We assert that it does NOT contain our v2 fixture marker.
  assert.ok(!r.raw.includes('v2 test fixture'), 'legacy / must not fall through to v2 fixture');
});

test('GET /js/core.js still serves the existing legacy asset', async () => {
  const r = await request(server.baseUrl, 'GET', '/js/core.js');
  assert.equal(r.status, 200);
  assert.ok(!r.raw.includes('v2 test fixture'), 'legacy /js/core.js must not serve v2 fixture');
});

test('GET /api/unknown returns 404 (not an HTML fallback)', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/unknown-endpoint');
  assert.equal(r.status, 404);
  // Content-Type should indicate a problem+json body, not HTML.
  assert.ok(!r.raw.includes('v2 test fixture'), '/api/* must never fall back to a v2 index.html');
});

// ============================================================
// Graceful degradation: public/v2/ missing (pre-build state)
// ============================================================

test('When public/v2/ is removed, /v2 falls back to legacy SPA (never crashes)', async () => {
  // Temporarily hide the v2 fixture for this single test
  fs.renameSync(V2_DIR, V2_DIR + '.hidden');
  try {
    const r = await request(server.baseUrl, 'GET', '/v2/anything');
    // Without public/v2/, tryServeV2App returns false → legacy fallback runs.
    // The legacy app serves public/index.html. We just verify it doesn't crash
    // (200 or 404 both acceptable; the critical property is no 500).
    assert.ok(r.status === 200 || r.status === 404, `unexpected status ${r.status}`);
  } finally {
    fs.renameSync(V2_DIR + '.hidden', V2_DIR);
  }
});
