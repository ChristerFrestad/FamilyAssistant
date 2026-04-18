// Phase 14 — service worker multi-tenant hardening
//
// Dekker:
//   1. sw.js precacher login/onboarding/invite + auth.js/family-*.js
//   2. sw.js har en liste med tenant-sensitive API-prefikser som IKKE caches
//   3. sw.js evicter API-cache på 401/403
//   4. sw.js har en CLEAR_API_CACHE message-handler
//   5. VERSION er bumpet til v1.4-phase14 (tvinger cache-refresh ved deploy)
//   6. auth.js sender CLEAR_API_CACHE til SW ved logout
//   7. manifest.json refererer kun eksisterende ikoner

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const SW = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
const AUTH_JS = fs.readFileSync(path.join(PUBLIC, 'js', 'auth.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'));

describe('Phase 14 · SW pre-cache av auth/family-sider', () => {
  test('STATIC_ASSETS inkluderer login/onboarding/invite HTML', () => {
    assert.ok(SW.includes("'/login.html'"), 'login.html må precaches');
    assert.ok(SW.includes("'/onboarding.html'"), 'onboarding.html må precaches');
    assert.ok(SW.includes("'/invite.html'"), 'invite.html må precaches');
  });

  test('STATIC_ASSETS inkluderer auth/family JS-moduler', () => {
    assert.ok(SW.includes("'/js/auth.js'"), 'auth.js må precaches');
    assert.ok(SW.includes("'/js/family-ui.js'"), 'family-ui.js må precaches');
    assert.ok(SW.includes("'/js/family-onboarding.js'"), 'family-onboarding.js må precaches');
  });

  test('alle precachede filer eksisterer faktisk på disk', () => {
    const match = SW.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/);
    assert.ok(match, 'STATIC_ASSETS-liste ikke funnet');
    const assets = Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
    for (const a of assets) {
      if (a === '/') continue; // rot-rute serveres dynamisk
      const p = path.join(PUBLIC, a.replace(/^\//, ''));
      assert.ok(fs.existsSync(p), `precachet asset ${a} eksisterer ikke på disk`);
    }
  });
});

describe('Phase 14 · Tenant-sensitive endpoints ikke caches', () => {
  test('NO_CACHE_API_PREFIXES dekker auth/family/llm-config/invitations/onboarding/gdpr', () => {
    const match = SW.match(/NO_CACHE_API_PREFIXES = \[([\s\S]*?)\];/);
    assert.ok(match, 'NO_CACHE_API_PREFIXES mangler');
    const list = match[1];
    assert.ok(list.includes("'/api/auth/'"));
    assert.ok(list.includes("'/api/family"));
    assert.ok(list.includes("'/api/llm-config"));
    assert.ok(list.includes("'/api/invitations"));
    assert.ok(list.includes("'/api/onboarding"));
    assert.ok(list.includes("'/api/gdpr"));
  });

  test('fetch-handleren sjekker isNoCacheApi og bruker apiNetworkOnly', () => {
    assert.ok(SW.includes('isNoCacheApi'));
    assert.ok(SW.includes('apiNetworkOnly'));
    assert.ok(
      /isNoCacheApi\(url\.pathname\)[\s\S]{0,80}apiNetworkOnly/.test(SW),
      'network-only må grenes på isNoCacheApi(url.pathname)'
    );
  });

  test('apiNetworkOnly cacher ingen responser', () => {
    const fn = SW.match(/async function apiNetworkOnly\([\s\S]*?\n\}/);
    assert.ok(fn, 'apiNetworkOnly-funksjon ikke funnet');
    assert.ok(!fn[0].includes('cache.put'), 'network-only skal aldri skrive til cache');
  });
});

describe('Phase 14 · Cache-invalidering ved 401/403', () => {
  test('apiNetworkFirst sletter API_CACHE ved 401/403', () => {
    const fn = SW.match(/async function apiNetworkFirst\([\s\S]*?\n\}/);
    assert.ok(fn, 'apiNetworkFirst-funksjon ikke funnet');
    assert.ok(
      /(401|403)[\s\S]*?(403|401)[\s\S]*?caches\.delete\(API_CACHE\)/.test(fn[0]),
      'må slette API_CACHE på 401/403'
    );
  });

  test('apiNetworkOnly sletter API_CACHE ved 401/403', () => {
    const fn = SW.match(/async function apiNetworkOnly\([\s\S]*?\n\}/);
    assert.ok(fn);
    assert.ok(
      /(401|403)[\s\S]*?(403|401)[\s\S]*?caches\.delete\(API_CACHE\)/.test(fn[0]),
      'må slette API_CACHE på 401/403'
    );
  });
});

describe('Phase 14 · Message-handler', () => {
  test('CLEAR_API_CACHE message tømmer kun API_CACHE', () => {
    assert.ok(SW.includes("type === 'CLEAR_API_CACHE'"));
    assert.ok(
      /CLEAR_API_CACHE[\s\S]*?caches\.delete\(API_CACHE\)/.test(SW),
      'CLEAR_API_CACHE må delete(API_CACHE)'
    );
  });
});

describe('Phase 14 · VERSION bump', () => {
  test('VERSION er v1.4-phase14', () => {
    assert.ok(
      /VERSION\s*=\s*['"]v1\.4-phase14['"]/.test(SW),
      'VERSION må være bumpet for phase 14 så gamle caches purges'
    );
  });
});

describe('Phase 14 · auth.js logout sender CLEAR_API_CACHE', () => {
  test('logout() postMessager CLEAR_API_CACHE til SW', () => {
    const fn = AUTH_JS.match(/async function logout\([\s\S]*?\n\}/);
    assert.ok(fn, 'logout()-funksjon ikke funnet');
    assert.ok(
      /serviceWorker[\s\S]*?postMessage\(\{\s*type:\s*['"]CLEAR_API_CACHE['"]/.test(fn[0]),
      'logout skal sende CLEAR_API_CACHE til SW'
    );
  });

  test('logout() omdirigerer fortsatt til /login.html etter cache-clear', () => {
    const fn = AUTH_JS.match(/async function logout\([\s\S]*?\n\}/);
    assert.ok(fn[0].includes('/login.html'));
  });
});

describe('Phase 14 · Manifest refererer kun eksisterende ikoner', () => {
  test('alle manifest-ikoner finnes på disk', () => {
    for (const icon of MANIFEST.icons) {
      const p = path.join(PUBLIC, icon.src.replace(/^\//, ''));
      assert.ok(fs.existsSync(p), `manifest-ikon ${icon.src} mangler på disk`);
    }
  });
});
