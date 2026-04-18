'use strict';

// Phase 22 — zero-config Docker deploy + bootstrap wizard.
//
// Covers:
//   - Static analysis of docker-compose.yml and client-side setup.html/js
//   - server/http/bootstrap.js handler behavior (generate-token, complete)
//   - Bootstrap JSON persistence with 0600 permissions + wx conflict
//   - PUBLIC_PATHS + SW precache wiring
//   - Config guards (BOOTSTRAP_ALLOWED + empty data volume → BOOTSTRAP_MODE)
//
// The test suite runs with NODE_ENV=test which intentionally skips
// BOOTSTRAP_MODE activation, so config.js's guard still refuses to
// enter bootstrap-mode in-process. We exercise the handlers directly
// with a forged config object + a captured exit stub.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const bootstrap = require('../server/http/bootstrap');
const { PUBLIC_PATHS } = require('../server/auth/middleware');

const REPO = path.join(__dirname, '..');

function freshTmpDir() {
  const dir = path.join(
    os.tmpdir(),
    `fam-bootstrap-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function mockCtx(body) {
  let statusCode = 200;
  let jsonPayload = null;
  return {
    body,
    pathname: '/api/bootstrap/complete',
    res: {
      statusCode,
      setHeader() {},
      writeHead() {},
      end() {},
      writableEnded: false,
    },
    req: { headers: {}, method: 'POST', url: '/' },
    json(data, status) {
      if (status !== undefined) statusCode = status;
      jsonPayload = { data, status: status === undefined ? 200 : status };
    },
    get captured() {
      return jsonPayload;
    },
  };
}

// ============================================================
// Section 1 — compose + docs static analysis
// ============================================================

describe('Phase 22 · docker-compose.yml zero-config', () => {
  const yml = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8');

  test('AUTH_TOKEN is optional (no :? required-syntax)', () => {
    assert.doesNotMatch(yml, /AUTH_TOKEN:\s*\$\{AUTH_TOKEN:\?/);
    assert.match(yml, /AUTH_TOKEN:\s*\$\{AUTH_TOKEN:-/);
  });

  test('BOOTSTRAP_ALLOWED defaults to true in compose env', () => {
    assert.match(yml, /BOOTSTRAP_ALLOWED:\s*["']?true["']?/);
  });

  test('Caddy is gated behind the production profile', () => {
    assert.match(yml, /profiles:\s*\n\s*-\s*production/);
  });

  test('ALLOWED_ORIGINS has a permissive default for bootstrap', () => {
    assert.match(yml, /ALLOWED_ORIGINS:\s*\$\{ALLOWED_ORIGINS:-/);
  });
});

describe('Phase 22 · setup wizard UI', () => {
  const htmlPath = path.join(REPO, 'public', 'setup.html');
  const jsPath = path.join(REPO, 'public', 'js', 'setup.js');

  test('public/setup.html exists with required form inputs', () => {
    assert.ok(fs.existsSync(htmlPath));
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /id=["']authToken["']/);
    assert.match(html, /id=["']allowedOrigins["']/);
    assert.match(html, /id=["']llmBackend["']/);
    assert.match(html, /id=["']logLevel["']/);
    assert.match(html, /id=["']genBtn["']/);
    assert.match(html, /id=["']submitBtn["']/);
  });

  test('setup.html loads setup.js', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /<script src=["']\/js\/setup\.js["']/);
  });

  test('public/js/setup.js exists and calls the three bootstrap endpoints', () => {
    assert.ok(fs.existsSync(jsPath));
    const js = fs.readFileSync(jsPath, 'utf8');
    assert.match(js, /\/api\/bootstrap\/status/);
    assert.match(js, /\/api\/bootstrap\/generate-token/);
    assert.match(js, /\/api\/bootstrap\/complete/);
    assert.match(js, /\/health/);
  });
});

describe('Phase 22 · SW + PUBLIC_PATHS wiring', () => {
  test('/setup.html is in PUBLIC_PATHS', () => {
    assert.ok(PUBLIC_PATHS.has('/setup.html'));
  });

  test('sw.js precaches /setup.html and /js/setup.js', () => {
    const sw = fs.readFileSync(path.join(REPO, 'public', 'sw.js'), 'utf8');
    assert.match(sw, /'\/setup\.html'/);
    assert.match(sw, /'\/js\/setup\.js'/);
  });

  test('sw.js NO_CACHE_API_PREFIXES includes /api/bootstrap', () => {
    const sw = fs.readFileSync(path.join(REPO, 'public', 'sw.js'), 'utf8');
    assert.match(sw, /'\/api\/bootstrap'/);
  });
});

// ============================================================
// Section 2 — handler behavior (direct, no HTTP)
// ============================================================

describe('Phase 22 · handleGenerateToken', () => {
  test('returns a 32-hex token each call, different values', () => {
    const ctx1 = mockCtx();
    bootstrap.handleGenerateToken(ctx1);
    const ctx2 = mockCtx();
    bootstrap.handleGenerateToken(ctx2);
    assert.match(ctx1.captured.data.token, /^[0-9a-f]{64}$/);
    assert.match(ctx2.captured.data.token, /^[0-9a-f]{64}$/);
    assert.notEqual(ctx1.captured.data.token, ctx2.captured.data.token);
  });
});

describe('Phase 22 · handleComplete', () => {
  test('refuses when BOOTSTRAP_MODE is false', () => {
    const cfg = { BOOTSTRAP_MODE: false };
    const ctx = mockCtx({ authToken: 'a'.repeat(32), allowedOrigins: 'http://example' });
    assert.throws(() => bootstrap.handleComplete(ctx, cfg, () => {}), /not active/i);
  });

  test('rejects authToken shorter than 16 chars', () => {
    const cfg = {
      BOOTSTRAP_MODE: true,
      BOOTSTRAP_FILE: path.join(freshTmpDir(), 'bootstrap.json'),
    };
    const ctx = mockCtx({ authToken: 'short', allowedOrigins: 'http://a' });
    assert.throws(() => bootstrap.handleComplete(ctx, cfg, () => {}), /at least 16/);
  });

  test('rejects allowedOrigins === "*"', () => {
    const cfg = {
      BOOTSTRAP_MODE: true,
      BOOTSTRAP_FILE: path.join(freshTmpDir(), 'bootstrap.json'),
    };
    const ctx = mockCtx({ authToken: 'a'.repeat(32), allowedOrigins: '*' });
    assert.throws(() => bootstrap.handleComplete(ctx, cfg, () => {}), /explicit origin/i);
  });

  test('persists bootstrap.json with 0600 permissions and triggers exit', async () => {
    const dir = freshTmpDir();
    const file = path.join(dir, 'bootstrap.json');
    const cfg = { BOOTSTRAP_MODE: true, BOOTSTRAP_FILE: file };
    let exitCode = null;
    const exitFn = (code) => {
      exitCode = code;
    };
    const ctx = mockCtx({
      authToken: 'a'.repeat(32),
      allowedOrigins: 'http://example.local, https://example.local',
      llmBackend: 'ollama',
      ollamaHost: 'http://my-ollama:11434',
      logLevel: 'debug',
    });
    bootstrap.handleComplete(ctx, cfg, exitFn);
    assert.equal(ctx.captured.data.ok, true);
    assert.equal(ctx.captured.data.restarting, true);
    assert.ok(fs.existsSync(file), 'bootstrap.json must exist');
    // POSIX permission bits are only meaningful on unix-ish platforms.
    // Windows ignores the `mode` arg to writeFileSync and always reports
    // something like 0o666; we skip the bit-check there but still verify
    // the file was created and contains what we expect.
    if (process.platform !== 'win32') {
      const stat = fs.statSync(file);
      const modeOctal = (stat.mode & 0o777).toString(8);
      assert.equal(modeOctal, '600', `expected 0600 perms, got ${modeOctal}`);
    }
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(content.authToken, 'a'.repeat(32));
    assert.equal(content.allowedOrigins, 'http://example.local, https://example.local');
    assert.equal(content.llmBackend, 'ollama');
    assert.equal(content.ollamaHost, 'http://my-ollama:11434');
    assert.equal(content.logLevel, 'debug');
    assert.equal(content.generatedBy, 'setup-wizard');
    assert.ok(content.completedAt);
    // exitFn scheduled via setImmediate — wait a tick
    await new Promise((r) => setImmediate(r));
    assert.equal(exitCode, 0);
    // cleanup
    fs.unlinkSync(file);
  });

  test('second complete call returns 409 conflict (idempotent persistence)', () => {
    const dir = freshTmpDir();
    const file = path.join(dir, 'bootstrap.json');
    const cfg = { BOOTSTRAP_MODE: true, BOOTSTRAP_FILE: file };
    const exitFn = () => {};
    // Seed the file to simulate a prior completion.
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    const ctx = mockCtx({
      authToken: 'b'.repeat(32),
      allowedOrigins: 'http://example.local',
    });
    assert.throws(() => bootstrap.handleComplete(ctx, cfg, exitFn), /already completed|conflict/i);
    fs.unlinkSync(file);
  });
});

describe('Phase 22 · handleStatus', () => {
  test('reports normal mode', () => {
    const ctx = mockCtx();
    bootstrap.handleStatus(ctx, {
      BOOTSTRAP_MODE: false,
      BOOTSTRAP_ALLOWED: true,
      BOOTSTRAP_FILE_PATH: '/app/data/bootstrap.json',
    });
    assert.equal(ctx.captured.data.mode, 'normal');
    assert.equal(ctx.captured.data.setupUrl, null);
  });

  test('reports bootstrap mode with setup URL', () => {
    const ctx = mockCtx();
    bootstrap.handleStatus(ctx, {
      BOOTSTRAP_MODE: true,
      BOOTSTRAP_ALLOWED: true,
      BOOTSTRAP_FILE_PATH: null,
    });
    assert.equal(ctx.captured.data.mode, 'bootstrap');
    assert.equal(ctx.captured.data.setupUrl, '/setup.html');
  });
});

// ============================================================
// Section 3 — Config integration: BOOTSTRAP_MODE activation rules
// ============================================================

describe('Phase 22 · config.js BOOTSTRAP_MODE gate', () => {
  test('in NODE_ENV=test, BOOTSTRAP_MODE is always false', () => {
    // Config is already loaded via the test harness earlier — it reads
    // NODE_ENV at parse time. Just assert the exported value.
    const { config } = require('../server/config');
    assert.equal(config.NODE_ENV, 'test');
    assert.equal(config.BOOTSTRAP_MODE, false);
  });
});
