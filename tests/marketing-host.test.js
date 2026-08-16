'use strict';

// Host-gated marketing site. Empty MARKETING_HOSTS must not change
// LAN / app behaviour. Apex Host serves crawlable HTML from marketing/.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, request } = require('./helpers');

const APEX = 'marketing.example';
const WWW = 'www.marketing.example';
const OTHER = 'other.example';
const REPO = path.join(__dirname, '..');
const V2_DIR = path.join(REPO, 'public', 'v2');
const V2_BACKUP = V2_DIR + '.marketing-test-backup';

let server;
let restoreBackup = false;

before(async () => {
  process.env.MARKETING_HOSTS = `${APEX},${WWW}`;
  process.env.MARKETING_CANONICAL = 'https://marketing.example';
  if (fs.existsSync(V2_DIR)) {
    fs.renameSync(V2_DIR, V2_BACKUP);
    restoreBackup = true;
  }
  fs.mkdirSync(path.join(V2_DIR, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(V2_DIR, 'index.html'),
    '<!doctype html><html><head><meta property="og:image" content="{{CANONICAL}}/og-image.png" /></head><body><div id="root">spa fixture</div></body></html>'
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
    assert.match(r.raw, /https:\/\/marketing.example\//);
    assert.doesNotMatch(r.raw, /\{\{CANONICAL\}\}/);
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

  test('unlisted host GET / is not marketing', async () => {
    const r = await get('/', OTHER);
    assert.ok(!String(r.raw).includes('Ett sted for middag, gjøremål, kjøkkenet og handlelisten'));
  });

  test('www GET / 301s to canonical apex', async () => {
    const r = await get('/', WWW);
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, 'https://marketing.example/');
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
    assert.match(r.raw, /Sitemap: https:\/\/marketing.example\/sitemap.xml/);
    assert.match(r.raw, /GPTBot/);
  });

  test('unlisted host robots.txt disallows everything', async () => {
    const r = await get('/robots.txt', OTHER);
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

  test('absolute-form URL without a path still serves the marketing homepage', async () => {
    const r = await request(server.baseUrl, 'GET', '/', {
      headers: { Host: APEX },
      rawPath: `https://${APEX}`,
    });
    assert.equal(r.status, 200);
    assert.match(r.raw, /Ett sted for middag, gjøremål, kjøkkenet og handlelisten/);
  });

  test('GET /<host> is treated as GET / on the marketing host', async () => {
    const r = await get(`/${APEX}`, APEX);
    assert.equal(r.status, 200);
    assert.match(r.raw, /Ett sted for middag, gjøremål, kjøkkenet og handlelisten/);
  });

  test('apex HEAD / is 200 with Content-Length and no body', async () => {
    const r = await request(server.baseUrl, 'HEAD', '/', { headers: { Host: APEX } });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] || '', /text\/html/);
    assert.ok(Number(r.headers['content-length']) > 100, r.headers['content-length']);
    assert.equal(r.raw, '');
    assert.notEqual(r.status, 501);
  });

  test('apex HEAD /login is 200 with Content-Length and no body', async () => {
    const r = await request(server.baseUrl, 'HEAD', '/login', { headers: { Host: APEX } });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] || '', /text\/html/);
    assert.ok(Number(r.headers['content-length']) > 0, r.headers['content-length']);
    assert.equal(r.raw, '');
  });

  test('Facebook crawler GET / is marketing HTML, not a challenge', async () => {
    const r = await request(server.baseUrl, 'GET', '/', {
      headers: {
        Host: APEX,
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      },
    });
    assert.equal(r.status, 200);
    assert.match(r.raw, /Ett sted for middag, gjøremål, kjøkkenet og handlelisten/);
    assert.doesNotMatch(r.raw, /Just a moment|Attention Required|cf-browser-verification/i);
  });

  test('Messenger UA GET / is marketing HTML, not SPA or /login', async () => {
    const r = await request(server.baseUrl, 'GET', '/', {
      headers: {
        Host: APEX,
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0;]',
      },
    });
    assert.equal(r.status, 200);
    assert.match(r.raw, /Ett sted for middag, gjøremål, kjøkkenet og handlelisten/);
    assert.doesNotMatch(r.raw, /id="root"/);
    assert.ok(!r.headers.location);
  });

  test('marketing GET / drops X-Frame-Options DENY so IAB can show the page', async () => {
    const r = await get('/', APEX);
    assert.equal(r.status, 200);
    assert.notEqual(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
    const csp = r.headers['content-security-policy'] || '';
    assert.doesNotMatch(csp, /frame-ancestors\s+'none'/);
  });

  test('SPA /login on the marketing host keeps clickjacking headers', async () => {
    const r = await get('/login', APEX);
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(r.headers['content-security-policy'] || '', /frame-ancestors\s+'none'/);
    assert.match(String(r.raw), /https:\/\/marketing\.example\/og-image\.png/);
    assert.doesNotMatch(String(r.raw), /\{\{CANONICAL\}\}/);
  });

  test('apex /fonts falls back to public/www when missing from marketing/', async () => {
    const wwwFonts = path.join(REPO, 'public', 'www', 'fonts');
    const dest = path.join(wwwFonts, 'qa-fallback.woff2');
    fs.mkdirSync(wwwFonts, { recursive: true });
    fs.writeFileSync(dest, 'woff2-fixture');
    try {
      const r = await get('/fonts/qa-fallback.woff2', APEX);
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'] || '', /font\/woff2/);
      assert.equal(String(r.raw), 'woff2-fixture');
    } finally {
      fs.rmSync(dest, { force: true });
    }
  });
});
