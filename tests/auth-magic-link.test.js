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

    // The token row should exist in magic_link_tokens
    const row = server.repos.auth.findMagicLink(token);
    assert.ok(row);
    assert.strictEqual(row.email, 'alice@example.com');
    assert.strictEqual(row.used_at, null);

    const verifyR = await request(
      server.baseUrl,
      'GET',
      `/api/auth/magic-link/verify?token=${token}`
    );
    assert.strictEqual(verifyR.status, 302);
    assert.strictEqual(verifyR.headers.location, '/');
    const setCookie = verifyR.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
    assert.match(header, /fa_session=/);

    // The user should now exist
    const user = server.repos.auth.findByEmail('alice@example.com');
    assert.ok(user);

    // Token must be marked used
    const after = server.repos.auth.findMagicLink(token);
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

    // Insert an expired token directly via the repo.
    const token = require('node:crypto').randomBytes(16).toString('hex');
    server.repos.auth.createMagicLink({ token, email: 'carol@example.com', ttlMinutes: -1 });

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
  }
});

// ============================================================
// Does not reveal account existence
// ============================================================

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
