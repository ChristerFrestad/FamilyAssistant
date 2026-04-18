// Google OAuth 2.0 authorization code flow with PKCE.
//
// Endpoints provided to routes.js:
//   - buildAuthorizationUrl(state, codeChallenge, redirectUri)
//   - exchangeCodeForIdToken({ code, codeVerifier, redirectUri }) -> { idToken, accessToken, ... }
//   - verifyIdToken(idToken) -> { sub, email, email_verified, name, picture, ... }
//
// Dependencies: only node built-ins (fetch, crypto). JWKS keys are cached in
// memory for 24 hours and refreshed lazily.

const crypto = require('crypto');
const { config } = require('../config');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
let jwksCache = { fetchedAt: 0, keys: null };

// ============================================================
// PKCE helpers
// ============================================================

function generatePkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// ============================================================
// Authorization URL
// ============================================================

function buildAuthorizationUrl({ state, codeChallenge, redirectUri, nonce }) {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.');
  }
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ============================================================
// Token exchange
// ============================================================

async function exchangeCodeForIdToken({ code, codeVerifier, redirectUri }) {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials are not configured.');
  }
  const body = new URLSearchParams({
    code,
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ============================================================
// JWKS fetch + cache
// ============================================================

async function fetchJwks() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_ENDPOINT);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const json = await res.json();
  jwksCache = { fetchedAt: now, keys: json.keys };
  return json.keys;
}

function jwkToPem(jwk) {
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

// ============================================================
// ID token verification
// ============================================================

async function verifyIdToken(
  idToken,
  { expectedNonce, expectedAudience = config.GOOGLE_CLIENT_ID } = {}
) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('ID token is missing or not a string.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token.');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  const signature = base64UrlDecode(signatureB64);
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);

  if (header.alg !== 'RS256') throw new Error(`Unsupported alg: ${header.alg}`);
  if (!header.kid) throw new Error('ID token header is missing kid.');

  const keys = await fetchJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Maybe the cached JWKS is stale; force-refresh once.
    jwksCache = { fetchedAt: 0, keys: null };
    const refreshed = await fetchJwks();
    const retry = refreshed.find((k) => k.kid === header.kid);
    if (!retry) throw new Error('No JWKS key matches token kid.');
    return verifySignatureAndClaims(jwkToPem(retry), signingInput, signature, payload, {
      expectedNonce,
      expectedAudience,
    });
  }
  return verifySignatureAndClaims(jwkToPem(jwk), signingInput, signature, payload, {
    expectedNonce,
    expectedAudience,
  });
}

function verifySignatureAndClaims(publicKey, signingInput, signature, payload, opts) {
  const verified = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
  if (!verified) throw new Error('ID token signature verification failed.');

  if (!ISSUERS.has(payload.iss)) throw new Error(`Unexpected issuer: ${payload.iss}`);
  if (payload.aud !== opts.expectedAudience) {
    throw new Error(`Audience mismatch: expected ${opts.expectedAudience}, got ${payload.aud}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 5) {
    throw new Error('ID token is expired.');
  }
  if (typeof payload.iat === 'number' && payload.iat > now + 60) {
    throw new Error('ID token issued in the future.');
  }
  if (opts.expectedNonce && payload.nonce !== opts.expectedNonce) {
    throw new Error('Nonce mismatch.');
  }
  return payload;
}

// ============================================================
// Redirect URI builder
// ============================================================

function redirectUriFor(appUrl) {
  const base = appUrl || config.APP_URL;
  if (!base) throw new Error('APP_URL is not configured.');
  return base.replace(/\/+$/, '') + '/api/auth/google/callback';
}

module.exports = {
  generatePkcePair,
  base64UrlEncode,
  buildAuthorizationUrl,
  exchangeCodeForIdToken,
  verifyIdToken,
  redirectUriFor,
};
