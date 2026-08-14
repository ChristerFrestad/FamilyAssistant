'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');

function enableConsoleMagic() {
  process.env.MAGIC_LINK_CONSOLE = 'true';
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
}

function setGraceSeconds(sec) {
  process.env.EMAIL_VERIFICATION_GRACE_SECONDS = String(sec);
}

function resetRateLimits() {
  try {
    require('../server/auth/magic-link').resetRateLimitForTests();
  } catch {
    /* module may not be loaded yet */
  }
}

function cookieHeader(setCookie) {
  if (!setCookie) return '';
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  return raw.map((c) => String(c).split(';')[0]).join('; ');
}

function captureConsoleUrls() {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  return {
    lines,
    restore() {
      console.log = orig;
    },
    tokenFromLogs() {
      const text = lines.join('\n');
      const m = /token=([a-f0-9]+)/.exec(text);
      return m ? m[1] : null;
    },
  };
}

beforeEach(() => {
  enableConsoleMagic();
  setGraceSeconds(60 * 24 * 60 * 60); // 60 days
  process.env.PASSWORD_AUTH_ENABLED = 'true';
  process.env.PASSWORD_AUTH_OPEN_REGISTER = 'true';
  process.env.AUTH_TOKEN = 'test-auth-token-for-password-suite';
  resetRateLimits();
});

afterEach(() => {
  delete process.env.EMAIL_VERIFICATION_GRACE_SECONDS;
  delete process.env.PASSWORD_AUTH_ENABLED;
  delete process.env.PASSWORD_AUTH_OPEN_REGISTER;
  delete process.env.MAGIC_LINK_CONSOLE;
  delete process.env.AUTH_TOKEN;
});

// ============================================================
// Register + login happy path
// ============================================================

test('POST /api/auth/password/register creates session and returns user', async () => {
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  try {
    const r = await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'alice', password: 'secret123', name: 'Alice' },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.user.username, 'alice');
    assert.strictEqual(r.body.user.emailVerified, false);
    assert.strictEqual(r.body.user.withinGrace, true);
    assert.ok(r.body.user.verificationDueAt);
    assert.ok(r.body.redirect.includes('/onboarding') || r.body.redirect.includes('/dashboard'));
    const setCookie = r.headers['set-cookie'] || r.headers['Set-Cookie'];
    assert.ok(setCookie);
    // LAN/Portainer hit this endpoint over plain HTTP. Secure must not
    // be set unless HTTPS_TERMINATED or X-Forwarded-Proto says so —
    // otherwise the browser drops fa_session and onboarding 401s.
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
    assert.doesNotMatch(cookieStr, /;\s*Secure/i);

    const me = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: cookieHeader(r.headers['set-cookie'] || r.headers['Set-Cookie']) },
    });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.authenticated, true);
    assert.strictEqual(me.body.user.username, 'alice');
    assert.strictEqual(me.body.user.emailVerified, false);
  } finally {
    await server.close();
  }
});

test('register then login with username/password', async () => {
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  try {
    await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'bob', password: 'secret123' },
    });

    const login = await request(server.baseUrl, 'POST', '/api/auth/password/login', {
      body: { username: 'Bob', password: 'secret123' }, // case-insensitive username
    });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    assert.strictEqual(login.body.user.username, 'bob');
  } finally {
    await server.close();
  }
});

test('duplicate username returns 409', async () => {
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  try {
    await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'dup', password: 'secret123' },
    });
    const r = await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'DUP', password: 'otherpass99' },
    });
    assert.strictEqual(r.status, 409);
  } finally {
    await server.close();
  }
});

test('wrong password returns 401', async () => {
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  try {
    await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'carol', password: 'secret123' },
    });
    const r = await request(server.baseUrl, 'POST', '/api/auth/password/login', {
      body: { username: 'carol', password: 'wrong-password' },
    });
    assert.strictEqual(r.status, 401);
  } finally {
    await server.close();
  }
});

// ============================================================
// Grace expiry → verification required + reset
// ============================================================

test('after grace expiry login returns 403 email_verification_required', async () => {
  setGraceSeconds(1); // 1 second — will backdate created_at
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  try {
    const reg = await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'olduser', password: 'secret123' },
    });
    assert.strictEqual(reg.status, 200);

    // Backdate created_at so grace is definitely expired
    server.repos._db
      .prepare("UPDATE users SET created_at = datetime('now', '-2 days') WHERE username = ?")
      .run('olduser');

    // Re-load config... grace is read from config at request time via require.
    // startTestServer clears module cache, but EMAIL_VERIFICATION_GRACE_SECONDS=1
    // was set before server start — ensure config has 1.
    const login = await request(server.baseUrl, 'POST', '/api/auth/password/login', {
      body: { username: 'olduser', password: 'secret123' },
    });
    assert.strictEqual(login.status, 403, JSON.stringify(login.body));
    assert.strictEqual(login.body.code, 'email_verification_required');
    assert.strictEqual(login.body.mustResetPassword, true);
    // No session should be established
    assert.ok(!login.headers['set-cookie'] && !login.headers['Set-Cookie']);
  } finally {
    await server.close();
  }
});

test('post-grace verification magic link forces password reset', async () => {
  setGraceSeconds(1);
  enableConsoleMagic();
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  const cap = captureConsoleUrls();
  try {
    await request(server.baseUrl, 'POST', '/api/auth/password/register', {
      body: { username: 'eve', password: 'secret123' },
    });
    server.repos._db
      .prepare("UPDATE users SET created_at = datetime('now', '-2 days') WHERE username = ?")
      .run('eve');

    resetRateLimits();
    const start = await request(server.baseUrl, 'POST', '/api/auth/password/start-verification', {
      body: {
        username: 'eve',
        password: 'secret123',
        email: 'eve@example.com',
      },
    });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    assert.strictEqual(start.body.purpose, 'email_verify_reset');
    assert.strictEqual(start.body.mustResetPassword, true);

    const token = cap.tokenFromLogs();
    assert.ok(token, 'console should log magic-link URL');

    const verify = await request(
      server.baseUrl,
      'GET',
      `/api/auth/magic-link/verify?token=${token}`,
      { headers: { Accept: 'text/html' } }
    );
    // 302 redirect to set-password
    assert.ok([302, 301].includes(verify.status), `expected redirect, got ${verify.status}`);
    const location = verify.headers.location || verify.headers.Location;
    assert.ok(String(location).includes('/set-password'), location);

    const cookie = cookieHeader(verify.headers['set-cookie'] || verify.headers['Set-Cookie']);
    const me = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: cookie },
    });
    assert.strictEqual(me.body.user.emailVerified, true);
    assert.strictEqual(me.body.user.passwordResetRequired, true);
    assert.strictEqual(me.body.user.email, 'eve@example.com');

    const setPw = await request(server.baseUrl, 'POST', '/api/auth/password/set', {
      headers: { Cookie: cookie },
      body: { password: 'newsecret99' },
    });
    assert.strictEqual(setPw.status, 200, JSON.stringify(setPw.body));
    assert.strictEqual(setPw.body.user.passwordResetRequired, false);

    // Old password no longer works; new does
    const bad = await request(server.baseUrl, 'POST', '/api/auth/password/login', {
      body: { username: 'eve', password: 'secret123' },
    });
    assert.strictEqual(bad.status, 401);

    const good = await request(server.baseUrl, 'POST', '/api/auth/password/login', {
      body: { username: 'eve', password: 'newsecret99' },
    });
    assert.strictEqual(good.status, 200, JSON.stringify(good.body));
  } finally {
    cap.restore();
    await server.close();
  }
});

// ============================================================
// Config manifest
// ============================================================

test('GET /api/auth/config exposes password auth flags', async () => {
  const server = await startTestServer({ authToken: process.env.AUTH_TOKEN });
  try {
    const r = await request(server.baseUrl, 'GET', '/api/auth/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.passwordAuth, true);
    assert.strictEqual(r.body.passwordRegister, true);
    assert.ok(typeof r.body.emailVerificationGraceSeconds === 'number');
  } finally {
    await server.close();
  }
});

test('password-hash unit: hash and verify round-trip', async () => {
  const { hashPassword, verifyPassword } = require('../server/auth/password-hash');
  const h = await hashPassword('test-password-1');
  assert.ok(h.startsWith('scrypt$'));
  assert.strictEqual(await verifyPassword('test-password-1', h), true);
  assert.strictEqual(await verifyPassword('wrong', h), false);
});
