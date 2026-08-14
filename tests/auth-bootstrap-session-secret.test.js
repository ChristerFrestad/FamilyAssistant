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
    assert.deepEqual(r, { generated: false, secret: null, createdFile: false });
    // File should NOT have been created as a side effect.
    assert.equal(fs.existsSync(p), false);
  });

  test('returns { generated: false, secret: null } when file is invalid JSON', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, 'not-json-at-all', 'utf8');
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.deepEqual(r, { generated: false, secret: null, createdFile: false });
  });

  test('returns { generated: false, secret: null } when file is not an object', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, '42', 'utf8');
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.deepEqual(r, { generated: false, secret: null, createdFile: false });
  });

  test('createIfMissing generates and writes a new bootstrap.json', () => {
    const p = tempBootstrapPath();
    const r = ensureSessionSecretInBootstrapFile(p, { createIfMissing: true });
    assert.equal(r.generated, true);
    assert.equal(r.createdFile, true);
    assert.equal(typeof r.secret, 'string');
    assert.equal(r.secret.length, 64);
    assert.match(r.secret, /^[0-9a-f]{64}$/);
    assert.equal(fs.existsSync(p), true);
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(parsed.sessionSecret, r.secret);
    assert.equal(parsed.version, 2);
    assert.ok(parsed.sessionSecretGeneratedAt);
  });
});

describe('ensureSessionSecretInBootstrapFile — existing file without secret', () => {
  test('generates and merges sessionSecret into existing bootstrap.json', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ authToken: 'a'.repeat(32), version: 1 }, null, 2),
      'utf8'
    );
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.equal(r.generated, true);
    assert.equal(r.createdFile, false);
    assert.equal(typeof r.secret, 'string');
    assert.equal(r.secret.length, 64);

    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(parsed.authToken, 'a'.repeat(32), 'existing fields preserved');
    assert.equal(parsed.sessionSecret, r.secret);
    assert.equal(parsed.version, 1, 'version left alone when only merging secret');
    assert.ok(parsed.sessionSecretGeneratedAt);
  });

  test('is idempotent: second call returns existing secret without rewriting', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ authToken: 'b'.repeat(32) }, null, 2),
      'utf8'
    );
    const first = ensureSessionSecretInBootstrapFile(p);
    assert.equal(first.generated, true);
    const mtime1 = fs.statSync(p).mtimeMs;

    const second = ensureSessionSecretInBootstrapFile(p);
    assert.equal(second.generated, false);
    assert.equal(second.secret, first.secret);
    const mtime2 = fs.statSync(p).mtimeMs;
    assert.equal(mtime2, mtime1, 'file must not be rewritten when secret already present');
  });

  test('accepts an already-valid sessionSecret without regenerating', () => {
    const existing = 'c'.repeat(64);
    const p = tempBootstrapPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ authToken: 'd'.repeat(32), sessionSecret: existing }, null, 2),
      'utf8'
    );
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.equal(r.generated, false);
    assert.equal(r.secret, existing);
  });

  test('rejects too-short sessionSecret and regenerates', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ authToken: 'e'.repeat(32), sessionSecret: 'tooshort' }, null, 2),
      'utf8'
    );
    const r = ensureSessionSecretInBootstrapFile(p);
    assert.equal(r.generated, true);
    assert.notEqual(r.secret, 'tooshort');
    assert.equal(r.secret.length, 64);
  });
});

describe('ensureSessionSecretInBootstrapFile — atomic write', () => {
  test('writes via tmp + rename and cleans up tmp', () => {
    const p = tempBootstrapPath();
    fs.writeFileSync(p, JSON.stringify({ authToken: 'f'.repeat(32) }), 'utf8');
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
    {
      // Root can write even to mode 0500 directories on Linux; the chmod
      // simulation only works for non-root. Skip on Windows and when euid==0.
      skip: process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0),
    },
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
// bootstrap.js and bootstrap-session-secret.js.
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
