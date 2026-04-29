'use strict';

// Tests for server/auth/google.js — Google OAuth 2.0 with PKCE.
//
// The module reads config.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and
// APP_URL from server/config.js, which is loaded once per process and
// validates env at require time. server/config.js calls process.exit(1)
// when GOOGLE_CLIENT_ID is set without its dependents, so the helper
// loadGoogleWithEnv() snapshots and resets every relevant env var on
// every call to avoid cross-test state leakage.
//
// The verifyIdToken tests build a real RSA keypair, sign real JWTs,
// and mock global.fetch to return a JWK form of the public key so the
// full signature/claims path is exercised end-to-end without any
// network calls.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// ============================================================
// Test fixtures (top-level so test() callbacks stay synchronous)
// ============================================================

const KID = 'test-kid-1';
const KEYPAIR = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = (() => {
  const k = KEYPAIR.publicKey.export({ format: 'jwk' });
  return { ...k, alg: 'RS256', use: 'sig', kid: KID };
})();

// ============================================================
// Helpers
// ============================================================

const TRACKED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_URL'];

function loadGoogleWithEnv(env = {}) {
  // Snapshot every tracked var so we restore the pre-call state.
  const snapshot = {};
  for (const k of TRACKED_ENV) snapshot[k] = process.env[k];
  // Wipe to a clean baseline before applying overrides.
  for (const k of TRACKED_ENV) delete process.env[k];

  // server/config.js calls process.exit(1) when GOOGLE_CLIENT_ID is
  // set without GOOGLE_CLIENT_SECRET and APP_URL alongside. Auto-fill
  // dependents so individual tests do not have to repeat the
  // boilerplate, unless the caller explicitly overrides them.
  const merged = { ...env };
  if (merged.GOOGLE_CLIENT_ID && !('GOOGLE_CLIENT_SECRET' in merged)) {
    merged.GOOGLE_CLIENT_SECRET = 'test-secret';
  }
  if (merged.GOOGLE_CLIENT_ID && !('APP_URL' in merged)) {
    merged.APP_URL = 'http://localhost';
  }
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete process.env[k];
    else process.env[k] = merged[k];
  }

  delete require.cache[require.resolve('../server/config')];
  delete require.cache[require.resolve('../server/auth/google')];
  const google = require('../server/auth/google');

  // Restore tracked env vars to the pre-call snapshot.
  for (const k of TRACKED_ENV) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  return google;
}

function base64UrlEncodeJson(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt({ kid, payload }) {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = crypto.sign('RSA-SHA256', signingInput, KEYPAIR.privateKey);
  const signatureB64 = signature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function signJwtWithBadSignature({ kid, payload }) {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = base64UrlEncodeJson(header);
  const payloadB64 = base64UrlEncodeJson(payload);
  const fakeSig = crypto.randomBytes(256);
  const signatureB64 = fakeSig
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function defaultPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id',
    sub: 'user-123',
    email: 'test@example.com',
    email_verified: true,
    iat: now,
    exp: now + 3600,
    nonce: 'expected-nonce',
    ...overrides,
  };
}

function mockJwksResponse(keys) {
  global.fetch = async (url) => {
    assert.strictEqual(url, 'https://www.googleapis.com/oauth2/v3/certs');
    return { ok: true, status: 200, json: async () => ({ keys }) };
  };
}

// Save and restore global.fetch so each test starts with a known state.
let originalFetch;
beforeEach(() => {
  originalFetch = global.fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

// ============================================================
// generatePkcePair
// ============================================================

test('generatePkcePair: returns base64url-formatted verifier and challenge', () => {
  const google = loadGoogleWithEnv();
  const { verifier, challenge } = google.generatePkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.strictEqual(verifier.length, 43);
  assert.strictEqual(challenge.length, 43);
});

test('generatePkcePair: challenge is the SHA-256 of the verifier', () => {
  const google = loadGoogleWithEnv();
  const { verifier, challenge } = google.generatePkcePair();
  const expected = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.strictEqual(challenge, expected);
});

test('generatePkcePair: subsequent calls return different pairs', () => {
  const google = loadGoogleWithEnv();
  const a = google.generatePkcePair();
  const b = google.generatePkcePair();
  assert.notStrictEqual(a.verifier, b.verifier);
  assert.notStrictEqual(a.challenge, b.challenge);
});

// ============================================================
// base64UrlEncode
// ============================================================

test('base64UrlEncode: encodes a Buffer with no padding and replaced chars', () => {
  const google = loadGoogleWithEnv();
  // Bytes 0xfb, 0xff, 0xbf produce + and / in standard base64.
  const out = google.base64UrlEncode(Buffer.from([0xfb, 0xff, 0xbf]));
  assert.strictEqual(out, '-_-_');
});

test('base64UrlEncode: encodes a string by coercing through Buffer.from', () => {
  const google = loadGoogleWithEnv();
  assert.strictEqual(google.base64UrlEncode('hello'), 'aGVsbG8');
});

// ============================================================
// buildAuthorizationUrl
// ============================================================

test('buildAuthorizationUrl: throws when GOOGLE_CLIENT_ID is not configured', () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: undefined });
  assert.throws(
    () =>
      google.buildAuthorizationUrl({
        state: 's',
        codeChallenge: 'c',
        redirectUri: 'http://localhost/cb',
        nonce: 'n',
      }),
    /GOOGLE_CLIENT_ID is not configured/
  );
});

test('buildAuthorizationUrl: returns a Google URL with all expected parameters', () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  const url = google.buildAuthorizationUrl({
    state: 'state-123',
    codeChallenge: 'challenge-abc',
    redirectUri: 'http://localhost:7777/api/auth/google/callback',
    nonce: 'nonce-xyz',
  });
  const parsed = new URL(url);
  assert.strictEqual(
    parsed.origin + parsed.pathname,
    'https://accounts.google.com/o/oauth2/v2/auth'
  );
  assert.strictEqual(parsed.searchParams.get('client_id'), 'test-client-id');
  assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
  assert.strictEqual(parsed.searchParams.get('scope'), 'openid email profile');
  assert.strictEqual(parsed.searchParams.get('state'), 'state-123');
  assert.strictEqual(parsed.searchParams.get('nonce'), 'nonce-xyz');
  assert.strictEqual(parsed.searchParams.get('code_challenge'), 'challenge-abc');
  assert.strictEqual(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(parsed.searchParams.get('access_type'), 'online');
  assert.strictEqual(parsed.searchParams.get('prompt'), 'select_account');
});

// ============================================================
// redirectUriFor
// ============================================================

test('redirectUriFor: throws when neither argument nor APP_URL is set', () => {
  const google = loadGoogleWithEnv({ APP_URL: undefined });
  assert.throws(() => google.redirectUriFor(), /APP_URL is not configured/);
});

test('redirectUriFor: uses the supplied appUrl when given', () => {
  const google = loadGoogleWithEnv({ APP_URL: 'http://wrong' });
  assert.strictEqual(
    google.redirectUriFor('http://right.example'),
    'http://right.example/api/auth/google/callback'
  );
});

test('redirectUriFor: strips trailing slashes from the base URL', () => {
  const google = loadGoogleWithEnv();
  assert.strictEqual(
    google.redirectUriFor('http://example.com/'),
    'http://example.com/api/auth/google/callback'
  );
  assert.strictEqual(
    google.redirectUriFor('http://example.com///'),
    'http://example.com/api/auth/google/callback'
  );
});

test('redirectUriFor: falls back to config.APP_URL when no argument is supplied', () => {
  const google = loadGoogleWithEnv({ APP_URL: 'http://from-config' });
  assert.strictEqual(google.redirectUriFor(), 'http://from-config/api/auth/google/callback');
});

// ============================================================
// exchangeCodeForIdToken
// ============================================================

test('exchangeCodeForIdToken: throws when GOOGLE_CLIENT_ID is missing', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: undefined });
  await assert.rejects(
    google.exchangeCodeForIdToken({
      code: 'c',
      codeVerifier: 'v',
      redirectUri: 'http://localhost/cb',
    }),
    /Google OAuth credentials are not configured/
  );
});

test('exchangeCodeForIdToken: returns the token response on a 200 from Google', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-id' });
  let receivedBody;
  global.fetch = async (url, opts) => {
    receivedBody = opts.body;
    assert.strictEqual(url, 'https://oauth2.googleapis.com/token');
    assert.strictEqual(opts.method, 'POST');
    assert.strictEqual(opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id_token: 'fake', access_token: 'a', expires_in: 3600 }),
    };
  };
  const result = await google.exchangeCodeForIdToken({
    code: 'auth-code',
    codeVerifier: 'verifier-v',
    redirectUri: 'http://localhost/cb',
  });
  assert.strictEqual(result.id_token, 'fake');
  assert.match(receivedBody, /code=auth-code/);
  assert.match(receivedBody, /code_verifier=verifier-v/);
  assert.match(receivedBody, /grant_type=authorization_code/);
  assert.match(receivedBody, /client_id=test-id/);
  assert.match(receivedBody, /client_secret=test-secret/);
});

test('exchangeCodeForIdToken: throws on a non-2xx response from Google', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-id' });
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error":"invalid_grant"}',
  });
  await assert.rejects(
    google.exchangeCodeForIdToken({
      code: 'bad',
      codeVerifier: 'v',
      redirectUri: 'http://localhost/cb',
    }),
    /Google token exchange failed \(401\)/
  );
});

// ============================================================
// verifyIdToken
// ============================================================

test('verifyIdToken: throws when token is missing or empty', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  await assert.rejects(google.verifyIdToken(null), /missing or not a string/);
  await assert.rejects(google.verifyIdToken(undefined), /missing or not a string/);
  await assert.rejects(google.verifyIdToken(''), /missing or not a string/);
});

test('verifyIdToken: throws when token is not a string', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  await assert.rejects(google.verifyIdToken(42), /missing or not a string/);
  await assert.rejects(google.verifyIdToken({}), /missing or not a string/);
});

test('verifyIdToken: throws on malformed token (not three parts)', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  await assert.rejects(google.verifyIdToken('only.two'), /Malformed ID token/);
  await assert.rejects(google.verifyIdToken('a.b.c.d'), /Malformed ID token/);
});

test('verifyIdToken: throws on unsupported algorithm', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  const headerB64 = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT', kid: KID });
  const payloadB64 = base64UrlEncodeJson(defaultPayload());
  await assert.rejects(
    google.verifyIdToken(`${headerB64}.${payloadB64}.fake`),
    /Unsupported alg: HS256/
  );
});

test('verifyIdToken: throws when header is missing kid', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  const headerB64 = base64UrlEncodeJson({ alg: 'RS256', typ: 'JWT' });
  const payloadB64 = base64UrlEncodeJson(defaultPayload());
  await assert.rejects(
    google.verifyIdToken(`${headerB64}.${payloadB64}.fake`),
    /header is missing kid/
  );
});

test('verifyIdToken: throws when no JWKS key matches kid even after refresh', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([{ ...JWK, kid: 'different-kid' }]);
  const token = signJwt({ kid: KID, payload: defaultPayload() });
  await assert.rejects(google.verifyIdToken(token), /No JWKS key matches token kid/);
});

test('verifyIdToken: verifies a well-formed token end-to-end', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const token = signJwt({ kid: KID, payload: defaultPayload() });
  const result = await google.verifyIdToken(token, { expectedNonce: 'expected-nonce' });
  assert.strictEqual(result.sub, 'user-123');
  assert.strictEqual(result.email, 'test@example.com');
  assert.strictEqual(result.email_verified, true);
});

test('verifyIdToken: throws on a tampered signature', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const token = signJwtWithBadSignature({ kid: KID, payload: defaultPayload() });
  await assert.rejects(google.verifyIdToken(token), /signature verification failed/);
});

test('verifyIdToken: throws on unexpected issuer', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ iss: 'https://evil.example' }),
  });
  await assert.rejects(google.verifyIdToken(token), /Unexpected issuer/);
});

test('verifyIdToken: throws on audience mismatch', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ aud: 'wrong-audience' }),
  });
  await assert.rejects(google.verifyIdToken(token), /Audience mismatch/);
});

test('verifyIdToken: accepts an expectedAudience override', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'config-audience' });
  mockJwksResponse([JWK]);
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ aud: 'override-audience' }),
  });
  const result = await google.verifyIdToken(token, { expectedAudience: 'override-audience' });
  assert.strictEqual(result.aud, 'override-audience');
});

test('verifyIdToken: throws when token is expired', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const past = Math.floor(Date.now() / 1000) - 7200;
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ iat: past - 3600, exp: past }),
  });
  await assert.rejects(google.verifyIdToken(token), /expired/);
});

test('verifyIdToken: throws when iat is in the future beyond skew tolerance', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const future = Math.floor(Date.now() / 1000) + 3600;
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ iat: future, exp: future + 3600 }),
  });
  await assert.rejects(google.verifyIdToken(token), /issued in the future/);
});

test('verifyIdToken: throws on nonce mismatch when expectedNonce is supplied', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ nonce: 'wrong-nonce' }),
  });
  await assert.rejects(
    google.verifyIdToken(token, { expectedNonce: 'expected-nonce' }),
    /Nonce mismatch/
  );
});

test('verifyIdToken: skips nonce check when expectedNonce is not supplied', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  mockJwksResponse([JWK]);
  const token = signJwt({
    kid: KID,
    payload: defaultPayload({ nonce: 'whatever' }),
  });
  const result = await google.verifyIdToken(token);
  assert.strictEqual(result.sub, 'user-123');
});

test('verifyIdToken: refreshes JWKS once when kid is not found, then succeeds', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  let callCount = 0;
  global.fetch = async (url) => {
    callCount += 1;
    assert.strictEqual(url, 'https://www.googleapis.com/oauth2/v3/certs');
    const keys = callCount === 1 ? [{ ...JWK, kid: 'stale-kid' }] : [JWK];
    return { ok: true, status: 200, json: async () => ({ keys }) };
  };
  const token = signJwt({ kid: KID, payload: defaultPayload() });
  const result = await google.verifyIdToken(token);
  assert.strictEqual(result.sub, 'user-123');
  assert.strictEqual(callCount, 2);
});

test('verifyIdToken: surfaces JWKS fetch failure', async () => {
  const google = loadGoogleWithEnv({ GOOGLE_CLIENT_ID: 'test-client-id' });
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const token = signJwt({ kid: KID, payload: defaultPayload() });
  await assert.rejects(google.verifyIdToken(token), /JWKS fetch failed: 503/);
});
