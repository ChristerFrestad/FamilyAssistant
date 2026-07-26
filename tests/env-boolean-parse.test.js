'use strict';

// Regression: Docker Compose / Portainer pass "false" as a string.
// z.coerce.boolean() treats Boolean("false") as true and used to turn
// PILOT_BYPASS / MAGIC_LINK_CONSOLE ON, crash-looping production.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

function loadConfig(env) {
  const clean = { ...process.env };
  delete clean.NODE_TEST_CONTEXT;
  delete clean.NODE_ENV;
  delete clean.AUTH_TOKEN;
  delete clean.SESSION_SECRET;
  delete clean.PILOT_BYPASS;
  delete clean.PILOT_BYPASS_PRODUCTION_ACK;
  delete clean.MAGIC_LINK_CONSOLE;
  delete clean.BOOTSTRAP_ALLOWED;
  delete clean.PILOT_MODE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-bool-'));
  const script =
    "const {config}=require('./server/config');process.stdout.write(JSON.stringify({pilotBypass:config.PILOT_BYPASS,magic:config.MAGIC_LINK_CONSOLE,bootstrap:config.BOOTSTRAP_ALLOWED,pilotMode:config.PILOT_MODE}));";
  return spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: {
      ...clean,
      DB_PATH: path.join(tmp, 'db.sqlite'),
      BOOTSTRAP_FILE: path.join(tmp, 'bootstrap.json'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('PILOT_BYPASS=false string is false in production Docker', () => {
  const r = loadConfig({
    NODE_ENV: 'production',
    BOOTSTRAP_ALLOWED: 'true',
    PILOT_BYPASS: 'false',
    MAGIC_LINK_CONSOLE: 'false',
    PILOT_MODE: 'false',
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.pilotBypass, false);
  assert.equal(j.magic, false);
  assert.equal(j.bootstrap, true);
  assert.equal(j.pilotMode, false);
});

test('PILOT_BYPASS=true string without ACK is refused in production', () => {
  const r = loadConfig({
    NODE_ENV: 'production',
    BOOTSTRAP_ALLOWED: 'true',
    PILOT_BYPASS: 'true',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PILOT_BYPASS=true is refused/);
});
