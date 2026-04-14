// Sikkerhets-middleware (Fase 4)
//
// Tilbyr:
//   - bearerAuth       : Bearer-token autentisering
//   - rateLimit        : In-memory sliding window rate limiter per IP
//   - securityHeaders  : X-Content-Type-Options, X-Frame-Options, etc.
//   - sanitizeForPrompt: Fjerner prompt-injection-mønstre før KB-tekst går til LLM
//
// Alt er null-dependency og fungerer med node:http direkte.

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
  // Unngå å lekke lengde via early return — inkluder lengdeforskjell i resultatet
  const maxLen = Math.max(a.length, b.length);
  let r = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return r === 0;
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

const hits = new Map();
const RATE_LIMIT_MAX_IPS = 10000; // Maks antall IP-er i map før eviction

function getClientIp(req) {
  // Kun stol på X-Forwarded-For hvis TRUST_PROXY er eksplisitt satt (reverse proxy)
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) {
      const ip = fwd.split(',')[0].trim();
      // Valider at det ser ut som en IP-adresse (v4 eller v6)
      if (/^[\d.:a-fA-F]+$/.test(ip)) return ip;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(ctx) {
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

// Periodisk opprydding av gamle entries (unng\u00e5 memory leak)
function startRateLimitCleanup() {
  const interval = setInterval(() => {
    const cutoff = Date.now() - config.RATE_LIMIT_WINDOW_MS;
    for (const [ip, list] of hits.entries()) {
      while (list.length > 0 && list[0] < cutoff) list.shift();
      if (list.length === 0) hits.delete(ip);
    }
  }, config.RATE_LIMIT_WINDOW_MS);
  interval.unref();
  return () => clearInterval(interval);
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
  // HSTS settes bare n\u00e5r vi er bak HTTPS (Caddy) — det sjekker vi via env
  if (config.NODE_ENV === 'production' && process.env.HTTPS_TERMINATED === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
};
