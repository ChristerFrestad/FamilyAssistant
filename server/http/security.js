// Sikkerhets-middleware (Fase 4)
//
// Tilbyr:
//   - bearerAuth       : Bearer-token autentisering
//   - rateLimit        : In-memory sliding window rate limiter per IP
//   - securityHeaders  : X-Content-Type-Options, X-Frame-Options, etc.
//   - sanitizeForPrompt: strips prompt-injection patterns before KB text goes to LLM
//
// Alt er null-dependency og fungerer med node:http direkte.

const crypto = require('crypto');
const net = require('net');
const { config } = require('../config');
const { errors } = require('./errors');

// ============================================================
// Bearer token authentication
// ============================================================
//
// Hvis config.AUTH_TOKEN er satt, krever middleware at requests har
// `Authorization: Bearer <token>` som matcher. Unntak: /health og /ready
// (for ekstern monitoring uten deling av hemmelighet).

const PUBLIC_PATHS = new Set(['/health', '/ready', '/metrics']);

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  const lengthsMatch = bufA.length === bufB.length;
  const padded = lengthsMatch ? bufB : Buffer.alloc(bufA.length);
  if (!lengthsMatch) padded.fill(0);
  const equal = crypto.timingSafeEqual(bufA, padded);
  return lengthsMatch && equal;
}

function bearerAuth(ctx) {
  if (!config.AUTH_TOKEN) return; // Auth er deaktivert (default i dev)
  if (PUBLIC_PATHS.has(ctx.pathname)) return;

  const header = ctx.req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) throw errors.unauthorized('Missing Bearer token');

  if (!constantTimeEquals(match[1], config.AUTH_TOKEN)) {
    throw errors.unauthorized('Invalid token');
  }
}

// ============================================================
// Rate limiting (sliding window counter per IP)
// ============================================================
//
// Enkel in-memory implementasjon:
//   - Kartet key \u2192 [timestamp1, timestamp2, ...]
//   - Pr\u00f8ver hver request mot vinduet, fjerner gamle
//   - Overskrider limit \u2192 429 Too Many Requests
//
// Egnet for single-node. Nullstilles ved restart (OK for RPi5).

// Two independent buckets — see Sprint 1 / Prompt 2:
//   - hits:     global limit, applied to every request
//   - authHits: stricter limit on a small allow-list of destructive
//               auth-trigger endpoints (slows brute-force on magic-
//               link generation and OAuth start). Default 5 per 15 min.
//
// The strict bucket is intentionally narrow. The Sprint 1 implementation
// matched the entire /api/auth/* prefix, which incorrectly counted
// /api/auth/me (whoami, called on every route change by the frontend
// AuthContext) and /api/auth/logout against the same brute-force budget.
// After 5 navigations a real user would be locked out of the app — and,
// because the bucket is shared, also blocked from requesting a new
// magic-link to recover. Only the two endpoints below can actually
// trigger an auth side-effect (sending a magic-link email, redirecting
// to Google's consent screen) so only they need the tighter bucket.
const hits = new Map();
const authHits = new Map();
const RATE_LIMIT_MAX_IPS = 10000; // Max number of IPs in the map before eviction

// Method+path tuples that go through the strict auth-bucket. Anything
// not in this set falls back to the global limit (300/min default),
// which is appropriate for read-only or session-bearing endpoints.
const STRICT_AUTH_ENDPOINTS = new Set([
  'POST /api/auth/magic-link/start',
  'GET /api/auth/google/start',
  'POST /api/auth/password/register',
  'POST /api/auth/password/login',
  'POST /api/auth/password/start-verification',
]);

function isStrictAuthEndpoint(ctx) {
  if (!ctx.pathname || !ctx.req || !ctx.req.method) return false;
  return STRICT_AUTH_ENDPOINTS.has(`${ctx.req.method} ${ctx.pathname}`);
}

function getClientIp(req) {
  // Only trust X-Forwarded-For when TRUST_PROXY is explicitly set (reverse proxy)
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) {
      const ip = fwd.split(',')[0].trim();
      if (net.isIP(ip)) return ip;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(ctx) {
  // Strict auth-bucket runs first so brute-force attempts tripping
  // the 5/15min ceiling get rejected with a clearer "auth rate limit"
  // error message before they consume budget from the global bucket.
  // The set of strict endpoints is intentionally narrow — see comment
  // on STRICT_AUTH_ENDPOINTS above.
  if (isStrictAuthEndpoint(ctx)) {
    applyAuthRateLimit(ctx);
  }

  const max = config.RATE_LIMIT_MAX;
  const windowMs = config.RATE_LIMIT_WINDOW_MS;
  const ip = getClientIp(ctx.req);
  const now = Date.now();
  const cutoff = now - windowMs;

  let list = hits.get(ip);
  if (!list) {
    // Evict eldste entry hvis map er for stort (DDoS-beskyttelse)
    if (hits.size >= RATE_LIMIT_MAX_IPS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    list = [];
    hits.set(ip, list);
  }

  // Fjern gamle timestamps
  while (list.length > 0 && list[0] < cutoff) list.shift();

  if (list.length >= max) {
    const retryAfter = Math.ceil((list[0] + windowMs - now) / 1000);
    ctx.res.setHeader('Retry-After', String(retryAfter));
    ctx.res.setHeader('X-RateLimit-Limit', String(max));
    ctx.res.setHeader('X-RateLimit-Remaining', '0');
    throw errors.tooManyRequests(`Rate limit: max ${max} requests per ${windowMs / 1000}s`);
  }

  list.push(now);
  ctx.res.setHeader('X-RateLimit-Limit', String(max));
  ctx.res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - list.length)));
}

// Strict per-IP rate limit on the destructive auth-trigger endpoints
// listed in STRICT_AUTH_ENDPOINTS above. Tighter threshold and longer
// window than the global bucket — protects against brute-forcing the
// magic-link start endpoint and the Google OAuth start endpoint,
// where an attacker can otherwise burn email-quota or generate
// thousands of state-cookies cheaply.
//
// On a trip the response includes Retry-After so clients can back off
// gracefully, and the throw is dedicated (not the generic "Rate limit:
// max ..." message) so logs and dashboards can split brute-force from
// background traffic noise.
function applyAuthRateLimit(ctx) {
  const max = config.AUTH_RATE_LIMIT_MAX;
  const windowMs = config.AUTH_RATE_LIMIT_WINDOW_MS;
  const ip = getClientIp(ctx.req);
  const now = Date.now();
  const cutoff = now - windowMs;

  let list = authHits.get(ip);
  if (!list) {
    if (authHits.size >= RATE_LIMIT_MAX_IPS) {
      const oldest = authHits.keys().next().value;
      if (oldest !== undefined) authHits.delete(oldest);
    }
    list = [];
    authHits.set(ip, list);
  }

  while (list.length > 0 && list[0] < cutoff) list.shift();

  if (list.length >= max) {
    const retryAfter = Math.ceil((list[0] + windowMs - now) / 1000);
    ctx.res.setHeader('Retry-After', String(retryAfter));
    ctx.res.setHeader('X-Auth-RateLimit-Limit', String(max));
    ctx.res.setHeader('X-Auth-RateLimit-Remaining', '0');
    throw errors.tooManyRequests(
      `Auth rate limit: max ${max} attempts per ${windowMs / 60000} minutes`
    );
  }

  list.push(now);
  ctx.res.setHeader('X-Auth-RateLimit-Limit', String(max));
  ctx.res.setHeader('X-Auth-RateLimit-Remaining', String(Math.max(0, max - list.length)));
}

// Periodisk opprydding av gamle entries (unng\u00e5 memory leak). Both
// buckets get the same cleanup pass on every tick.
function startRateLimitCleanup() {
  const interval = setInterval(() => {
    const now = Date.now();
    const globalCutoff = now - config.RATE_LIMIT_WINDOW_MS;
    for (const [ip, list] of hits.entries()) {
      while (list.length > 0 && list[0] < globalCutoff) list.shift();
      if (list.length === 0) hits.delete(ip);
    }
    const authCutoff = now - config.AUTH_RATE_LIMIT_WINDOW_MS;
    for (const [ip, list] of authHits.entries()) {
      while (list.length > 0 && list[0] < authCutoff) list.shift();
      if (list.length === 0) authHits.delete(ip);
    }
  }, config.RATE_LIMIT_WINDOW_MS);
  interval.unref();
  return () => clearInterval(interval);
}

// Test-only helpers to reset bucket state between tests.
function _resetRateLimitBuckets() {
  hits.clear();
  authHits.clear();
}

// ============================================================
// Security headers
// ============================================================
//
// Minimumsett baseline headers som ikke krever konfig.

// Content-Security-Policy: str\u00f8mlinjeformet mot Familieassistentens
// monolittiske index.html med inline <style> og inline event handlers.
// 'unsafe-inline' for script holdes inntil M5 modulariserer frontend.
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self'", // M5.2: service worker
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', CSP_POLICY);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // HSTS is only set when we are behind HTTPS (Caddy) — we check that via env
  if (config.NODE_ENV === 'production' && process.env.HTTPS_TERMINATED === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

// ============================================================
// Prompt injection sanitization
// ============================================================
//
// Brukes f\u00f8r KB-data legges i LLM system-prompt (RAG-kontekst).
// Fjerner:
//   - Instruksjons-kommandoer som "ignore previous", "you are now", etc.
//   - Rolle-hijack (system:, assistant:)
//   - Injeksjoner av tool-call JSON utenfor kontext
//   - Kontroll-tegn og overdrevne mellomrom

const DANGEROUS_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /you\s+are\s+now\s+[a-z]+/gi,
  /new\s+(system|instructions)/gi,
  /system\s*:\s*/gi,
  /assistant\s*:\s*/gi,
  /<\|im_(start|end)\|>/gi,
  /###\s*(system|instruction)/gi,
];

function sanitizeForPrompt(text, maxLen = 500) {
  if (!text) return '';
  let t = String(text);

  // Fjern potensielle injection-patterns
  for (const re of DANGEROUS_PATTERNS) t = t.replace(re, '[REDACTED]');

  // Fjern kontroll-tegn (unntatt newlines/tabs)
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Komprimer whitespace
  t = t.replace(/\s{3,}/g, '  ');

  // Trunker
  if (t.length > maxLen) t = t.slice(0, maxLen) + '...';

  return t.trim();
}

module.exports = {
  bearerAuth,
  rateLimit,
  startRateLimitCleanup,
  applySecurityHeaders,
  sanitizeForPrompt,
  getClientIp,
  // Test-only — exported for the security suite to reset between cases.
  _resetRateLimitBuckets,
};
