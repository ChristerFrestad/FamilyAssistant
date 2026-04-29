// Magic-link (passwordless email) authentication flow.
//
// User journey:
//   1. POST /api/auth/magic-link/start { email }
//        -> server generates a 256-bit random token, stores SHA-256(token)
//           in magic_link_tokens.token_hash with a 15 min TTL, and emails
//           the plain token in the URL via Resend (or the console fallback
//           when MAGIC_LINK_CONSOLE=true).
//   2. User clicks the link in the email: GET /api/auth/magic-link/verify?token=...
//        -> server hashes the incoming token, looks up the hash, validates
//           expiry/used-state, marks the row used, upserts the user,
//           creates a session cookie, redirects to /v2/dashboard or
//           /v2/onboarding/family depending on users.onboarding_completed.
//
// Token-at-rest hardening (Sprint 3 / Fase 1e): tokens are NEVER stored as
// plain text. The SHA-256 hash is stored instead so a database-only
// disclosure cannot replay live magic links. The plain token only exists
// in the email body the user receives; once verified, the row is marked
// used (idempotent) and cannot be replayed even with the original plain
// token. See migration 022 for the column rename.
//
// Rate limit: max 5 start calls per hour per email address. The counter is
// in-memory per process; it resets on restart (acceptable for MVP scale).
// A separate per-IP rate limit at 5/15min is enforced upstream by
// server/http/security.js applyAuthRateLimit().

const { config } = require('../config');
const { errors, HttpError } = require('../http/errors');
const { randomToken, sha256 } = require('./crypto');
const { isEmailConfigured, sendMagicLinkEmail } = require('../services/email.service');
const { createSessionForUser, setSessionCookie } = require('./sessions');

// Hash the plain token using SHA-256. Centralised here so the
// generate-side and the verify-side derive the same digest from the
// same input, and so tests can import the helper to assert end-to-end
// hash behaviour.
function hashToken(plain) {
  return sha256(plain);
}

function gone(detail) {
  return new HttpError({ status: 410, title: 'Gone', detail });
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const TOKEN_TTL_MINUTES = 15;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const rateState = new Map(); // email -> { count, windowStart }

function normaliseEmail(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return trimmed;
}

function checkRateLimit(email) {
  const now = Date.now();
  const entry = rateState.get(email);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateState.set(email, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.count += 1;
  return { allowed: true };
}

function resetRateLimitForTests() {
  rateState.clear();
}

function magicLinkUrlFor(token) {
  const base = (config.APP_URL || '').replace(/\/+$/, '');
  const path = `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

// ============================================================
// POST /api/auth/magic-link/start
// ============================================================

async function handleMagicLinkStart(ctx, repos) {
  const emailConfigured = isEmailConfigured();
  const consoleMode = config.MAGIC_LINK_CONSOLE;

  if (!emailConfigured && !consoleMode) {
    throw errors.serviceUnavailable('Magic-link email is not configured on this server.');
  }

  const email = normaliseEmail(ctx.body?.email);
  if (!email) throw errors.badRequest('A valid email address is required.');

  const rate = checkRateLimit(email);
  if (!rate.allowed) {
    ctx.res.setHeader('Retry-After', String(rate.retryAfter));
    throw errors.tooManyRequests(
      `Too many login requests for this email. Try again in ${rate.retryAfter}s.`
    );
  }

  // Generate a 256-bit random plain token. Only the SHA-256 hash is
  // persisted (migration 022). The plain value is only embedded in
  // the URL we send to the user — once the email is delivered, no
  // copy of the plain token exists server-side.
  const token = randomToken(32);
  const tokenHash = hashToken(token);
  repos.auth.createMagicLink({ tokenHash, email, ttlMinutes: TOKEN_TTL_MINUTES });
  const url = magicLinkUrlFor(token);

  if (emailConfigured) {
    try {
      await sendMagicLinkEmail({ to: email, url });
    } catch (err) {
      ctx.log.error({ err: err.message }, 'failed to send magic-link email');
      throw errors.serviceUnavailable('Could not send email. Please try again later.');
    }
  } else {
    // Pilot/MVP escape hatch: print the magic link URL to the server log so
    // an operator can copy it out of container logs (Portainer etc.) and
    // paste it into the browser. Only reached when MAGIC_LINK_CONSOLE=true
    // AND Resend is not configured.
    logMagicLinkToConsole({ email, url });
  }

  // Intentionally return minimal info — do not reveal whether the email
  // belongs to an existing account, to avoid account enumeration.
  return { ok: true, message: 'If the address is valid you will receive a login email shortly.' };
}

function logMagicLinkToConsole({ email, url }) {
  const bar = '='.repeat(72);
  // Use plain console.log (not the structured pino logger) so the URL is
  // easy to spot and copy in raw container-log output.
  console.log(bar);
  console.log('MAGIC LINK (console mode — no email provider configured)');
  console.log(`  email:   ${email}`);
  console.log(`  url:     ${url}`);
  console.log(`  expires: ${TOKEN_TTL_MINUTES} minutes`);
  console.log(bar);
}

// ============================================================
// GET /api/auth/magic-link/verify?token=...
// ============================================================

async function handleMagicLinkVerify(ctx, repos) {
  const token = ctx.query?.token;
  if (!token || typeof token !== 'string') {
    throw errors.badRequest('Missing token.');
  }

  // Hash the incoming token and look up the hash. The DB never sees
  // the plain token; an attacker with read-only DB access cannot
  // reverse the hash to forge a verify-request.
  const tokenHash = hashToken(token);
  const row = repos.auth.findMagicLinkByHash(tokenHash);
  if (!row) throw errors.badRequest('Invalid token.');
  if (row.used_at) throw gone('This magic link has already been used.');
  if (isMagicLinkExpired(row)) throw gone('This magic link has expired. Request a new one.');

  repos.auth.markMagicLinkUsed(tokenHash);

  // Upsert user: reuse existing account if email matches, otherwise create.
  let user = repos.auth.findByEmail(row.email);
  if (!user) {
    user = repos.auth.createUser({ email: row.email, name: row.email });
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  // Onboarding-aware redirect. Migration 021 added
  // users.onboarding_completed; brand-new users come back as 0 and
  // are routed through the family-setup wizard before they reach
  // the main app surface. Returning pilot-users with the flag set
  // skip straight to the dashboard.
  const target = redirectTargetForUser(user);
  ctx.res.writeHead(302, { Location: target });
  ctx.res.end();
}

// Compute the post-login destination. Exported as a named function
// so tests can assert it returns the right URL for both states
// without having to re-mount the full HTTP layer.
function redirectTargetForUser(user) {
  if (user && user.onboarding_completed) return '/v2/dashboard';
  return '/v2/onboarding/family';
}

function isMagicLinkExpired(row) {
  if (!row?.expires_at) return true;
  // SQLite datetime is "YYYY-MM-DD HH:MM:SS" in UTC. Append 'Z' so Date.parse
  // interprets it as UTC rather than local time.
  const expiresMs = Date.parse(row.expires_at.replace(' ', 'T') + 'Z');
  return !Number.isFinite(expiresMs) || expiresMs < Date.now();
}

module.exports = {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  resetRateLimitForTests,
  normaliseEmail,
  hashToken,
  redirectTargetForUser,
  RATE_LIMIT_MAX,
  TOKEN_TTL_MINUTES,
};
