'use strict';

// Portainer first-boot regression suite.
//
// Covers the two known-issue gates that blocked zero-config Portainer deploys:
//   1. /setup.html missing after Sprint 8 v1 cleanup
//   2. SESSION_SECRET crashloop when MAGIC_LINK_CONSOLE/RESEND is set
//      during BOOTSTRAP_MODE (fresh data volume, no bootstrap.json yet)
//
// Config-gate tests spawn a child process (same pattern as
// config-pilot-bypass.test.js) because loadConfig() calls process.exit(1).

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { startTestServer, request } = require('./helpers');
const { PUBLIC_PATHS } = require('../server/auth/middleware');

const REPO_ROOT = path.join(__dirname, '..');
const SETUP_HTML = path.join(REPO_ROOT, 'public', 'setup.html');

describe('Portainer bootstrap · setup.html asset', () => {
  test('public/setup.html exists on disk', () => {
    assert.ok(fs.existsSync(SETUP_HTML), 'public/setup.html must ship in the image');
  });

  test('setup.html is self-contained (no external /js/setup.js dependency)', () => {
    const html = fs.readFileSync(SETUP_HTML, 'utf8');
    assert.doesNotMatch(html, /src=["']\/js\/setup\.js["']/, 'must not depend on deleted setup.js');
    assert.match(html, /\/api\/bootstrap\/status/);
    assert.match(html, /\/api\/bootstrap\/complete/);
    assert.match(html, /\/api\/bootstrap\/generate-token/);
  });

  test('PUBLIC_PATHS includes /setup.html', () => {
    assert.ok(PUBLIC_PATHS.has('/setup.html'));
  });
});

describe('Portainer bootstrap · live server serves wizard', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('GET /setup.html → 200 without auth', async () => {
    const r = await request(server.baseUrl, 'GET', '/setup.html');
    assert.strictEqual(r.status, 200);
    assert.match(String(r.raw), /First-time setup|bootstrap|Auth token/i);
  });

  test('GET /api/bootstrap/status → 200', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/bootstrap/status');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body);
    assert.ok(['bootstrap', 'normal'].includes(r.body.mode));
  });
});

function loadConfigInChild(env, extraScript) {
  const clean = { ...process.env };
  delete clean.NODE_TEST_CONTEXT;
  delete clean.NODE_ENV;
  // Parent shells / CI often export these; wipe so each case is hermetic.
  delete clean.AUTH_TOKEN;
  delete clean.SESSION_SECRET;
  delete clean.ENCRYPTION_KEY;
  delete clean.GOOGLE_CLIENT_ID;
  delete clean.RESEND_API_KEY;
  delete clean.MAGIC_LINK_CONSOLE;
  delete clean.BOOTSTRAP_ALLOWED;
  delete clean.BOOTSTRAP_FILE;
  // Prevent accidental bootstrap.json / DB leakage from the host workspace.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-cfg-'));
  const script =
    extraScript ||
    "const {config}=require('./server/config');process.stdout.write(JSON.stringify({bootstrapMode:config.BOOTSTRAP_MODE,sessionSecret:Boolean(config.SESSION_SECRET)}));";

  return spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: {
      ...clean,
      // Point DB and bootstrap candidates at empty temp so dataVolumeLooksEmpty is true.
      DB_PATH: path.join(tmp, 'familieassistenten.db'),
      BOOTSTRAP_FILE: path.join(tmp, 'bootstrap.json'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('Portainer bootstrap · SESSION_SECRET gate in BOOTSTRAP_MODE', () => {
  test('production + MAGIC_LINK_CONSOLE + BOOTSTRAP_ALLOWED + empty volume → BOOTSTRAP_MODE, no crash', () => {
    const result = loadConfigInChild({
      NODE_ENV: 'production',
      BOOTSTRAP_ALLOWED: 'true',
      MAGIC_LINK_CONSOLE: 'true',
      // AUTH_TOKEN deliberately unset
      ALLOWED_ORIGINS: '*',
    });
    assert.strictEqual(
      result.status,
      0,
      `expected clean exit, got ${result.status}\nstderr=${result.stderr}\nstdout=${result.stdout}`
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.bootstrapMode, true);
  });

  test('production + BOOTSTRAP_ALLOWED + existing DB without secrets → recovery BOOTSTRAP_MODE', () => {
    // Simulates Portainer redeploy after a half-finished first boot left a
    // SQLite file but no AUTH_TOKEN / bootstrap.json (empty Published Ports).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-cfg-db-'));
    const dbPath = path.join(tmp, 'familieassistenten.db');
    fs.writeFileSync(dbPath, 'not-a-real-db-but-exists');
    const result = loadConfigInChild({
      NODE_ENV: 'production',
      BOOTSTRAP_ALLOWED: 'true',
      ALLOWED_ORIGINS: '*',
      DB_PATH: dbPath,
      BOOTSTRAP_FILE: path.join(tmp, 'bootstrap.json'),
    });
    assert.strictEqual(
      result.status,
      0,
      `expected clean exit in recovery bootstrap, got ${result.status}\nstderr=${result.stderr}\nstdout=${result.stdout}`
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.bootstrapMode, true);
  });

  test('production + MAGIC_LINK_CONSOLE + AUTH_TOKEN set + no SESSION_SECRET → exits 1', () => {
    const result = loadConfigInChild({
      NODE_ENV: 'production',
      AUTH_TOKEN: 'a'.repeat(40),
      ALLOWED_ORIGINS: 'http://example.com',
      MAGIC_LINK_CONSOLE: 'true',
      // SESSION_SECRET deliberately unset — normal mode must refuse
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /SESSION_SECRET is required/);
  });

  test('production + MAGIC_LINK_CONSOLE + AUTH_TOKEN + SESSION_SECRET → loads OK', () => {
    const result = loadConfigInChild({
      NODE_ENV: 'production',
      AUTH_TOKEN: 'a'.repeat(40),
      SESSION_SECRET: 'b'.repeat(64),
      ALLOWED_ORIGINS: 'http://example.com',
      MAGIC_LINK_CONSOLE: 'true',
    });
    assert.strictEqual(
      result.status,
      0,
      `expected clean exit, got ${result.status}\n${result.stderr}`
    );
  });
});
