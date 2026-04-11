// M5 frontend + PWA-tester (statisk analyse + HTTP-headers)
//
// Dekker:
//   1. Service worker-fil finnes og parser
//   2. SW har riktig cache-strategier (network-first for /api, cache-first for static)
//   3. /sw.js serves med Service-Worker-Allowed + Cache-Control
//   4. index.html har toast-container og offline-banner
//   5. Skeleton-loaders finnes i content-containers
//   6. SW-registrering finnes i init
//   7. CSP inkluderer worker-src + manifest-src
//   8. Manifest.json er gyldig PWA manifest

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, request } = require('./helpers');

const HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const SW_PATH = path.join(__dirname, '..', 'public', 'sw.js');
const MANIFEST_PATH = path.join(__dirname, '..', 'public', 'manifest.json');

describe('M5 · Statisk analyse', () => {
  test('public/sw.js finnes', () => {
    assert.ok(fs.existsSync(SW_PATH), 'sw.js mangler');
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.ok(sw.includes('self.addEventListener'), 'må være en service worker');
  });

  test('SW har install + activate + fetch handlers', () => {
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.ok(/addEventListener\(['"]install['"]/.test(sw));
    assert.ok(/addEventListener\(['"]activate['"]/.test(sw));
    assert.ok(/addEventListener\(['"]fetch['"]/.test(sw));
  });

  test('SW har versjonert cache-nøkkel', () => {
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.ok(/VERSION\s*=\s*['"]v/.test(sw), 'skal ha VERSION-konstant');
  });

  test('SW bruker network-first for /api/', () => {
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.ok(
      sw.includes('apiNetworkFirst') || sw.includes('network-first'),
      'SW må ha network-first strategi for API'
    );
  });

  test('SW returnerer 503 problem+json når offline uten cache', () => {
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.ok(sw.includes('application/problem+json'));
    assert.ok(sw.includes('status: 503'));
  });

  test('index.html har toast-container', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.ok(/id=['"]toastContainer['"]/.test(html));
    assert.ok(/role=['"]status['"]/.test(html), 'toast skal være aria role=status');
  });

  test('index.html har offline-banner', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.ok(/id=['"]offlineBanner['"]/.test(html));
  });

  test('index.html har showToast-funksjon', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.ok(/function showToast\(/.test(html));
  });

  test('index.html har SW-registrering i init', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.ok(html.includes("navigator.serviceWorker.register('/sw.js')"));
  });

  test('index.html har skeleton-loaders', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    assert.ok(html.includes('skeleton-card'));
    assert.ok(html.includes('skeleton-line'));
    // Content-containere må ha aria-busy=true mens skeleton vises
    assert.ok(/id=["']todayContent["'][^>]*aria-busy=["']true["']/.test(html));
  });

  test('manifest.json er gyldig', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assert.equal(manifest.name, 'Familieassistenten');
    assert.ok(manifest.short_name);
    assert.equal(manifest.display, 'standalone');
    assert.ok(Array.isArray(manifest.icons));
    assert.ok(manifest.icons.length >= 1);
    for (const icon of manifest.icons) {
      assert.ok(icon.src);
      assert.ok(icon.sizes);
    }
  });
});

// ============================================================
// Live-sjekker mot server
// ============================================================
describe('M5 · HTTP headers + CSP', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('GET /sw.js serves med Service-Worker-Allowed: /', async () => {
    const res = await request(server.baseUrl, 'GET', '/sw.js');
    assert.equal(res.status, 200);
    assert.equal(res.headers['service-worker-allowed'], '/');
    assert.ok(res.headers['cache-control']?.includes('no-cache'));
    assert.ok(res.headers['content-type']?.includes('javascript'));
  });

  test('GET /manifest.json serves korrekt', async () => {
    const res = await request(server.baseUrl, 'GET', '/manifest.json');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('json'));
  });

  test('CSP inkluderer worker-src self og manifest-src self', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp.includes("worker-src 'self'"));
    assert.ok(csp.includes("manifest-src 'self'"));
  });

  test('CSP er fortsatt strict (default-src self, object-src none)', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("object-src 'none'"));
  });
});
