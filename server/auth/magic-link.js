// Magic-link (passwordless email) authentication flow.
//
// User journey:
//   1. POST /api/auth/magic-link/start { email }
//        -> server creates a one-time token (15 min TTL), stores it in
//           magic_link_tokens, sends an email via Resend.
//   2. User clicks the link in the email: GET /api/auth/magic-link/verify?token=...
//        -> server validates the token, marks it used, upserts the user,
//           creates a session cookie, redirects to '/'.
//
// Rate limit: max 5 start calls per hour per email address. The counter is
// in-memory per process; it resets on restart (acceptable for MVP scale).

const { config } = require('../config');
const { errors, HttpError } = require('../http/errors');
const { randomToken } = require('./crypto');
const { isEmailConfigured, sendMagicLinkEmail } = require('../services/email.service');
const { createSessionForUser, setSessionCookie } = require('./sessions');

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
  if (!isEmailConfigured()) {
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

  const token = randomToken(32);
  repos.auth.createMagicLink({ token, email, ttlMinutes: TOKEN_TTL_MINUTES });

  try {
    await sendMagicLinkEmail({ to: email, url: magicLinkUrlFor(token) });
  } catch (err) {
    ctx.log.error({ err: err.message }, 'failed to send magic-link email');
    throw errors.serviceUnavailable('Could not send email. Please try again later.');
  }

  // Intentionally return minimal info — do not reveal whether the email
  // belongs to an existing account, to avoid account enumeration.
  return { ok: true, message: 'If the address is valid you will receive a login email shortly.' };
}

// ============================================================
// GET /api/auth/magic-link/verify?token=...
// ============================================================

async function handleMagicLinkVerify(ctx, repos) {
  const token = ctx.query?.token;
  if (!token || typeof token !== 'string') {
    throw errors.badRequest('Missing token.');
  }

  const row = repos.auth.findMagicLink(token);
  if (!row) throw errors.badRequest('Invalid token.');
  if (row.used_at) throw gone('This magic link has already been used.');
  if (isMagicLinkExpired(row)) throw gone('This magic link has expired. Request a new one.');

  repos.auth.markMagicLinkUsed(token);

  // Upsert user: reuse existing account if email matches, otherwise create.
  let user = repos.auth.findByEmail(row.email);
  if (!user) {
    user = repos.auth.createUser({ email: row.email, name: row.email });
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  ctx.res.writeHead(302, { Location: '/' });
  ctx.res.end();
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
  RATE_LIMIT_MAX,
  TOKEN_TTL_MINUTES,
};
