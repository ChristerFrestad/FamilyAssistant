'use strict';

// Phase 16 — static public pages + footer wiring.
//
// Verifies:
//   - /privacy.html and /terms.html serve 200 as unauthenticated (PUBLIC_PATHS)
//   - Both pages contain the expected section headings
//   - index.html has a footer with links to both pages
//   - login.html mentions both privacy and terms in its footer
//   - sw.js precaches the two static pages
//   - PUBLIC_PATHS export includes both

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
const INDEX = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const LOGIN = fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8');
const SW = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');

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

describe('Phase 16 · Footer-lenker', () => {
  test('index.html har app-footer med lenker til privacy + terms', () => {
    assert.ok(/<footer class=["']app-footer["']/.test(INDEX), 'app-footer mangler i index.html');
    assert.ok(/href=["']\/privacy\.html["']/.test(INDEX));
    assert.ok(/href=["']\/terms\.html["']/.test(INDEX));
  });

  test('login.html peker til både privacy og terms', () => {
    assert.ok(/href=["']\/privacy\.html["']/.test(LOGIN));
    assert.ok(/href=["']\/terms\.html["']/.test(LOGIN));
  });
});

describe('Phase 16 · SW precache av statiske sider', () => {
  test('sw.js inkluderer /privacy.html og /terms.html i STATIC_ASSETS', () => {
    assert.ok(SW.includes("'/privacy.html'"), '/privacy.html må precaches');
    assert.ok(SW.includes("'/terms.html'"), '/terms.html må precaches');
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
});
