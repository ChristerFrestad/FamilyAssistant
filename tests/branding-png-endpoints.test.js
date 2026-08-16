'use strict';

// Sprint-11 / issue #123 — PNG raster derivatives for the branding
// system. Five public endpoints rasterise the brand-aware SVG
// templates and return PNG buffers with a long browser-cache TTL.
//
// Sharp is loaded lazily inside the renderer so a deploy without
// the native bindings degrades to 503 + frontend SVG fallback. The
// tests verify:
//
//   - All five endpoints return 200 + the PNG magic number
//   - Cache-Control is 24 h (PNGs are expensive to regenerate)
//   - ETag is set, deterministic per brand-snapshot, and 304 on
//     If-None-Match
//   - Brand-config changes invalidate the cache (new env -> new
//     ETag, new bytes)
//   - The manifest icon-array includes the 192 + 512 PNG entries
//   - The renderer's in-memory cache returns the same buffer on
//     repeated calls within the same brand snapshot

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

async function startServerWithEnv(envPatch = {}) {
  const TRACKED = [
    'APP_NAME',
    'APP_NAME_PRIMARY',
    'APP_NAME_ACCENT',
    'APP_FAVICON_LETTER',
    'APP_TAGLINE',
    'APP_PRIMARY_COLOR',
    'APP_ACCENT_COLOR',
    'APP_DOT_COLOR',
    'NODE_ENV',
  ];
  const snapshot = {};
  for (const k of TRACKED) snapshot[k] = process.env[k];
  process.env.NODE_ENV = 'test';
  for (const [k, v] of Object.entries(envPatch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  const helpersPath = require.resolve(path.resolve(__dirname, 'helpers.js'));
  const configPath = require.resolve(path.resolve(__dirname, '..', 'server', 'config.js'));
  const rendererPath = require.resolve(
    path.resolve(__dirname, '..', 'server', 'branding', 'png-renderer.js')
  );
  delete require.cache[configPath];
  delete require.cache[helpersPath];
  delete require.cache[rendererPath];
  const { startTestServer, request } = require(helpersPath);
  const renderer = require(rendererPath);
  // Cold start the in-process renderer cache for deterministic tests.
  renderer.__cacheClear();
  const server = await startTestServer();
  return {
    server,
    request,
    renderer,
    restore: async () => {
      await server.close();
      for (const k of TRACKED) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
      }
      delete require.cache[configPath];
      delete require.cache[helpersPath];
      delete require.cache[rendererPath];
    },
  };
}

// PNG signature is the first 8 bytes: 89 50 4E 47 0D 0A 1A 0A.
function isPng(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

const ENDPOINTS = [
  { path: '/favicon-32.png', label: 'favicon-32' },
  { path: '/apple-touch-icon.png', label: 'apple-touch-icon' },
  { path: '/android-chrome-192.png', label: 'android-chrome-192' },
  { path: '/android-chrome-512.png', label: 'android-chrome-512' },
  { path: '/og-image.png', label: 'og-image' },
];

describe('Branding PNG endpoints', () => {
  for (const { path: url, label } of ENDPOINTS) {
    test(`GET ${url} returns 200 + valid PNG bytes + 24 h cache + ETag`, async () => {
      const { server, request, restore } = await startServerWithEnv({});
      try {
        const r = await request(server.baseUrl, 'GET', url, {});
        assert.equal(r.status, 200, `${label}: expected 200, got ${r.status}`);
        assert.equal(r.headers['content-type'], 'image/png');
        assert.match(r.headers['cache-control'], /max-age=86400/);
        if (url === '/og-image.png') {
          assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
        }
        assert.ok(r.headers.etag, `${label}: missing ETag header`);
        assert.match(r.headers.etag, /^"[a-f0-9]{16}"$/);
        assert.ok(
          isPng(r.bodyBuffer),
          `${label}: response body is not a PNG (first bytes: ${r.bodyBuffer.slice(0, 8).toString('hex')})`
        );
      } finally {
        await restore();
      }
    });
  }

  test('If-None-Match returns 304 + empty body', async () => {
    const { server, request, restore } = await startServerWithEnv({});
    try {
      const first = await request(server.baseUrl, 'GET', '/favicon-32.png', {});
      assert.equal(first.status, 200);
      const etag = first.headers.etag;
      const cached = await request(server.baseUrl, 'GET', '/favicon-32.png', {
        headers: { 'If-None-Match': etag },
      });
      assert.equal(cached.status, 304);
      assert.equal(cached.bodyBuffer.length, 0);
    } finally {
      await restore();
    }
  });

  test('different brand env-vars produce different ETags and different bytes', async () => {
    const a = await startServerWithEnv({
      APP_NAME: 'FamilyAssistant',
      APP_NAME_PRIMARY: 'Family',
      APP_NAME_ACCENT: 'Assistant',
      APP_FAVICON_LETTER: 'F',
    });
    const ra = await a.request(a.server.baseUrl, 'GET', '/apple-touch-icon.png', {});
    const etagA = ra.headers.etag;
    const bytesA = ra.bodyBuffer;
    await a.restore();

    const b = await startServerWithEnv({
      APP_NAME: 'Husby',
      APP_NAME_PRIMARY: 'Hus',
      APP_NAME_ACCENT: 'by',
      APP_FAVICON_LETTER: 'H',
    });
    const rb = await b.request(b.server.baseUrl, 'GET', '/apple-touch-icon.png', {});
    const etagB = rb.headers.etag;
    const bytesB = rb.bodyBuffer;
    await b.restore();

    assert.notStrictEqual(etagA, etagB, 'different brand should produce different ETag');
    // PNG bytes also differ because the rendered letter changes.
    assert.notStrictEqual(
      bytesA.toString('hex'),
      bytesB.toString('hex'),
      'rendered bytes should differ across brands'
    );
  });

  test('manifest.json icons include the 192 + 512 PNG entries', async () => {
    const { server, request, restore } = await startServerWithEnv({});
    try {
      const r = await request(server.baseUrl, 'GET', '/manifest.json', {});
      assert.equal(r.status, 200);
      const icons = r.body.icons;
      assert.ok(Array.isArray(icons), 'manifest.icons must be an array');
      const png192 = icons.find((i) => i.src === '/android-chrome-192.png');
      const png512 = icons.find((i) => i.src === '/android-chrome-512.png');
      assert.ok(png192, '192-PNG entry missing from manifest');
      assert.equal(png192.sizes, '192x192');
      assert.equal(png192.type, 'image/png');
      assert.ok(png512, '512-PNG entry missing from manifest');
      assert.equal(png512.sizes, '512x512');
    } finally {
      await restore();
    }
  });
});

describe('PNG renderer · cache + brand-snapshot hash', () => {
  test('brandSnapshotHash is deterministic for the same env-snapshot', async () => {
    const { renderer, restore } = await startServerWithEnv({});
    try {
      const config = require('../server/config').config;
      const h1 = renderer.brandSnapshotHash(config);
      const h2 = renderer.brandSnapshotHash(config);
      assert.strictEqual(h1, h2);
      assert.match(h1, /^[a-f0-9]{64}$/);
    } finally {
      await restore();
    }
  });

  test('renderer cache returns the same buffer instance on a hit', async () => {
    const { renderer, restore } = await startServerWithEnv({});
    try {
      const config = require('../server/config').config;
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>';
      const r1 = await renderer.renderPng({
        endpoint: 'unit-test',
        config,
        svg,
        width: 32,
        height: 32,
      });
      const r2 = await renderer.renderPng({
        endpoint: 'unit-test',
        config,
        svg,
        width: 32,
        height: 32,
      });
      assert.strictEqual(r1.buffer, r2.buffer, 'cache hit should reuse the same buffer ref');
      assert.strictEqual(r1.etag, r2.etag);
    } finally {
      await restore();
    }
  });
});
