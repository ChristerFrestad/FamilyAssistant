'use strict';

// Host-gated marketing site. Empty MARKETING_HOSTS must not change
// LAN / app behaviour. Apex Host serves crawlable HTML from marketing/.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, request } = require('./helpers');

const APEX = 'hverdagsplanleggeren.com';
const WWW = 'www.hverdagsplanleggeren.com';
const APP = 'app.hverdagsplanleggeren.com';
const REPO = path.join(__dirname, '..');
const V2_DIR = path.join(REPO, 'public', 'v2');
const V2_BACKUP = V2_DIR + '.marketing-test-backup';

let server;
let restoreBackup = false;

before(async () => {
  process.env.MARKETING_HOSTS = `${APEX},${WWW}`;
  process.env.MARKETING_CANONICAL = 'https://hverdagsplanleggeren.com';
  if (fs.existsSync(V2_DIR)) {
    fs.renameSync(V2_DIR, V2_BACKUP);
    restoreBackup = true;
  }
  fs.mkdirSync(path.join(V2_DIR, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(V2_DIR, 'index.html'),
    '<!doctype html><html><body><div id="root">spa fixture</div></body></html>'
  );
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
  delete process.env.MARKETING_HOSTS;
  delete process.env.MARKETING_CANONICAL;
  fs.rmSync(V2_DIR, { recursive: true, force: true });
  if (restoreBackup && fs.existsSync(V2_BACKUP)) {
    fs.renameSync(V2_BACKUP, V2_DIR);
  }
});

function get(path, host) {
  return request(server.baseUrl, 'GET', path, { headers: { Host: host } });
}

describe('marketing host routing', () => {
  test('apex GET / is crawlable HTML with the 5-second product sentence', async () => {
    const r = await get('/', APEX);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] || '', /text\/html/);
    assert.match(r.raw, /Ett sted for middag, gjøremål, kjøkkenet og handlelisten/);
    assert.match(r.raw, /<h1/);
    assert.match(r.raw, /Hverdagsplanleggeren er en norsk familieapp/);
    assert.equal(r.headers['x-robots-tag'], 'index, follow');
  });

  test('loopback GET / is not the marketing page', async () => {
    const r = await request(server.baseUrl, 'GET', '/');
    assert.notEqual(r.status, 301);
    assert.ok(
      !String(r.raw).includes('Ett sted for middag, gjøremål, kjøkkenet og handlelisten'),
      'LAN/app host must not receive the marketing homepage'
    );
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  });

  test('app host GET / is not marketing', async () => {
    const r = await get('/', APP);
    assert.ok(!String(r.raw).includes('Ett sted for middag, gjøremål, kjøkkenet og handlelisten'));
  });

  test('www GET / 301s to canonical apex', async () => {
    const r = await get('/', WWW);
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, 'https://hverdagsplanleggeren.com/');
  });

  test('apex /login and /dashboard stay the SPA on the same host', async () => {
    for (const p of ['/login', '/dashboard', '/login?mode=register']) {
      const r = await get(p, APEX);
      assert.equal(r.status, 200, p);
      assert.match(String(r.raw), /id="root"/, p);
      assert.ok(!String(r.raw).includes('Ett sted for middag'), p);
      assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', p);
    }
  });

  test('entity pages serve on apex', async () => {
    for (const p of ['/middag/', '/handleliste/', '/gjoremål/', '/slik-fungerer-det/', '/en/']) {
      const r = await get(p, APEX);
      assert.equal(r.status, 200, p);
      assert.match(r.raw, /<h1/);
    }
  });

  test('apex robots.txt allows crawlers and disallows app paths', async () => {
    const r = await get('/robots.txt', APEX);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Allow: \//);
    assert.match(r.raw, /Disallow: \/login/);
    assert.match(r.raw, /Disallow: \/dashboard/);
    assert.match(r.raw, /Sitemap: https:\/\/hverdagsplanleggeren.com\/sitemap.xml/);
    assert.match(r.raw, /GPTBot/);
  });

  test('app host robots.txt disallows everything', async () => {
    const r = await get('/robots.txt', APP);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Disallow: \//);
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  });

  test('llms.txt is the agent map', async () => {
    const r = await get('/llms.txt', APEX);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Hverdagsplanleggeren/);
    assert.match(r.raw, /middag, gjøremål/);
    assert.match(r.raw, /llms-full.txt/);
  });
});
