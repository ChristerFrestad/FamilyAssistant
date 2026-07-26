'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ensureDockerDeploySecrets,
  isZeroConfigDeploy,
  scrubWeakSecretEnv,
} = require('../server/auth/docker-deploy-secrets');

const REPO_ROOT = path.join(__dirname, '..');

describe('isZeroConfigDeploy / scrub', () => {
  test('scrubWeakSecretEnv drops short SESSION_SECRET and AUTH_TOKEN', () => {
    process.env.AUTH_TOKEN = 'short';
    process.env.SESSION_SECRET = 'tooshort';
    process.env.MAGIC_LINK_CONSOLE = 'false';
    scrubWeakSecretEnv();
    assert.equal(process.env.AUTH_TOKEN, undefined);
    assert.equal(process.env.SESSION_SECRET, undefined);
  });

  test('BOOTSTRAP_ALLOWED=true is zero-config', () => {
    process.env.BOOTSTRAP_ALLOWED = 'true';
    assert.equal(isZeroConfigDeploy(), true);
    delete process.env.BOOTSTRAP_ALLOWED;
  });
});

describe('ensureDockerDeploySecrets', () => {
  test('generates AUTH_TOKEN + SESSION_SECRET and writes bootstrap.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-docker-sec-'));
    const p = path.join(dir, 'bootstrap.json');
    delete process.env.AUTH_TOKEN;
    delete process.env.SESSION_SECRET;
    delete process.env.ALLOWED_ORIGINS;

    const r = ensureDockerDeploySecrets({ bootstrapFile: p });
    assert.ok(fs.existsSync(p));
    assert.ok(r.generated.includes('AUTH_TOKEN'));
    assert.ok(r.generated.includes('SESSION_SECRET'));
    assert.equal(process.env.AUTH_TOKEN.length, 64);
    assert.equal(process.env.SESSION_SECRET.length, 64);

    const disk = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(disk.authToken, process.env.AUTH_TOKEN);
    assert.equal(disk.sessionSecret, process.env.SESSION_SECRET);

    // Second call is idempotent
    const token1 = process.env.AUTH_TOKEN;
    const r2 = ensureDockerDeploySecrets({ bootstrapFile: p });
    assert.equal(r2.generated.length, 0);
    assert.equal(process.env.AUTH_TOKEN, token1);
  });
});

function loadConfigInChild(env) {
  const clean = { ...process.env };
  delete clean.NODE_TEST_CONTEXT;
  delete clean.NODE_ENV;
  delete clean.AUTH_TOKEN;
  delete clean.SESSION_SECRET;
  delete clean.ENCRYPTION_KEY;
  delete clean.GOOGLE_CLIENT_ID;
  delete clean.RESEND_API_KEY;
  delete clean.MAGIC_LINK_CONSOLE;
  delete clean.BOOTSTRAP_ALLOWED;
  delete clean.BOOTSTRAP_FILE;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-cfg-docker-'));
  const script =
    "const {config}=require('./server/config');process.stdout.write(JSON.stringify({ok:true,hasToken:Boolean(config.AUTH_TOKEN),hasSession:Boolean(config.SESSION_SECRET),port:config.PORT,bootstrapMode:config.BOOTSTRAP_MODE}));";
  return spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    env: {
      ...clean,
      DB_PATH: path.join(tmp, 'familieassistenten.db'),
      BOOTSTRAP_FILE: path.join(tmp, 'bootstrap.json'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('isZeroConfigDeploy / scrub', () => {
  test('scrubWeakSecretEnv drops short SESSION_SECRET and AUTH_TOKEN', () => {
    process.env.AUTH_TOKEN = 'short';
    process.env.SESSION_SECRET = 'tooshort';
    process.env.MAGIC_LINK_CONSOLE = 'false';
    scrubWeakSecretEnv();
    assert.equal(process.env.AUTH_TOKEN, undefined);
    assert.equal(process.env.SESSION_SECRET, undefined);
  });

  test('BOOTSTRAP_ALLOWED=true is zero-config', () => {
    process.env.BOOTSTRAP_ALLOWED = 'true';
    assert.equal(isZeroConfigDeploy(), true);
    delete process.env.BOOTSTRAP_ALLOWED;
  });
});

describe('Docker zero-config boot', () => {
  test('BOOTSTRAP_ALLOWED + MAGIC_LINK_CONSOLE + no secrets → starts with auto secrets', () => {
    const result = loadConfigInChild({
      NODE_ENV: 'production',
      BOOTSTRAP_ALLOWED: 'true',
      MAGIC_LINK_CONSOLE: 'true',
      ALLOWED_ORIGINS: '*',
    });
    assert.strictEqual(
      result.status,
      0,
      `expected clean exit\nstderr=${result.stderr}\nstdout=${result.stdout}`
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.hasToken, true);
    assert.equal(parsed.hasSession, true);
    assert.equal(parsed.port, 7777);
    assert.equal(parsed.bootstrapMode, false);
  });

  test('BOOTSTRAP_ALLOWED alone with zero env secrets → starts', () => {
    const result = loadConfigInChild({
      NODE_ENV: 'production',
      BOOTSTRAP_ALLOWED: 'true',
    });
    assert.strictEqual(
      result.status,
      0,
      `expected clean exit\nstderr=${result.stderr}\nstdout=${result.stdout}`
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hasToken, true);
    assert.equal(parsed.hasSession, true);
  });
});
