'use strict';

// Phase 17 — Sentry integration tests.
//
// Covers the wrapper in server/observability/sentry.js without needing
// @sentry/node to be installed:
//   - initSentry no-ops when SENTRY_DSN is unset
//   - captureException no-ops before initialisation
//   - beforeSend scrubs request.data/cookies, Authorization/Cookie headers,
//     user.email/username/ip_address, and extra fields that look like
//     emails or bearer tokens
//   - hashFamilyId produces a 16-char sha256 prefix and never returns the
//     raw id
//   - package.json declares @sentry/node as an optionalDependency
//   - config.js declares SENTRY_DSN / SENTRY_TRACES_SAMPLE_RATE
//   - server/index.js wires initSentry + captureException on the crash path
//   - server/http/server.js captures unhandled errors

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sentry = require('../server/observability/sentry');

const REPO = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const CONFIG_SRC = fs.readFileSync(path.join(REPO, 'server', 'config.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(REPO, 'server', 'index.js'), 'utf8');
const HTTP_SRC = fs.readFileSync(path.join(REPO, 'server', 'http', 'server.js'), 'utf8');

beforeEach(() => sentry.resetForTests());

describe('Phase 17 · initSentry behavior', () => {
  test('no DSN → disabled with reason "no-dsn"', () => {
    const res = sentry.initSentry({ SENTRY_DSN: '' });
    assert.deepEqual(res, { enabled: false, reason: 'no-dsn' });
    assert.equal(sentry.isEnabled(), false);
  });

  test('DSN set → enabled when @sentry/node is installed, else module-missing', () => {
    // @sentry/node is declared as an optionalDependency. CI runs
    // `npm ci` without --omit=optional, so the SDK is usually present
    // and Sentry.init succeeds with a fake DSN (it just never flushes).
    // Minimal installs that skip optional deps exercise the fallback
    // branch. Both outcomes are correct; assert the paired return
    // shape for whichever path we land on.
    const res = sentry.initSentry({ SENTRY_DSN: 'https://fake@sentry.io/1' });
    if (res.enabled) {
      assert.equal(res.reason, 'ok');
      assert.equal(sentry.isEnabled(), true);
    } else {
      assert.equal(res.reason, 'module-missing');
      assert.equal(sentry.isEnabled(), false);
    }
  });

  test('captureException before init is a safe no-op', () => {
    const result = sentry.captureException(new Error('boom'));
    assert.equal(result, null);
  });
});

describe('Phase 17 · beforeSend scrubbing', () => {
  test('drops request.data and request.cookies', () => {
    const event = {
      request: {
        data: { secret: 'dont-leak' },
        cookies: { fa_session: 'abc' },
        headers: {},
      },
    };
    sentry.beforeSend(event);
    assert.equal(event.request.data, undefined);
    assert.equal(event.request.cookies, undefined);
  });

  test('redacts Authorization and Cookie headers (case-insensitive)', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer abc.def.ghi',
          cookie: 'fa_session=abc123',
          'User-Agent': 'Mozilla',
        },
      },
    };
    sentry.beforeSend(event);
    assert.equal(event.request.headers.Authorization, '[redacted]');
    assert.equal(event.request.headers.cookie, '[redacted]');
    assert.equal(event.request.headers['User-Agent'], 'Mozilla');
  });

  test('redacts user.email, user.username, user.ip_address', () => {
    const event = {
      user: {
        id: 'hash123',
        email: 'alice@example.com',
        username: 'alice',
        ip_address: '192.0.2.1',
        role: 'owner',
      },
    };
    sentry.beforeSend(event);
    assert.equal(event.user.email, '[redacted]');
    assert.equal(event.user.username, '[redacted]');
    assert.equal(event.user.ip_address, '[redacted]');
    assert.equal(event.user.id, 'hash123');
    assert.equal(event.user.role, 'owner');
  });

  test('redacts email-ish and bearer-ish extra fields', () => {
    const event = {
      extra: {
        someEmail: 'bob@internal.test',
        token: 'Bearer very-secret',
        benign: 'nothing-sensitive-here',
        number: 42,
      },
    };
    sentry.beforeSend(event);
    assert.equal(event.extra.someEmail, '[redacted]');
    assert.equal(event.extra.token, '[redacted]');
    assert.equal(event.extra.benign, 'nothing-sensitive-here');
    assert.equal(event.extra.number, 42);
  });

  test('returns the event object so Sentry can forward it', () => {
    const event = { foo: 'bar' };
    const out = sentry.beforeSend(event);
    assert.strictEqual(out, event);
  });
});

describe('Phase 17 · hashFamilyId', () => {
  test('returns a 16-char hex prefix and never the raw id', () => {
    const h = sentry.hashFamilyId(42);
    assert.equal(typeof h, 'string');
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
    assert.notEqual(h, '42');
  });

  test('null/undefined → null', () => {
    assert.equal(sentry.hashFamilyId(null), null);
    assert.equal(sentry.hashFamilyId(undefined), null);
  });

  test('different family ids → different hashes', () => {
    assert.notEqual(sentry.hashFamilyId(1), sentry.hashFamilyId(2));
  });
});

describe('Phase 17 · Package + config wiring', () => {
  test('package.json lists @sentry/node in optionalDependencies', () => {
    assert.ok(
      PKG.optionalDependencies && PKG.optionalDependencies['@sentry/node'],
      '@sentry/node must be declared as optionalDependency'
    );
  });

  test('config.js declares SENTRY_DSN + SENTRY_TRACES_SAMPLE_RATE', () => {
    assert.match(CONFIG_SRC, /SENTRY_DSN\s*:/);
    assert.match(CONFIG_SRC, /SENTRY_TRACES_SAMPLE_RATE\s*:/);
    assert.match(CONFIG_SRC, /SENTRY_ENVIRONMENT\s*:/);
  });

  test('server/index.js calls initSentry during boot', () => {
    assert.match(INDEX_SRC, /require\(['"]\.\/observability\/sentry['"]\)/);
    assert.match(INDEX_SRC, /sentry\.initSentry\(/);
  });

  test('server/index.js forwards uncaughtException + unhandledRejection to Sentry', () => {
    // Two captureException wires — one per global handler.
    const matches = INDEX_SRC.match(/sentry\.captureException\(/g) || [];
    assert.ok(matches.length >= 2, `expected >= 2 captureException calls, got ${matches.length}`);
  });

  test('server/http/server.js captures 500-errors to Sentry with ctx', () => {
    assert.match(HTTP_SRC, /require\(['"]\.\.\/observability\/sentry['"]\)/);
    assert.match(HTTP_SRC, /sentry\.captureException\(err,\s*ctx\)/);
  });
});

describe('Phase 17 · isEnabled / resetForTests', () => {
  test('isEnabled returns false after reset', () => {
    sentry.initSentry({ SENTRY_DSN: 'https://fake@sentry.io/1' });
    sentry.resetForTests();
    assert.equal(sentry.isEnabled(), false);
  });
});

describe('Phase 17 · closeSentry is safe when disabled', () => {
  test('resolves true without throwing when Sentry never initialised', async () => {
    const ok = await sentry.closeSentry(10);
    assert.equal(ok, true);
  });
});
