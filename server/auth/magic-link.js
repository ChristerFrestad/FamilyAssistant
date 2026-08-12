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
  return trimmed;
}

function isSyntheticLocalEmail(email) {
  return email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

function checkRateLimit(email) {
  const now = Date.now();
  let entry = rateState.get(email);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateState.set(email, entry);
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    throw errors.tooManyRequests(
      `Too many magic-link requests for this address. Try again in about an hour.`
    );
  }
  entry.count += 1;
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

async function issueMagicLink(repos, { email, purpose = 'login', userId = null, ctx }) {
  checkRateLimit(email);
  const token = randomToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  repos.auth.createMagicLink({
    tokenHash,
    email,
    purpose,
    userId,
    expiresAt,
  });

  const base = (config.APP_URL || '').replace(/\/$/, '') || 'http://localhost:7777';
  const url = `${base}/api/auth/magic-link/verify?token=${token}`;

  if (isEmailConfigured()) {
    await sendMagicLinkEmail({ to: email, url, purpose });
  } else if (config.MAGIC_LINK_CONSOLE) {
    logMagicLinkToConsole({ email, url, purpose });
  } else {
    throw errors.serviceUnavailable(
      'Email provider not configured. Set RESEND_API_KEY or MAGIC_LINK_CONSOLE=true.'
    );
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
  // family_id may be unknown pre-onboarding; try/catch so FK cannot break flow.
  try {
    const familyId = 0;
    repos._db
      .prepare(
        `INSERT INTO audit_log
           (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        familyId,
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
    /* ignore — pre-family events may lack a valid family_id */
  }

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

  const tokenHash = hashToken(token);
  const row = repos.auth.findMagicLinkByHash(tokenHash);
  if (!row) throw errors.badRequest('Invalid token.');
  if (row.used_at) throw gone('This magic link has already been used.');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw gone('This magic link has expired. Request a new one.');
  }

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
    repos.auth.markEmailVerified(user.id);
    if (purpose === 'email_verify_reset') {
      repos.auth.setMustResetPassword(user.id, true);
    }
  } else {
    // login purpose
    user = repos.auth.findByEmail(row.email);
    if (!user) {
      user = repos.auth.createUserFromEmail(row.email);
    }
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  const base = (config.APP_URL || '').replace(/\/$/, '') || '';
  const target = user.onboarding_completed ? '/v2/' : '/v2/onboarding';
  ctx.res.writeHead(302, { Location: `${base}${target}` });
  ctx.res.end();
}

function redirectTargetForUser(user) {
  return user.onboarding_completed ? '/v2/' : '/v2/onboarding';
}

module.exports = {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  issueMagicLink,
  hashToken,
  redirectTargetForUser,
  SYNTHETIC_EMAIL_DOMAIN,
  RATE_LIMIT_MAX,
  TOKEN_TTL_MINUTES,
};
