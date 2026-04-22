'use strict';

// Tests for server/auth/bootstrap-session-secret.js — the self-healing
// mechanism that ensures SESSION_SECRET exists in bootstrap.json on both
// fresh installs (via setup-wizard) and upgrade installs (self-heal on
// config load).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateSessionSecret,
  ensureSessionSecretInBootstrapFile,
} = require('../server/auth/bootstrap-session-secret');

function tempBootstrapPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-bootstrap-session-'));
  return path.join(dir, 'bootstrap.json');
}

describe('generateSessionSecret', () => {
  test('returns a 64-char lowercase hex string', () => {
    const s = generateSessionSecret();
    assert.equal(typeof s, 'string');
    assert.equal(s.length, 64);
    assert.match(s, /^[0-9a-f]{64}$/);
  });

  test('produces distinct values across calls', () => {
    const a = generateSessionSecret();
    const b = generateSessionSecret();
    assert.notEqual(a, b);
  });
});

describe('ensureSessionSecretInBootstrapFile — missing file', () => {
  test('returns { generated: false, secret: null } when file does not exist', () => {
    const p = tempBootstrapPath();
    // Do not create the file.
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.deepEqual(r, { generated: false, secret: null });
    // File should NOT have been created as a side effect.
    assert.equal(fs.existsSync(p), false);
  });

  test('returns { generated: false, secret: null } when file is invalid JSON', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, 'not-json-at-all', 'utf8');
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.deepEqual(r, { generated: false, secret: null });
  });

  test('returns { generated: false, secret: null } when file is not an object', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, '42', 'utf8');
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.deepEqual(r, { generated: false, secret: null });
  });
});

describe('ensureSessionSecretInBootstrapFile — existing secret', () => {
  test('returns the existing secret and does not rewrite the file', () => {
    const p = tempBootstrapPath();
    const existing = 'a'.repeat(64);
    const original = {
      authToken: 'x'.repeat(32),
      sessionSecret: existing,
      other: 'keep-me',
    };
    fs.writeFileSync(p, JSON.stringify(original), 'utf8');
    const statBefore = fs.statSync(p).mtimeMs;

    // Wait 5ms so any rewrite would bump mtime.
    const until = Date.now() + 10;
    while (Date.now() < until) {
      /* spin briefly */
    }

    const r = ensureSessionSecretInBootstrapFile(p);
    assert.equal(r.generated, false);
    assert.equal(r.secret, existing);

    // File contents must be byte-for-byte identical.
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepEqual(after, original);

    // mtime should not have moved (no rewrite).
    const statAfter = fs.statSync(p).mtimeMs;
    assert.equal(statAfter, statBefore, 'file must not be rewritten when secret exists');
  });

  test('treats too-short sessionSecret as missing and regenerates', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ authToken: 'x'.repeat(32), sessionSecret: 'short' }),
      'utf8'
    );

    const r = ensureSessionSecretInBootstrapFile(p);
    assert.equal(r.generated, true);
    assert.equal(r.secret.length, 64);

    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(after.sessionSecret, r.secret);
  });
});

describe('ensureSessionSecretInBootstrapFile — self-heal upgrade path', () => {
  test('generates, merges, and persists when sessionSecret is missing', () => {
    const p = tempBootstrapPath();
    const original = {
      authToken: 'y'.repeat(32),
      allowedOrigins: 'https://example.test',
      llmBackend: 'ollama',
      other: 'keep-me',
    };
    fs.writeFileSync(p, JSON.stringify(original), 'utf8');

    const r = ensureSessionSecretInBootstrapFile(p);
    assert.equal(r.generated, true);
    assert.equal(typeof r.secret, 'string');
    assert.equal(r.secret.length, 64);

    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(after.authToken, original.authToken);
    assert.equal(after.allowedOrigins, original.allowedOrigins);
    assert.equal(after.llmBackend, original.llmBackend);
    assert.equal(after.other, original.other);
    assert.equal(after.sessionSecret, r.secret);
    assert.equal(typeof after.sessionSecretGeneratedAt, 'string');
    assert.match(after.sessionSecretGeneratedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('is idempotent: second call returns existing secret without regenerating', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, JSON.stringify({ authToken: 'z'.repeat(32) }), 'utf8');

    const first = ensureSessionSecretInBootstrapFile(p);
    assert.equal(first.generated, true);

    const second = ensureSessionSecretInBootstrapFile(p);
    assert.equal(second.generated, false, 'second call must not regenerate');
    assert.equal(second.secret, first.secret, 'returned value must match first call');

    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(after.sessionSecret, first.secret);
  });

  test(
    'written file has 0600 permissions (POSIX only)',
    { skip: process.platform === 'win32' },
    () => {
      const p = tempBootstrapPath();
      fs.writeFileSync(p, JSON.stringify({ authToken: 'w'.repeat(32) }), 'utf8');
      ensureSessionSecretInBootstrapFile(p);
      const mode = fs.statSync(p).mode & 0o777;
      assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
    }
  );

  test('atomic write: no torn file when writeFileSync succeeds', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, JSON.stringify({ authToken: 'v'.repeat(32) }), 'utf8');
    ensureSessionSecretInBootstrapFile(p);

    // Must be parseable JSON after rename; tmp file must be cleaned up.
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(parsed.sessionSecret);

    const tmpPath = `${p}.tmp`;
    assert.equal(fs.existsSync(tmpPath), false, 'tmp file should be removed after rename');
  });
});

describe('ensureSessionSecretInBootstrapFile — error handling', () => {
  test(
    'propagates write error when directory is read-only',
    { skip: process.platform === 'win32' },
    () => {
      const p = tempBootstrapPath();
      fs.writeFileSync(p, JSON.stringify({ authToken: 'u'.repeat(32) }), 'utf8');
      const dir = path.dirname(p);

      try {
        fs.chmodSync(dir, 0o500); // r-x — cannot create .tmp file
        assert.throws(
          () => ensureSessionSecretInBootstrapFile(p),
          (err) => err && typeof err.message === 'string'
        );
      } finally {
        // Restore perms so the OS can clean up.
        try {
          fs.chmodSync(dir, 0o700);
        } catch {
          /* ignore */
        }
      }
    }
  );
});

// ============================================================
// Integration with the setup-wizard: handleComplete now writes
// sessionSecret alongside authToken. Verifies the wiring between
// bootstrap-session-secret.js → server/http/bootstrap.js.
// ============================================================

const bootstrap = require('../server/http/bootstrap');

function mockCtx(body) {
  let jsonPayload = null;
  return {
    body,
    pathname: '/api/bootstrap/complete',
    res: {
      setHeader() {},
      writeHead() {},
      end() {},
      writableEnded: false,
    },
    req: { headers: {}, method: 'POST', url: '/' },
    json(data, status) {
      jsonPayload = { data, status: status === undefined ? 200 : status };
    },
    get captured() {
      return jsonPayload;
    },
  };
}

describe('handleComplete integration (uke 2 B1)', () => {
  test('writes sessionSecret alongside authToken', async () => {
    const p = tempBootstrapPath();
    const cfg = { BOOTSTRAP_MODE: true, BOOTSTRAP_FILE: p };
    const ctx = mockCtx({
      authToken: 'q'.repeat(32),
      allowedOrigins: 'https://example.test',
    });
    let exitCode = null;
    bootstrap.handleComplete(ctx, cfg, (c) => {
      exitCode = c;
    });

    assert.equal(ctx.captured.data.ok, true);
    const persisted = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(persisted.authToken, 'q'.repeat(32));
    assert.equal(typeof persisted.sessionSecret, 'string');
    assert.equal(persisted.sessionSecret.length, 64);
    assert.match(persisted.sessionSecret, /^[0-9a-f]{64}$/);
    assert.equal(persisted.version, 2, 'schema version bump to 2 when sessionSecret added');
    assert.ok(persisted.sessionSecretGeneratedAt);

    await new Promise((r) => setImmediate(r));
    assert.equal(exitCode, 0);
  });

  test('wizard-generated sessionSecret differs from a subsequent upgrade-path secret', async () => {
    const p1 = tempBootstrapPath();
    const cfg1 = { BOOTSTRAP_MODE: true, BOOTSTRAP_FILE: p1 };
    bootstrap.handleComplete(
      mockCtx({ authToken: 'r'.repeat(32), allowedOrigins: 'https://a.test' }),
      cfg1,
      () => {}
    );
    const wizard = JSON.parse(fs.readFileSync(p1, 'utf8')).sessionSecret;

    // Simulate an older install: remove sessionSecret from the file, then
    // run the self-heal. The regenerated secret must differ.
    const mutated = JSON.parse(fs.readFileSync(p1, 'utf8'));
    delete mutated.sessionSecret;
    delete mutated.sessionSecretGeneratedAt;
    fs.writeFileSync(p1, JSON.stringify(mutated), 'utf8');

    const heal = ensureSessionSecretInBootstrapFile(p1);
    assert.equal(heal.generated, true);
    assert.notEqual(heal.secret, wizard, 'regenerated secret must be distinct');
  });
});
