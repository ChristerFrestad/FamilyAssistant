'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');

// ============================================================
// Helpers
// ============================================================

function setupResend() {
  // Configure the email service as "enabled" for these tests.
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_FROM = 'noreply@test.example';
}

function clearResend() {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
}

function installFakeSender() {
  // Replace the default HTTP sender with an in-memory stub.
  const emailService = require('../server/services/email.service');
  const sent = [];
  emailService.__setSenderForTests(async (payload) => {
    sent.push(payload);
    return { ok: true, messageId: 'stub-' + sent.length };
  });
  return sent;
}

function resetFakeSender() {
  const emailService = require('../server/services/email.service');
  emailService.__setSenderForTests(null);
}

function resetRateLimit() {
  const { resetRateLimitForTests } = require('../server/auth/magic-link');
  resetRateLimitForTests();
}

// Sprint 3 / Fase 1e — magic-link tokens are stored as SHA-256
// hashes (migration 022). Tests need the same hash function the
// server uses so they can look up persisted rows from a plain
// token captured out of an email body or log line.
function hashTokenForTest(plain) {
  const { hashToken } = require('../server/auth/magic-link');
  return hashToken(plain);
}

// ============================================================
// Service not configured
// ============================================================

test('POST /api/auth/magic-link/start returns 503 when Resend is not configured', async () => {
  clearResend();
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'foo@example.com' },
    });
    assert.strictEqual(r.status, 503);
  } finally {
    await server.close();
  }
});

// ============================================================
// Console mode (pilot/MVP escape hatch)
// ============================================================

test('MAGIC_LINK_CONSOLE=true without Resend logs URL to stdout and returns 200', async () => {
  clearResend();
  process.env.MAGIC_LINK_CONSOLE = 'true';

  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.map(String).join(' '));

  const server = await startTestServer();
  try {
    resetRateLimit();
    const r = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'pilot@example.com' },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);

    const logText = captured.join('\n');
    assert.match(logText, /MAGIC LINK/);
    assert.match(logText, /pilot@example\.com/);
    const match = /token=([a-f0-9]+)/.exec(logText);
    assert.ok(match, 'logged output should contain a token URL');

    const token = match[1];
    const row = server.repos.auth.findMagicLinkByHash(hashTokenForTest(token));
    assert.ok(row, 'token should have been persisted to DB');
    assert.strictEqual(row.email, 'pilot@example.com');
    assert.strictEqual(row.used_at, null);

    // The logged URL must still verify successfully — full pilot flow.
    const verifyR = await request(
      server.baseUrl,
      'GET',
      `/api/auth/magic-link/verify?token=${token}`
    );
    assert.strictEqual(verifyR.status, 302);
  } finally {
    console.log = origLog;
    delete process.env.MAGIC_LINK_CONSOLE;
    await server.close();
  }
});

test('MAGIC_LINK_CONSOLE=true with Resend configured still sends email (no override)', async () => {
  setupResend();
  process.env.MAGIC_LINK_CONSOLE = 'true';

  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.map(String).join(' '));

  const server = await startTestServer();
  try {
    const sent = installFakeSender();
    resetRateLimit();
    const r = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'alice@example.com' },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(sent.length, 1, 'email should have been sent');
    assert.strictEqual(sent[0].to, 'alice@example.com');

    const logText = captured.join('\n');
    assert.doesNotMatch(logText, /MAGIC LINK \(console mode/);
  } finally {
    console.log = origLog;
    delete process.env.MAGIC_LINK_CONSOLE;
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

// ============================================================
// Input validation
// ============================================================

test('POST /api/auth/magic-link/start rejects missing email', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    installFakeSender();
    resetRateLimit();
    const r = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: {},
    });
    assert.strictEqual(r.status, 400);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

test('POST /api/auth/magic-link/start rejects invalid email', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    installFakeSender();
    resetRateLimit();
    const r = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'not-an-email' },
    });
    assert.strictEqual(r.status, 400);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

// ============================================================
// Happy path: send email, verify, get session
// ============================================================

test('start writes a token and sends an email; verify creates a session and redirects', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    const sent = installFakeSender();
    resetRateLimit();

    const startR = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'alice@example.com' },
    });
    assert.strictEqual(startR.status, 200);
    assert.strictEqual(startR.body.ok, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'alice@example.com');

    // Extract the token from the sent URL
    const match = /token=([a-f0-9]+)/.exec(sent[0].text + sent[0].html);
    assert.ok(match, 'token should appear in email body');
    const token = match[1];

    // The token row should exist in magic_link_tokens, looked up by
    // its SHA-256 hash (migration 022 — plain tokens are never stored).
    const tokenHash = hashTokenForTest(token);
    const row = server.repos.auth.findMagicLinkByHash(tokenHash);
    assert.ok(row);
    assert.strictEqual(row.email, 'alice@example.com');
    assert.strictEqual(row.used_at, null);

    const verifyR = await request(
      server.baseUrl,
      'GET',
      `/api/auth/magic-link/verify?token=${token}`
    );
    assert.strictEqual(verifyR.status, 302);
    // New users default to onboarding_completed=0 (migration 021), so
    // verify redirects to the family-setup wizard rather than the
    // dashboard. The dashboard target is exercised in a separate
    // test below ("redirects to /dashboard for completed users").
    assert.strictEqual(verifyR.headers.location, '/onboarding/family');
    const setCookie = verifyR.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
    assert.match(header, /fa_session=/);

    // The user should now exist
    const user = server.repos.auth.findByEmail('alice@example.com');
    assert.ok(user);

    // Token must be marked used
    const after = server.repos.auth.findMagicLinkByHash(tokenHash);
    assert.ok(after.used_at);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

// ============================================================
// Single-use enforcement
// ============================================================

test('reusing a magic-link token returns 410 Gone', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    const sent = installFakeSender();
    resetRateLimit();

    await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'bob@example.com' },
    });
    const token = /token=([a-f0-9]+)/.exec(sent[0].text + sent[0].html)[1];
    const first = await request(
      server.baseUrl,
      'GET',
      `/api/auth/magic-link/verify?token=${token}`
    );
    assert.strictEqual(first.status, 302);

    const second = await request(
      server.baseUrl,
      'GET',
      `/api/auth/magic-link/verify?token=${token}`
    );
    assert.strictEqual(second.status, 410);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

// ============================================================
// Expired tokens
// ============================================================

test('verifying an expired token returns 410 Gone', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    installFakeSender();
    resetRateLimit();

    // Insert an expired token directly via the repo. The repo expects
    // the SHA-256 hash; the URL must contain the matching plain
    // token so verify-handler hashes it and finds the row.
    const token = require('node:crypto').randomBytes(16).toString('hex');
    const tokenHash = hashTokenForTest(token);
    server.repos.auth.createMagicLink({
      tokenHash,
      email: 'carol@example.com',
      ttlMinutes: -1,
    });

    const r = await request(server.baseUrl, 'GET', `/api/auth/magic-link/verify?token=${token}`);
    assert.strictEqual(r.status, 410);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

// ============================================================
// Unknown tokens
// ============================================================

test('verifying an unknown token returns 400 Bad Request', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    installFakeSender();
    const r = await request(
      server.baseUrl,
      'GET',
      '/api/auth/magic-link/verify?token=doesnotexist'
    );
    assert.strictEqual(r.status, 400);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

// ============================================================
// Rate limit kicks in on the 6th request per email per hour
// ============================================================

test('rate limit returns 429 on the 6th start call for the same email within an hour', async () => {
  setupResend();
  // Sprint 1 / Prompt 2 added a strict per-IP rate limit of 5/15min
  // on /api/auth/*. With both limiters active, request 6 trips the
  // per-email limit (which we want) AND the per-IP limit (which we
  // don't want to test here). The "different email" follow-up would
  // then fail because the per-IP limiter is still saturated.
  //
  // Bump the per-IP threshold high enough to deactivate it for this
  // specific test, so we are exercising the per-email layer in
  // magic-link.js in isolation.
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
  const server = await startTestServer();
  try {
    installFakeSender();
    resetRateLimit();

    for (let i = 0; i < 5; i++) {
      const ok = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
        body: { email: 'dave@example.com' },
      });
      assert.strictEqual(ok.status, 200, `request ${i + 1} should succeed`);
    }

    const blocked = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'dave@example.com' },
    });
    assert.strictEqual(blocked.status, 429);
    assert.ok(blocked.headers['retry-after']);

    // Different email should still work — the limit is per-email.
    const other = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'erin@example.com' },
    });
    assert.strictEqual(other.status, 200);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
    delete process.env.AUTH_RATE_LIMIT_MAX;
  }
});

// ============================================================
// Does not reveal account existence
// ============================================================

// ============================================================
// Onboarding-aware redirect (Sprint 3 / Fase 1e)
// ============================================================

test('verify redirects to /dashboard when the user has onboarding_completed=1', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    installFakeSender();
    resetRateLimit();

    // Pre-create a user that has finished onboarding. The default
    // for migration 021 is 0, so we explicitly flip it before the
    // verify hits.
    const created = server.repos.auth.createUser({
      email: 'returning@example.com',
      name: 'Returning',
    });
    server.repos.auth.setOnboardingCompleted(created.id, true);

    // Insert a fresh magic-link row for this email.
    const token = require('node:crypto').randomBytes(16).toString('hex');
    server.repos.auth.createMagicLink({
      tokenHash: hashTokenForTest(token),
      email: 'returning@example.com',
      ttlMinutes: 15,
    });

    const r = await request(server.baseUrl, 'GET', `/api/auth/magic-link/verify?token=${token}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/dashboard');
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

test('plain tokens are never persisted — only the SHA-256 hash is stored', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    const sent = installFakeSender();
    resetRateLimit();

    await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'hash-check@example.com' },
    });
    const token = /token=([a-f0-9]+)/.exec(sent[0].text + sent[0].html)[1];

    // The plain token used in the email must NOT exist as a row in
    // the table (the row is keyed on the hash). Looking the plain
    // value up directly returns null.
    const plainLookup = server.repos.auth.findMagicLinkByHash(token);
    assert.strictEqual(plainLookup, null, 'plain token must not match any row');

    // The hashed value DOES match.
    const hashLookup = server.repos.auth.findMagicLinkByHash(hashTokenForTest(token));
    assert.ok(hashLookup, 'hashed token should match the persisted row');
    assert.strictEqual(hashLookup.email, 'hash-check@example.com');
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});

test('start returns the same response whether or not the email exists', async () => {
  setupResend();
  const server = await startTestServer();
  try {
    installFakeSender();
    resetRateLimit();

    // Pre-create user
    server.repos.auth.createUser({ email: 'known@example.com', name: 'Known' });

    const knownR = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'known@example.com' },
    });
    const unknownR = await request(server.baseUrl, 'POST', '/api/auth/magic-link/start', {
      body: { email: 'unknown@example.com' },
    });
    assert.strictEqual(knownR.status, 200);
    assert.strictEqual(unknownR.status, 200);
    assert.deepStrictEqual(knownR.body, unknownR.body);
  } finally {
    resetFakeSender();
    await server.close();
    clearResend();
  }
});
