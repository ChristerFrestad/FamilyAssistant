'use strict';

// SPA serving: public/v2/ is the build folder, URLs have no /v2 prefix.
//
//   1. GET / serves public/v2/index.html
//   2. GET /login (and nested client routes) fall back to index.html
//   3. GET /assets/main.js serves the file
//   4. GET /v2 and /v2/* 301 to the unprefixed path
//   5. Path traversal is blocked
//   6. GET /js/core.js → 404 (v1 gone; assets without a file do not SPA-fallback)
//   7. GET /api/unknown → 404 JSON, never HTML
//   8. Missing public/v2/ → GET / is 404 (no v1 leak)

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
  if (fs.existsSync(V2_DIR)) {
    fs.renameSync(V2_DIR, V2_BACKUP);
    restoreBackup = true;
  }
  fs.mkdirSync(path.join(V2_DIR, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(V2_DIR, 'index.html'),
    '<!doctype html><html><body><div id="root">v2 test fixture</div></body></html>'
  );
  fs.writeFileSync(
    path.join(V2_DIR, 'assets', 'main.js'),
    '// v2 test fixture asset\nconsole.log("fixture");'
  );
  fs.writeFileSync(path.join(V2_DIR, 'sw.js'), 'self.addEventListener("fetch",()=>{});');

  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
  fs.rmSync(V2_DIR, { recursive: true, force: true });
  if (restoreBackup && fs.existsSync(V2_BACKUP)) {
    fs.renameSync(V2_BACKUP, V2_DIR);
  }
});

test('GET / serves public/v2/index.html', async () => {
  const r = await request(server.baseUrl, 'GET', '/');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'), 'expected SPA fixture content');
});

test('GET /login falls back to index.html (SPA)', async () => {
  const r = await request(server.baseUrl, 'GET', '/login');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'), 'SPA fallback must serve index.html');
});

test('GET /onboarding/family falls back to index.html', async () => {
  const r = await request(server.baseUrl, 'GET', '/onboarding/family');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture'));
});

test('GET /sw.js is not cached by intermediaries', async () => {
  const r = await request(server.baseUrl, 'GET', '/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers['cache-control'] || '', /no-store/);
  assert.equal(r.headers['service-worker-allowed'], '/');
});

test('GET /assets/main.js serves the direct file', async () => {
  const r = await request(server.baseUrl, 'GET', '/assets/main.js');
  assert.equal(r.status, 200);
  assert.ok(r.raw.includes('v2 test fixture asset'));
});

test('GET /v2/ 301-redirects to /', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/');
  assert.equal(r.status, 301);
  assert.strictEqual(r.headers.location || r.headers.Location, '/');
});

test('GET /v2/login?next=1 301-redirects to /login?next=1', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/login?next=1');
  assert.equal(r.status, 301);
  assert.strictEqual(r.headers.location || r.headers.Location, '/login?next=1');
});

test('GET /v2/assets/main.js 301-redirects to /assets/main.js', async () => {
  const r = await request(server.baseUrl, 'GET', '/v2/assets/main.js');
  assert.equal(r.status, 301);
  assert.strictEqual(r.headers.location || r.headers.Location, '/assets/main.js');
});

test('GET /assets/../../etc/passwd is blocked (path traversal)', async () => {
  const r = await request(server.baseUrl, 'GET', '/assets/../../etc/passwd');
  if (r.status === 200) {
    assert.ok(!r.raw.includes('root:'), 'must not leak /etc/passwd');
  } else {
    assert.ok(r.status === 404 || r.status === 403, `unexpected status ${r.status}`);
  }
});

test('GET /js/core.js → 404 (v1 deleted; missing assets do not SPA-fallback)', async () => {
  const r = await request(server.baseUrl, 'GET', '/js/core.js');
  assert.equal(r.status, 404);
});

test('GET /api/unknown returns 404 (not an HTML fallback)', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/unknown-endpoint');
  assert.equal(r.status, 404);
  assert.ok(!r.raw.includes('v2 test fixture'), '/api/* must never fall back to index.html');
});

test('When public/v2/ is removed, GET / returns 404 (no v1 fallback)', async () => {
  fs.renameSync(V2_DIR, V2_DIR + '.hidden');
  try {
    const r = await request(server.baseUrl, 'GET', '/');
    assert.equal(r.status, 404, 'expected 404 when SPA dir is missing');
  } finally {
    fs.renameSync(V2_DIR + '.hidden', V2_DIR);
  }
});
