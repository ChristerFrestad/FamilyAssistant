'use strict';

// Phase 16 — static legal pages (privacy + terms).
//
// Sprint 8 (2026-05-05) trimmed the original suite: the v1 frontend was
// deleted, so the INDEX/LOGIN/SW assertions that verified v1 markup +
// service-worker pre-cache no longer have a test object. The legal
// pages survive because they are the only public HTML still served from
// public/ — the v2 React app handles everything else under /v2/.
//
// Verifies:
//   - /privacy.html and /terms.html and /privacy-en.html serve 200 anonymously
//   - The pages contain the expected section headings
//   - PUBLIC_PATHS export includes the three pages

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, request } = require('./helpers');
const { PUBLIC_PATHS } = require('../server/auth/middleware');

const PUBLIC = path.join(__dirname, '..', 'public');
const PRIVACY = fs.readFileSync(path.join(PUBLIC, 'privacy.html'), 'utf8');
const PRIVACY_EN = fs.readFileSync(path.join(PUBLIC, 'privacy-en.html'), 'utf8');
const TERMS = fs.readFileSync(path.join(PUBLIC, 'terms.html'), 'utf8');

describe('Phase 16 · Statisk innhold', () => {
  test('terms.html finnes og har forventede seksjoner', () => {
    assert.ok(TERMS.includes('<h1>Bruksvilkår</h1>'));
    assert.ok(/<h2>.*Tjenesten/i.test(TERMS));
    assert.ok(/<h2>.*Akseptabel bruk/i.test(TERMS));
    assert.ok(/<h2>.*AI-funksjoner/i.test(TERMS));
    assert.ok(/<h2>.*Oppsigelse/i.test(TERMS));
    assert.ok(/<h2>.*Lovvalg/i.test(TERMS));
  });

  test('privacy.html har forventede seksjoner', () => {
    assert.ok(PRIVACY.includes('<h1>Personvernerklæring</h1>'));
    assert.ok(/<h2>.*Hvilke data/i.test(PRIVACY));
    assert.ok(/<h2>.*Tredjeparts-prosessorer/i.test(PRIVACY));
    assert.ok(/<h2>.*Dine rettigheter/i.test(PRIVACY));
  });

  test('privacy.html har language-toggle til engelsk versjon', () => {
    assert.ok(/href=["']\/privacy-en\.html["']/.test(PRIVACY));
  });

  test('privacy.html har ikke lenger Backblaze B2 eller Google OAuth som aktive prosessorer', () => {
    assert.ok(!/<td>Backblaze B2<\/td>/.test(PRIVACY));
    assert.ok(!/<td>Google OAuth<\/td>/.test(PRIVACY));
  });

  test('privacy-en.html finnes og har English seksjoner', () => {
    assert.ok(PRIVACY_EN.includes('<h1>Privacy Policy</h1>'));
    assert.ok(/<h2>.*What data we collect/i.test(PRIVACY_EN));
    assert.ok(/<h2>.*Third-party processors/i.test(PRIVACY_EN));
    assert.ok(/<h2>.*Your rights/i.test(PRIVACY_EN));
  });

  test('privacy-en.html har language-toggle tilbake til norsk', () => {
    assert.ok(/href=["']\/privacy\.html["']/.test(PRIVACY_EN));
  });
});

describe('Phase 16 · PUBLIC_PATHS middleware', () => {
  test('PUBLIC_PATHS inkluderer /privacy.html og /terms.html', () => {
    assert.ok(PUBLIC_PATHS.has('/privacy.html'));
    assert.ok(PUBLIC_PATHS.has('/terms.html'));
  });

  test('PUBLIC_PATHS inkluderer /privacy-en.html (engelsk versjon)', () => {
    assert.ok(PUBLIC_PATHS.has('/privacy-en.html'));
  });

  test('PUBLIC_PATHS inkluderer /sw.js (tombstone, post-Sprint 8)', () => {
    // Sprint 8: sw.js is now a tombstone that unregisters the v1 service
    // worker installed in pre-existing browsers. It must remain reachable
    // anonymously so cached SWs can fetch and run their cleanup code.
    assert.ok(PUBLIC_PATHS.has('/sw.js'));
  });

  test('PUBLIC_PATHS inkluderer /setup.html (Portainer bootstrap wizard)', () => {
    // Restored after Sprint 8 accidentally deleted the wizard page.
    // Zero-config Docker/Portainer deploys depend on anonymous access.
    assert.ok(PUBLIC_PATHS.has('/setup.html'));
  });
});

describe('Phase 16 · Live server serves static pages anonymously', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('GET /privacy.html → 200 uten auth', async () => {
    const r = await request(server.baseUrl, 'GET', '/privacy.html');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.raw), /<h1>Personvernerklæring<\/h1>/);
  });

  test('GET /privacy-en.html → 200 uten auth', async () => {
    const r = await request(server.baseUrl, 'GET', '/privacy-en.html');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.raw), /<h1>Privacy Policy<\/h1>/);
  });

  test('GET /terms.html → 200 uten auth', async () => {
    const r = await request(server.baseUrl, 'GET', '/terms.html');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.raw), /<h1>Bruksvilkår<\/h1>/);
  });

  test('GET /sw.js → 200 (tombstone), unregister + cache-clear logic present', async () => {
    const r = await request(server.baseUrl, 'GET', '/sw.js');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.raw), /Tombstone service worker/);
    assert.match(String(r.raw), /registration\.unregister/);
    assert.match(String(r.raw), /caches\.delete/);
  });

  test('GET /setup.html → 200 (Portainer first-boot wizard)', async () => {
    const r = await request(server.baseUrl, 'GET', '/setup.html');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.raw), /First-time setup|Auth token/i);
    assert.match(String(r.raw), /\/api\/bootstrap\/complete/);
  });
});
