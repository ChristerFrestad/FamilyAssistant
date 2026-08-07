// Username/password authentication with progressive email verification.
//
// Product model (see docs/analyses/2026-08-07-password-auth-parallel.md):
//   1. Register with username + password → full access immediately.
//   2. Email is optional at first; verification via magic link.
//   3. Within EMAIL_VERIFICATION_GRACE_SECONDS (default 60 days) the
//      user may use the app without verifying.
//   4. After the grace window, login succeeds only after email is
//      verified; that post-grace path forces a password reset.
//
// Endpoints (registered from routes.js):
//   POST /api/auth/password/register
//   POST /api/auth/password/login
//   POST /api/auth/password/start-verification
//   POST /api/auth/password/set

const { config } = require('../config');
const { errors, HttpError } = require('../http/errors');
const { hashPassword, verifyPasswordOrDummy } = require('./password-hash');
const { createSessionForUser, setSessionCookie } = require('./sessions');
const {
  issueMagicLink,
  normaliseEmail,
  isSyntheticLocalEmail,
  SYNTHETIC_EMAIL_DOMAIN,
} = require('./magic-link');

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$|^[a-z0-9]{2,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function assertPasswordAuthEnabled() {
  if (config.PASSWORD_AUTH_ENABLED !== true) {
    throw errors.serviceUnavailable('Password authentication is not enabled on this server.');
  }
}

function normaliseUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(trimmed)) return null;
  return trimmed;
}

function validatePassword(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'required' };
  if (raw.length < MIN_PASSWORD) return { ok: false, reason: 'too_short' };
  if (raw.length > MAX_PASSWORD) return { ok: false, reason: 'too_long' };
  return { ok: true };
}

function syntheticEmailFor(username) {
  return `local+${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function parseCreatedAtMs(user) {
  if (!user?.created_at) return Date.now();
  const ms = Date.parse(String(user.created_at).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : Date.now();
}

function graceDeadlineMs(user) {
  const graceSec = config.EMAIL_VERIFICATION_GRACE_SECONDS;
  return parseCreatedAtMs(user) + graceSec * 1000;
}

function isEmailVerified(user) {
  return !!(user && user.email_verified_at);
}

function isWithinGrace(user) {
  return Date.now() < graceDeadlineMs(user);
}

function mustVerifyToLogin(user) {
  return !isEmailVerified(user) && !isWithinGrace(user);
}

function hasRealEmail(user) {
  if (!user?.email) return false;
  return !isSyntheticLocalEmail(user.email);
}

function publicUser(user) {
  if (!user) return null;
  const verified = isEmailVerified(user);
  const withinGrace = isWithinGrace(user);
  return {
    id: user.id,
    email: hasRealEmail(user) ? user.email : null,
    username: user.username || null,
    name: user.name,
    role: user.role,
    avatarUrl: user.avatar_url || null,
    familyId: user.family_id || null,
    profileMemberId: user.profile_member_id || null,
    onboardingCompleted: !!user.onboarding_completed,
    synthetic: false,
    isAdmin: !!user.is_admin,
    emailVerified: verified,
    withinGrace: verified ? true : withinGrace,
    verificationDueAt: verified ? null : new Date(graceDeadlineMs(user)).toISOString(),
    passwordResetRequired: !!user.password_reset_required,
  };
}

function redirectFor(user) {
  if (user.password_reset_required) return '/v2/set-password';
  if (user.onboarding_completed) return '/v2/dashboard';
  return '/v2/onboarding/family';
}

// ============================================================
// POST /api/auth/password/register
// ============================================================

async function handlePasswordRegister(ctx, repos) {
  assertPasswordAuthEnabled();
  if (config.PASSWORD_AUTH_OPEN_REGISTER !== true) {
    throw errors.forbidden('Self-registration is disabled on this server.');
  }

  const username = normaliseUsername(ctx.body?.username);
  if (!username) {
    throw errors.badRequest(
      'Username must be 2–32 characters: letters, digits, dot, underscore or hyphen.'
    );
  }

  const pw = validatePassword(ctx.body?.password);
  if (!pw.ok) {
    if (pw.reason === 'too_short') {
      throw errors.badRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
    }
    if (pw.reason === 'too_long') {
      throw errors.badRequest(`Password must be at most ${MAX_PASSWORD} characters.`);
    }
    throw errors.badRequest('Password is required.');
  }

  let email = null;
  if (ctx.body?.email != null && String(ctx.body.email).trim() !== '') {
    email = normaliseEmail(ctx.body.email);
    if (!email) throw errors.badRequest('A valid email address is required.');
    if (isSyntheticLocalEmail(email)) {
      throw errors.badRequest('That email domain is reserved.');
    }
  }

  const name =
    typeof ctx.body?.name === 'string' && ctx.body.name.trim()
      ? ctx.body.name.trim().slice(0, 100)
      : username;

  if (repos.auth.findByUsername(username)) {
    throw errors.conflict('That username is already taken.');
  }

  const storedEmail = email || syntheticEmailFor(username);
  if (email && repos.auth.findByEmail(email)) {
    // Real email already claimed (e.g. by a magic-link user).
    throw errors.conflict('That email is already registered.');
  }
  // Synthetic email should be unique per username; defensive check.
  if (!email && repos.auth.findByEmail(storedEmail)) {
    throw errors.conflict('That username is already taken.');
  }

  const passwordHash = await hashPassword(ctx.body.password);
  let user;
  try {
    user = repos.auth.createUser({
      email: storedEmail,
      name,
      username,
      passwordHash,
      emailVerifiedAt: null,
      passwordResetRequired: 0,
    });
  } catch (err) {
    // UNIQUE race
    if (err && /UNIQUE|constraint/i.test(String(err.message))) {
      throw errors.conflict('That username is already taken.');
    }
    throw err;
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  // Re-read for consistent public shape
  user = repos.auth.findById(user.id);
  return {
    ok: true,
    user: publicUser(user),
    redirect: redirectFor(user),
  };
}

// ============================================================
// POST /api/auth/password/login
// ============================================================

async function handlePasswordLogin(ctx, repos) {
  assertPasswordAuthEnabled();

  const username = normaliseUsername(ctx.body?.username);
  const password = ctx.body?.password;
  if (!username || typeof password !== 'string') {
    throw errors.badRequest('Username and password are required.');
  }

  const user = repos.auth.findByUsername(username);
  const ok = await verifyPasswordOrDummy(password, user?.password_hash || null);
  if (!ok || !user) {
    throw errors.unauthorized('Invalid username or password.');
  }

  if (mustVerifyToLogin(user)) {
    throw new HttpError({
      status: 403,
      title: 'Email verification required',
      detail: 'Your trial period ended. Verify your email and set a new password to continue.',
      extras: {
        code: 'email_verification_required',
        mustResetPassword: true,
        hasRealEmail: hasRealEmail(user),
        username: user.username,
      },
    });
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);
  const fresh = repos.auth.findById(user.id);

  return {
    ok: true,
    user: publicUser(fresh),
    redirect: redirectFor(fresh),
  };
}

// ============================================================
// POST /api/auth/password/start-verification
//
// Proves identity with username+password (or active session) and
// sends a magic link that verifies the email. When the account is
// past grace, the link purpose is email_verify_reset (forces
// password change after click).
// ============================================================

async function handleStartVerification(ctx, repos) {
  assertPasswordAuthEnabled();

  let user = null;

  // Prefer session if present (soft-auth path).
  if (ctx.user && !ctx.user._synthetic) {
    user = repos.auth.findById(ctx.user.id);
  }

  if (!user) {
    const username = normaliseUsername(ctx.body?.username);
    const password = ctx.body?.password;
    if (!username || typeof password !== 'string') {
      throw errors.badRequest('Username and password are required.');
    }
    user = repos.auth.findByUsername(username);
    const ok = await verifyPasswordOrDummy(password, user?.password_hash || null);
    if (!ok || !user) {
      throw errors.unauthorized('Invalid username or password.');
    }
  }

  if (isEmailVerified(user) && !user.password_reset_required) {
    return {
      ok: true,
      alreadyVerified: true,
      message: 'Email is already verified.',
    };
  }

  let email = hasRealEmail(user) ? user.email : null;
  if (ctx.body?.email != null && String(ctx.body.email).trim() !== '') {
    const next = normaliseEmail(ctx.body.email);
    if (!next) throw errors.badRequest('A valid email address is required.');
    if (isSyntheticLocalEmail(next)) {
      throw errors.badRequest('That email domain is reserved.');
    }
    // If another account owns this email, reject.
    const owner = repos.auth.findByEmail(next);
    if (owner && owner.id !== user.id) {
      throw errors.conflict('That email is already registered to another account.');
    }
    if (!email || email.toLowerCase() !== next) {
      repos.auth.setEmailUnverified(user.id, next);
      user = repos.auth.findById(user.id);
    }
    email = next;
  }

  if (!email) {
    throw errors.badRequest('An email address is required to verify your account.');
  }

  const forceReset = mustVerifyToLogin(user) || !!user.password_reset_required;
  const purpose = forceReset ? 'email_verify_reset' : 'email_verify';

  await issueMagicLink(repos, {
    email,
    purpose,
    userId: user.id,
    ctx,
  });

  return {
    ok: true,
    message: 'If the address is valid you will receive a verification email shortly.',
    purpose,
    mustResetPassword: forceReset,
  };
}

// ============================================================
// POST /api/auth/password/set
//
// Authenticated. When password_reset_required is set this is the
// only way forward; otherwise any logged-in password user may
// change their password.
// ============================================================

async function handleSetPassword(ctx, repos) {
  assertPasswordAuthEnabled();
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }

  const pw = validatePassword(ctx.body?.password);
  if (!pw.ok) {
    if (pw.reason === 'too_short') {
      throw errors.badRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
    }
    if (pw.reason === 'too_long') {
      throw errors.badRequest(`Password must be at most ${MAX_PASSWORD} characters.`);
    }
    throw errors.badRequest('Password is required.');
  }

  const passwordHash = await hashPassword(ctx.body.password);
  const user = repos.auth.setPasswordHash(ctx.user.id, passwordHash, {
    clearResetRequired: true,
  });

  return {
    ok: true,
    user: publicUser(user),
    redirect: redirectFor(user),
  };
}

module.exports = {
  handlePasswordRegister,
  handlePasswordLogin,
  handleStartVerification,
  handleSetPassword,
  publicUser,
  normaliseUsername,
  validatePassword,
  syntheticEmailFor,
  isEmailVerified,
  isWithinGrace,
  mustVerifyToLogin,
  hasRealEmail,
  graceDeadlineMs,
  redirectFor,
  USERNAME_RE,
  MIN_PASSWORD,
  MAX_PASSWORD,
};
