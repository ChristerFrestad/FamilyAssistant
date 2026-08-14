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

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username || null,
    email: user.email || null,
    name: user.name || null,
    role: user.role || 'owner',
    avatarUrl: user.avatar_url || null,
    familyId: user.family_id || null,
    profileMemberId: user.profile_member_id || null,
    onboardingCompleted: !!user.onboarding_completed,
    emailVerifiedAt: user.email_verified_at || null,
    mustResetPassword: !!user.must_reset_password,
    isAdmin: !!user.is_admin,
  };
}

function redirectFor(user) {
  if (!user) return '/';
  if (!user.onboarding_completed) return '/onboarding';
  return '/';
}

function hasRealEmail(user) {
  return Boolean(
    user && user.email && !String(user.email).endsWith('@' + SYNTHETIC_EMAIL_DOMAIN)
  );
}

function mustVerifyToLogin(user) {
  if (!user) return false;
  if (user.email_verified_at) return false;
  if (user.must_reset_password) return true;
  const grace = Number(config.EMAIL_VERIFICATION_GRACE_SECONDS || 0);
  if (grace <= 0) return true;
  const created = user.created_at ? new Date(user.created_at + 'Z').getTime() : 0;
  if (!created) return true;
  return Date.now() - created > grace * 1000;
}

function validateUsername(username) {
  if (typeof username !== 'string') return 'Username is required.';
  const u = username.trim().toLowerCase();
  if (u.length < 2 || u.length > 32) return 'Username must be 2–32 characters.';
  if (!USERNAME_RE.test(u)) {
    return 'Username may only contain lowercase letters, digits, dots, underscores and hyphens.';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD)
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD)
    return `Password must be at most ${MAX_PASSWORD} characters.`;
  return null;
}

async function handlePasswordRegister(ctx, repos) {
  if (!config.PASSWORD_AUTH_ENABLED) {
    throw errors.serviceUnavailable('Password authentication is not enabled.');
  }
  if (!config.PASSWORD_AUTH_OPEN_REGISTER) {
    throw errors.forbidden('Open registration is disabled.');
  }

  const usernameRaw = ctx.body?.username;
  const password = ctx.body?.password;
  const name = String(ctx.body?.name || usernameRaw || '')
    .trim()
    .slice(0, 80);

  const usernameErr = validateUsername(usernameRaw);
  if (usernameErr) throw errors.badRequest(usernameErr);
  const passwordErr = validatePassword(password);
  if (passwordErr) throw errors.badRequest(passwordErr);

  const username = String(usernameRaw).trim().toLowerCase();

  const existing = repos.auth.findByUsername(username);
  if (existing) {
    throw errors.conflict('Username is already taken.');
  }

  const passwordHash = await hashPassword(password);
  const user = repos.auth.createUser({
    username,
    name: name || username,
    passwordHash,
  });

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  return {
    ok: true,
    user: publicUser(user),
    redirect: redirectFor(user),
  };
}

async function handlePasswordLogin(ctx, repos) {
  if (!config.PASSWORD_AUTH_ENABLED) {
    throw errors.serviceUnavailable('Password authentication is not enabled.');
  }

  const username = String(ctx.body?.username || '')
    .trim()
    .toLowerCase();
  const password = ctx.body?.password;

  if (!username || typeof password !== 'string') {
    throw errors.badRequest('Username and password are required.');
  }

  const user = repos.auth.findByUsername(username);
  const ok = await verifyPasswordOrDummy(password, user?.password_hash || null);
  if (!ok || !user) {
    try {
      const familyId = user && user.family_id ? user.family_id : null;
      if (familyId) {
        repos._db
          .prepare(
            `INSERT INTO audit_log
               (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            familyId,
            ctx.requestId || 'unknown',
            username ? `username:${username}` : 'anonymous',
            'POST',
            'auth',
            user ? String(user.id) : null,
            '/api/auth/password/login',
            null,
            null,
            JSON.stringify({ event: 'login_failure', reason: 'invalid_credentials' }).slice(0, 2000)
          );
      }
    } catch {
      /* audit must not break auth */
    }
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

  try {
    const familyId = user.family_id || null;
    if (familyId) {
      repos._db
        .prepare(
          `INSERT INTO audit_log
             (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          familyId,
          ctx.requestId || 'unknown',
          `user:${user.id}`,
          'POST',
          'auth',
          String(user.id),
          '/api/auth/password/login',
          null,
          null,
          JSON.stringify({ event: 'login_success', method: 'password' }).slice(0, 2000)
        );
    }
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    user: publicUser(fresh),
    redirect: redirectFor(fresh),
  };
}

async function handleStartVerification(ctx, repos) {
  if (!config.PASSWORD_AUTH_ENABLED) {
    throw errors.serviceUnavailable('Password authentication is not enabled.');
  }
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }

  const email = normaliseEmail(ctx.body?.email);
  if (!email || isSyntheticLocalEmail(email)) {
    throw errors.badRequest('A valid email address is required.');
  }

  await issueMagicLink(repos, {
    email,
    purpose: 'verify-email',
    userId: ctx.user.id,
    ctx,
  });

  return { ok: true, message: 'Verification email sent if the address is valid.' };
}

async function handleSetPassword(ctx, repos) {
  if (!config.PASSWORD_AUTH_ENABLED) {
    throw errors.serviceUnavailable('Password authentication is not enabled.');
  }

  const token = String(ctx.body?.token || '').trim();
  const password = ctx.body?.password;

  if (!token) throw errors.badRequest('Token is required.');
  const passwordErr = validatePassword(password);
  if (passwordErr) throw errors.badRequest(passwordErr);

  const { resolveMagicLinkToken } = require('./magic-link');
  const resolved = await resolveMagicLinkToken(repos, token, {
    allowedPurposes: ['verify-email', 'reset'],
  });

  if (!resolved || !resolved.userId) {
    throw errors.unauthorized('Invalid or expired token.');
  }

  const passwordHash = await hashPassword(password);
  repos.auth.setPassword(resolved.userId, passwordHash);
  if (resolved.email) {
    repos.auth.markEmailVerified(resolved.userId, resolved.email);
  }
  if (typeof repos.auth.clearMustResetPassword === 'function') {
    repos.auth.clearMustResetPassword(resolved.userId);
  }

  const user = repos.auth.findById(resolved.userId);
  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);

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
  mustVerifyToLogin,
  hasRealEmail,
};
