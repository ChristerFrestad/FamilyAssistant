// Magic-link (passwordless email) authentication + email verification.
//
// User journeys:
//   1. POST /api/auth/magic-link/start { email }  purpose=login
//        -> token hash stored, email (or console) delivers plain token URL.
//   2. GET /api/auth/magic-link/verify?token=...
//        -> login | email_verify | email_verify_reset depending on row.purpose
//
// Token-at-rest: SHA-256 hash only (migration 022). purpose/user_id added
// in migration 031 for progressive email verification.
//
// Rate limit: max 5 start calls per hour per email address (in-memory).

const { config } = require('../config');
const { errors, HttpError } = require('../http/errors');
const { randomToken, sha256 } = require('./crypto');
const { isEmailConfigured, sendMagicLinkEmail } = require('../services/email.service');
const { createSessionForUser, setSessionCookie } = require('./sessions');

const SYNTHETIC_EMAIL_DOMAIN = 'password.local';

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

function isSyntheticLocalEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
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

/**
 * Shared issuer used by classic magic-link start and password-auth
 * verification. Handles rate-limit, persistence, and email/console delivery.
 */
async function issueMagicLink(repos, { email, purpose = 'login', userId = null, ctx }) {
  const emailConfigured = isEmailConfigured();
  const consoleMode = config.MAGIC_LINK_CONSOLE;

  if (!emailConfigured && !consoleMode) {
    throw errors.serviceUnavailable('Magic-link email is not configured on this server.');
  }

  if (isSyntheticLocalEmail(email)) {
    throw errors.badRequest('Cannot send email to a local placeholder address.');
  }

  const rate = checkRateLimit(email);
  if (!rate.allowed) {
    if (ctx?.res) ctx.res.setHeader('Retry-After', String(rate.retryAfter));
    throw errors.tooManyRequests(
      `Too many login requests for this email. Try again in ${rate.retryAfter}s.`
    );
  }

  const token = randomToken(32);
  const tokenHash = hashToken(token);
  repos.auth.createMagicLink({
    tokenHash,
    email,
    ttlMinutes: TOKEN_TTL_MINUTES,
    purpose,
    userId,
  });
  const url = magicLinkUrlFor(token);

  if (emailConfigured) {
    try {
      await sendMagicLinkEmail({ to: email, url });
    } catch (err) {
      if (ctx?.log) ctx.log.error({ err: err.message }, 'failed to send magic-link email');
      throw errors.serviceUnavailable('Could not send email. Please try again later.');
    }
  } else {
    logMagicLinkToConsole({ email, url, purpose });
  }

  return { token, url, purpose };
}

// ============================================================
// POST /api/auth/magic-link/start
// ============================================================

async function handleMagicLinkStart(ctx, repos) {
  const email = normaliseEmail(ctx.body?.email);
  if (!email) throw errors.badRequest('A valid email address is required.');
  if (isSyntheticLocalEmail(email)) {
    throw errors.badRequest('A valid email address is required.');
  }

  await issueMagicLink(repos, { email, purpose: 'login', userId: null, ctx });

  // Audit magic-link generation (enumeration-safe).
  // Pre-family / system events may lack a valid family_id — swallow FK errors.
  try {
    repos._db
      .prepare(
        `INSERT INTO audit_log
           (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        0,
        ctx.requestId || 'unknown',
        `email:${email}`,
        'POST',
        'auth',
        null,
        '/api/auth/magic-link/start',
        null,
        null,
        JSON.stringify({ event: 'magic_link_issued', purpose: 'login' }).slice(0, 2000)
      );
  } catch {
    /* ignore */
  }

  return { ok: true, message: 'If the address is valid you will receive a login email shortly.' };
}

function logMagicLinkToConsole({ email, url, purpose }) {
  const bar = '='.repeat(72);
  console.log(bar);
  console.log('MAGIC LINK (console mode — no email provider configured)');
  console.log(`  email:   ${email}`);
  console.log(`  purpose: ${purpose || 'login'}`);
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

  const tokenHash = hashToken(token);
  const row = repos.auth.findMagicLinkByHash(tokenHash);
  if (!row) throw errors.badRequest('Invalid token.');
  if (row.used_at) throw gone('This magic link has already been used.');
  if (isMagicLinkExpired(row)) throw gone('This magic link has expired. Request a new one.');

  repos.auth.markMagicLinkUsed(tokenHash);

  const purpose = row.purpose || 'login';
  let user = null;

  if (purpose === 'email_verify' || purpose === 'email_verify_reset') {
    if (row.user_id) {
      user = repos.auth.findById(Number(row.user_id));
    }
    if (!user) {
      user = repos.auth.findByEmail(row.email);
    }
    if (!user) {
      throw errors.badRequest('Verification link is not linked to an account.');
    }
    // Bind / confirm the email on the account and mark verified.
    user = repos.auth.markEmailVerified(user.id, row.email);
    if (purpose === 'email_verify_reset') {
      user = repos.auth.setPasswordResetRequired(user.id, true);
    }
  } else {
    // Classic login magic-link: upsert by email and treat email as verified.
    user = repos.auth.findByEmail(row.email);
    if (!user) {
      user = repos.auth.createUser({
        email: row.email,
        name: row.email,
        emailVerifiedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
    } else if (!user.email_verified_at) {
      user = repos.auth.markEmailVerified(user.id, row.email);
    }
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  // Re-read for password_reset_required / onboarding flags.
  user = repos.auth.findById(user.id);
  const target = redirectTargetForUser(user);
  ctx.res.writeHead(302, { Location: target });
  ctx.res.end();
}

function redirectTargetForUser(user) {
  if (user && user.password_reset_required) return '/set-password';
  if (user && user.onboarding_completed) return '/dashboard';
  return '/onboarding/family';
}

function isMagicLinkExpired(row) {
  if (!row?.expires_at) return true;
  const expiresMs = Date.parse(row.expires_at.replace(' ', 'T') + 'Z');
  return !Number.isFinite(expiresMs) || expiresMs < Date.now();
}

module.exports = {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  issueMagicLink,
  resetRateLimitForTests,
  normaliseEmail,
  isSyntheticLocalEmail,
  hashToken,
  redirectTargetForUser,
  SYNTHETIC_EMAIL_DOMAIN,
  RATE_LIMIT_MAX,
  TOKEN_TTL_MINUTES,
};
