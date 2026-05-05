'use strict';

// Sprint 10 PR #122: integration tests for the four runtime branding
// endpoints. Each one is public (no auth) and serves brand-aware
// content based on the active env-vars. Sets per-test env, reloads
// config + the test server, and asserts on the rendered output.

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
  delete require.cache[configPath];
  delete require.cache[helpersPath];
  const { startTestServer, request } = require(helpersPath);
  const server = await startTestServer();
  return {
    server,
    request,
    restore: async () => {
      await server.close();
      for (const k of TRACKED) {
        if (snapshot[k] === undefined) delete process.env[k];
        else process.env[k] = snapshot[k];
      }
      delete require.cache[configPath];
      delete require.cache[helpersPath];
    },
  };
}

describe('Branding routes · /api/config', () => {
  test('returns the FamilyAssistant defaults with no env overrides', async () => {
    const { server, request, restore } = await startServerWithEnv({});
    try {
      const r = await request(server.baseUrl, 'GET', '/api/config', {});
      assert.equal(r.status, 200);
      assert.equal(r.body.appName, 'FamilyAssistant');
      assert.equal(r.body.namePrimary, 'Family');
      assert.equal(r.body.nameAccent, 'Assistant');
      assert.equal(r.body.faviconLetter, 'F');
      assert.equal(r.body.primaryColor, '#1F3F26');
      assert.match(r.headers['cache-control'], /max-age=3600/);
    } finally {
      await restore();
    }
  });

  test('returns Hverdagsplanleggeren when env overrides are set', async () => {
    const { server, request, restore } = await startServerWithEnv({
      APP_NAME: 'Hverdagsplanleggeren',
      APP_NAME_PRIMARY: 'Hverdags',
      APP_NAME_ACCENT: 'planleggeren',
      APP_FAVICON_LETTER: 'h',
      APP_TAGLINE: 'Planlegg middag, gjøremål og familie',
    });
    try {
      const r = await request(server.baseUrl, 'GET', '/api/config', {});
      assert.equal(r.status, 200);
      assert.equal(r.body.appName, 'Hverdagsplanleggeren');
      assert.equal(r.body.namePrimary, 'Hverdags');
      assert.equal(r.body.nameAccent, 'planleggeren');
      assert.equal(r.body.faviconLetter, 'h');
      assert.equal(r.body.tagline, 'Planlegg middag, gjøremål og familie');
    } finally {
      await restore();
    }
  });

  test('does not leak secret env-vars in the response', async () => {
    const { server, request, restore } = await startServerWithEnv({});
    try {
      const r = await request(server.baseUrl, 'GET', '/api/config', {});
      const json = JSON.stringify(r.body);
      // Secrets that must never reach the public config surface
      assert.doesNotMatch(json, /SESSION_SECRET/i);
      assert.doesNotMatch(json, /AUTH_TOKEN/i);
      assert.doesNotMatch(json, /RESEND_API_KEY/i);
      assert.doesNotMatch(json, /ENCRYPTION_KEY/i);
      assert.doesNotMatch(json, /PILOT_PASSWORD/i);
    } finally {
      await restore();
    }
  });
});

describe('Branding routes · /favicon.svg', () => {
  test('renders the configured letter inside the SVG', async () => {
    const { server, request, restore } = await startServerWithEnv({
      APP_NAME: 'Testapp',
      APP_NAME_PRIMARY: 'Test',
      APP_NAME_ACCENT: 'app',
      APP_FAVICON_LETTER: 'T',
      APP_TAGLINE: 'A test app',
    });
    try {
      const r = await request(server.baseUrl, 'GET', '/favicon.svg', {});
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /image\/svg\+xml/);
      // Letter is escaped via XML entities; "T" survives plain
      assert.match(r.body, />T<\/text>/);
      assert.match(r.body, /<title>Testapp<\/title>/);
    } finally {
      await restore();
    }
  });

  test('falls back to F for missing or invalid letter at runtime', async () => {
    const { server, request, restore } = await startServerWithEnv({});
    try {
      const r = await request(server.baseUrl, 'GET', '/favicon.svg', {});
      assert.equal(r.status, 200);
      assert.match(r.body, />F<\/text>/);
    } finally {
      await restore();
    }
  });
});

describe('Branding routes · /logo-mark.svg', () => {
  test('renders the larger logo-mark SVG with brand letter', async () => {
    const { server, request, restore } = await startServerWithEnv({
      APP_FAVICON_LETTER: 'h',
    });
    try {
      const r = await request(server.baseUrl, 'GET', '/logo-mark.svg', {});
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /image\/svg\+xml/);
      assert.match(r.body, />h<\/text>/);
      assert.match(r.body, /viewBox="0 0 120 120"/);
    } finally {
      await restore();
    }
  });
});

describe('Branding routes · /manifest.json', () => {
  test('returns brand-aware PWA manifest', async () => {
    const { server, request, restore } = await startServerWithEnv({
      APP_NAME: 'Testapp',
      APP_NAME_PRIMARY: 'Test',
      APP_NAME_ACCENT: 'app',
      APP_FAVICON_LETTER: 'T',
      APP_TAGLINE: 'A test app',
      APP_PRIMARY_COLOR: '#112233',
    });
    try {
      const r = await request(server.baseUrl, 'GET', '/manifest.json', {});
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /manifest\+json/);
      assert.equal(r.body.name, 'Testapp');
      assert.equal(r.body.short_name, 'Testapp');
      assert.equal(r.body.description, 'A test app');
      assert.equal(r.body.theme_color, '#112233');
      assert.equal(r.body.start_url, '/v2/');
      assert.equal(r.body.scope, '/v2/');
      assert.ok(Array.isArray(r.body.icons));
      assert.ok(r.body.icons.some((i) => i.src === '/favicon.svg'));
    } finally {
      await restore();
    }
  });
});

describe('Branding routes · white-label end-to-end', () => {
  test('one image serves Testapp with isolated env (E2E isolation)', async () => {
    const { server, request, restore } = await startServerWithEnv({
      APP_NAME: 'Testapp',
      APP_NAME_PRIMARY: 'Test',
      APP_NAME_ACCENT: 'app',
      APP_FAVICON_LETTER: 'T',
      APP_TAGLINE: 'Test tagline',
    });
    try {
      const config = await request(server.baseUrl, 'GET', '/api/config', {});
      assert.equal(config.body.appName, 'Testapp');

      const fav = await request(server.baseUrl, 'GET', '/favicon.svg', {});
      assert.match(fav.body, />T<\/text>/);

      const manifest = await request(server.baseUrl, 'GET', '/manifest.json', {});
      assert.equal(manifest.body.name, 'Testapp');
    } finally {
      await restore();
    }
  });
});
