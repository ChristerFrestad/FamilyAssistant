// Magic-link authentication (email-based passwordless login).
//
// Flow:
//   1. POST /api/auth/magic-link/start  { email } → issues token, emails link
//   2. GET  /api/auth/magic-link/verify?token=... → creates session, redirects
//
// Tokens are stored as SHA-256 hashes. The raw token is only ever present in
// the emailed URL and is never persisted. TTL defaults to 15 minutes.
//
// When RESEND_API_KEY is unset and MAGIC_LINK_CONSOLE=true the link is printed
// to the server log instead of being emailed (pilot/dev convenience).

const crypto = require('crypto');
const { config } = require('../config');
const { errors, HttpError } = require('../http/errors');
const { createSessionForUser, setSessionCookie } = require('./sessions');
const { sha256 } = require('./crypto');
const { normaliseEmail, isSyntheticLocalEmail } = require('./email');
const { sendMagicLinkEmail } = require('../services/email.service');

const TOKEN_TTL_MINUTES = 15;

function hashToken(token) {
  return sha256(token);
}

function isMagicLinkExpired(row) {
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() < Date.now();
}

function gone(detail) {
  return new HttpError({
    status: 410,
    title: 'Gone',
    detail,
  });
}

async function issueMagicLink(repos, { email, purpose = 'login', userId = null, ctx }) {
  const token = crypto.randomBytes(32).toString('hex');
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

  if (config.RESEND_API_KEY) {
    await sendMagicLinkEmail({ to: email, url, purpose });
  } else if (config.MAGIC_LINK_CONSOLE) {
    logMagicLinkToConsole({ email, url, purpose });
  } else {
    throw errors.serviceUnavailable(
      'Email provider not configured. Set RESEND_API_KEY or MAGIC_LINK_CONSOLE=true.'
    );
  }

  return { token, url }; // token only for tests; never returned to client
}

async function handleMagicLinkStart(ctx, repos) {
  const email = normaliseEmail(ctx.body?.email);
  if (!email) throw errors.badRequest('A valid email address is required.');
  if (isSyntheticLocalEmail(email)) {
    throw errors.badRequest('A valid email address is required.');
  }

  await issueMagicLink(repos, { email, purpose: 'login', userId: null, ctx });

  // Audit magic-link generation (enumeration-safe: we still log the attempt).
  try {
    repos._db
      .prepare(
        `INSERT INTO audit_log
           (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        0, // system / unknown family — may fail FK, caught below
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
    /* ignore — family_id=0 may violate FK; audit must not break flow */
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
    // Mark email verified
    repos.auth.markEmailVerified(user.id);
    if (purpose === 'email_verify_reset') {
      // Force password change on next login
      repos.auth.setMustResetPassword(user.id, true);
    }
  } else {
    // login purpose
    user = repos.auth.findByEmail(row.email);
    if (!user) {
      // Auto-create user on first magic-link login
      user = repos.auth.createUserFromEmail(row.email);
    }
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  // Redirect into the app. Onboarding guard will send incomplete users
  // to the onboarding flow.
  const base = (config.APP_URL || '').replace(/\/$/, '') || '';
  const target = user.onboarding_completed ? '/v2/' : '/v2/onboarding';
  ctx.res.writeHead(302, { Location: `${base}${target}` });
  ctx.res.end();
}

module.exports = {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  issueMagicLink,
  hashToken,
  TOKEN_TTL_MINUTES,
};
