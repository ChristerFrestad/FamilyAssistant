'use strict';

// Verifies the PILOT_BYPASS safety belt in server/config.js.
//
// loadConfig() calls process.exit(1) on misconfiguration, which would kill
// the test runner. We therefore load config in a child process and assert
// on exit code + stderr. The child writes a tiny marker to stdout on
// success so we can distinguish clean loads from accidental exits.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

function loadConfigInChild(env) {
  // Strip NODE_TEST_CONTEXT so config.js does NOT auto-detect test mode
  // and skip the production guards we want to exercise.
  const clean = { ...process.env };
  delete clean.NODE_TEST_CONTEXT;
  delete clean.NODE_ENV;

  return spawnSync(
    process.execPath,
    [
      '-e',
      "const {config}=require('./server/config');process.stdout.write('PILOT_BYPASS='+config.PILOT_BYPASS);",
    ],
    {
      cwd: REPO_ROOT,
      env: { ...clean, ...env },
      encoding: 'utf8',
      timeout: 10_000,
    }
  );
}

test('PILOT_BYPASS=true + NODE_ENV=production + no ACK → exits 1', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'production',
    AUTH_TOKEN: 'a'.repeat(40),
    ALLOWED_ORIGINS: 'http://example.com',
    PILOT_BYPASS: 'true',
  });
  assert.notStrictEqual(result.status, 0, 'loadConfig should have exited non-zero');
  assert.match(result.stderr, /PILOT_BYPASS=true is refused/);
});

test('PILOT_BYPASS=true + NODE_ENV=production + ACK=true → loads OK', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'production',
    AUTH_TOKEN: 'a'.repeat(40),
    ALLOWED_ORIGINS: 'http://example.com',
    PILOT_BYPASS: 'true',
    PILOT_BYPASS_PRODUCTION_ACK: 'true',
  });
  assert.strictEqual(
    result.status,
    0,
    `expected clean exit, got ${result.status}\n${result.stderr}`
  );
  assert.strictEqual(result.stdout, 'PILOT_BYPASS=true');
});

test('PILOT_BYPASS=true + NODE_ENV=development → loads OK (dev is allowed)', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'development',
    PILOT_BYPASS: 'true',
  });
  assert.strictEqual(
    result.status,
    0,
    `expected clean exit, got ${result.status}\n${result.stderr}`
  );
  assert.strictEqual(result.stdout, 'PILOT_BYPASS=true');
});

test('PILOT_BYPASS default is false', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'development',
  });
  assert.strictEqual(
    result.status,
    0,
    `expected clean exit, got ${result.status}\n${result.stderr}`
  );
  assert.strictEqual(result.stdout, 'PILOT_BYPASS=false');
});

test('PILOT_BYPASS=true skips the production AUTH_TOKEN requirement', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'production',
    PILOT_BYPASS: 'true',
    PILOT_BYPASS_PRODUCTION_ACK: 'true',
    // No AUTH_TOKEN set — would normally exit 1 in production.
    ALLOWED_ORIGINS: 'http://example.com',
  });
  assert.strictEqual(
    result.status,
    0,
    `expected clean exit with PILOT_BYPASS, got ${result.status}\n${result.stderr}`
  );
  assert.strictEqual(result.stdout, 'PILOT_BYPASS=true');
});

test('PILOT_BYPASS=true allows ALLOWED_ORIGINS=* in production', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'production',
    PILOT_BYPASS: 'true',
    PILOT_BYPASS_PRODUCTION_ACK: 'true',
    AUTH_TOKEN: 'a'.repeat(40),
    ALLOWED_ORIGINS: '*',
  });
  assert.strictEqual(
    result.status,
    0,
    `expected clean exit with PILOT_BYPASS + '*' origins, got ${result.status}\n${result.stderr}`
  );
});

test('production still requires AUTH_TOKEN when PILOT_BYPASS is off', () => {
  const result = loadConfigInChild({
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'http://example.com',
    // No AUTH_TOKEN, no PILOT_BYPASS, no bootstrap.
  });
  assert.notStrictEqual(result.status, 0, 'loadConfig should still exit 1 without bypass');
  assert.match(result.stderr, /AUTH_TOKEN er p/);
});
