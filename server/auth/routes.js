// HTTP endpoints for authentication flows.
//
// Registered from server/routes.js via registerAuthRoutes(router, { repos }).
// Every path under /api/auth/* is treated as public by the authenticate
// middleware (see auth/middleware.js), so these handlers never see ctx.user
// populated — they create it.

const crypto = require('crypto');
const { config } = require('../config');
const { errors } = require('../http/errors');
const { validateBody } = require('../http/validate');
const schemas = require('../schemas');
const {
  generatePkcePair,
  buildAuthorizationUrl,
  exchangeCodeForIdToken,
  verifyIdToken,
  redirectUriFor,
} = require('./google');
const {
  createSessionForUser,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
} = require('./sessions');
const { parseCookies, serializeCookie, appendSetCookie, clearCookie } = require('./cookies');
const { seedFamilyDefaults } = require('../services/seed.service');
const {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  redirectTargetForUser,
} = require('./magic-link');
const {
  handlePasswordRegister,
  handlePasswordLogin,
  handleStartVerification,
  handleSetPassword,
  publicUser,
} = require('./password');
const { isEmailConfigured } = require('../services/email.service');
const pilotPasswordService = require('../services/pilot-password.service');
const { getClientIp } = require('../http/security');
const adminBootstrap = require('../services/admin-bootstrap.service');

const OAUTH_STATE_COOKIE = 'fa_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// ============================================================
// Signed state-cookie helpers
// ============================================================

function requireSessionSecret() {
  if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32) {
    throw new Error(
      'SESSION_SECRET is not configured. Refusing to sign OAuth state / ' +
        'magic-link tokens with a placeholder. Set SESSION_SECRET in env ' +
        '(openssl rand -hex 32) or let the bootstrap wizard generate one.'
    );
  }
  return config.SESSION_SECRET;
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', requireSessionSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyPayload(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const [body, mac] = signed.split('.');
  const expected = crypto
    .createHmac('sha256', requireSessionSecret())
    .update(body)
    .digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ============================================================
// OAuth start
// ============================================================

function handleGoogleStart(ctx) {
  if (!config.GOOGLE_CLIENT_ID) {
    throw errors.serviceUnavailable('Google OAuth is not configured on this server.');
  }
  const { verifier, challenge } = generatePkcePair();
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = redirectUriFor();

  const payload = { state, nonce, verifier, ts: Date.now() };
  const signed = signPayload(payload);
  appendSetCookie(
    ctx.res,
    serializeCookie(OAUTH_STATE_COOKIE, signed, {
      httpOnly: true,
      secure: isSecureRequest(ctx.req),
      sameSite: 'lax',
      path: '/api/auth/google/',
      maxAge: OAUTH_STATE_TTL_SECONDS,
    })
  );

  const url = buildAuthorizationUrl({
    state,
    nonce,
    codeChallenge: challenge,
    redirectUri,
  });
  ctx.res.writeHead(302, { Location: url });
  ctx.res.end();
}

// ============================================================
// OAuth callback
// ============================================================

async function handleGoogleCallback(ctx, repos) {
  if (!config.GOOGLE_CLIENT_ID) {
    throw errors.serviceUnavailable('Google OAuth is not configured on this server.');
  }

  const { code, state, error } = ctx.query || {};
  if (error) throw errors.badRequest(`Google returned error: ${error}`);
  if (!code || !state) throw errors.badRequest('Missing code or state.');

  const cookies = parseCookies(ctx.req.headers.cookie);
  const signed = cookies[OAUTH_STATE_COOKIE];
  if (!signed) throw errors.badRequest('OAuth state cookie missing. Start the flow again.');

  const payload = verifyPayload(signed);
  if (!payload) throw errors.badRequest('OAuth state cookie is invalid.');
  if (payload.state !== state) throw errors.badRequest('OAuth state mismatch.');
  if (Date.now() - payload.ts > OAUTH_STATE_TTL_SECONDS * 1000) {
    throw errors.badRequest('OAuth state has expired. Start the flow again.');
  }

  clearCookie(ctx.res, OAUTH_STATE_COOKIE, { path: '/api/auth/google/' });

  const redirectUri = redirectUriFor();
  const tokenResponse = await exchangeCodeForIdToken({
    code,
    codeVerifier: payload.verifier,
    redirectUri,
  });
  const claims = await verifyIdToken(tokenResponse.id_token, { expectedNonce: payload.nonce });

  if (!claims.email_verified) {
    throw errors.forbidden('Google account email is not verified.');
  }

  let user = repos.auth.findByGoogleSub(claims.sub) || repos.auth.findByEmail(claims.email);
  if (!user) {
    user = repos.auth.createUser({
      email: claims.email,
      googleSub: claims.sub,
      name: claims.name || claims.email,
      avatarUrl: claims.picture || null,
      emailVerifiedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
  } else {
    user = repos.auth.updateProfile(user.id, {
      name: claims.name || user.name,
      avatarUrl: claims.picture || user.avatar_url,
      googleSub: claims.sub,
    });
    if (!user.email_verified_at) {
      user = repos.auth.markEmailVerified(user.id, claims.email);
    }
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  const target = redirectTargetForUser(user);
  ctx.res.writeHead(302, { Location: target });
  ctx.res.end();
}

// ============================================================
// Session introspection / logout
// ============================================================

function handleMe(ctx) {
  if (!ctx.user) {
    return { authenticated: false, user: null };
  }
  if (ctx.user._synthetic) {
    return {
      authenticated: true,
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        role: ctx.user.role,
        avatarUrl: ctx.user.avatar_url || null,
        familyId: ctx.user.family_id || null,
        profileMemberId: ctx.user.profile_member_id || null,
        onboardingCompleted: !!ctx.user.onboarding_completed,
        synthetic: true,
        isAdmin: !!ctx.user.is_admin,
      },
    };
  }
  return {
    authenticated: true,
    user: publicUser(ctx.user),
  };
}

// ============================================================
// Admin endpoints
// ============================================================

function handleAdminMe(ctx) {
  if (!ctx.user || !ctx.user.is_admin) {
    throw errors.forbidden('Admin role required.');
  }
  return {
    isAdmin: true,
    userId: ctx.user.id,
    email: ctx.user.email,
    promotedAt: ctx.user.promoted_at || null,
    promotedByUserId: ctx.user.promoted_by_user_id || null,
  };
}

function handleAdminSetup(ctx, repos) {
  if (!ctx.user || !ctx.user.is_admin) {
    throw errors.forbidden('Admin role required.');
  }
  const setup = adminBootstrap.getAppSetup(repos._db);
  return {
    bootstrapped: setup !== null,
    method: setup?.bootstrap_method || null,
    adminUserId: setup?.admin_user_id || null,
    bootstrappedAt: setup?.bootstrapped_at || null,
  };
}

function handleOnboardingComplete(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  if (ctx.user.family_id) {
    throw errors.conflict('User is already in a family.');
  }

  const userId = ctx.user.id;
  const { family, user } = ctx.body;
  const familyName = family.name;
  const userName = user.name;
  const category = user.category;
  const portionFactor = user.portionFactor;

  let result;
  try {
    const tx = repos._db.transaction(() => {
      const newFamily = repos.family.createFamily(familyName, userId);
      const member = repos.family.addMember(newFamily.id, {
        name: userName,
        category,
        portionFactor,
      });
      repos.auth.setFamily(userId, newFamily.id, 'owner', member.id);
      repos._db
        .prepare(
          `UPDATE users
              SET name = ?, portion_factor = ?, onboarding_completed = 1
            WHERE id = ?`
        )
        .run(userName, portionFactor, userId);
      const seedSummary = seedFamilyDefaults(repos, newFamily.id);
      repos._db
        .prepare(
          `INSERT INTO audit_log
             (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newFamily.id,
          ctx.requestId || 'unknown',
          `user:${userId}`,
          'POST',
          'onboarding',
          String(newFamily.id),
          '/api/auth/onboarding/complete',
          null,
          null,
          JSON.stringify({
            event: 'onboarding_completed',
            memberId: member.id,
            seedSummary,
          }).slice(0, 2000)
        );
      const adminDecision = adminBootstrap.bootstrapAdminIfNeeded({
        db: repos._db,
        userId,
        userEmail: ctx.user.email,
      });
      const updatedUser = repos.auth.findById(userId);
      result = { newFamily, member, updatedUser, adminDecision };
    });
    tx();
  } catch (err) {
    if (err && err.status) throw err;
    throw errors.internal('Onboarding could not be completed. Please try again.');
  }

  const { newFamily, member, updatedUser } = result;
  return {
    ok: true,
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      familyId: updatedUser.family_id,
      profileMemberId: updatedUser.profile_member_id,
      onboardingCompleted: !!updatedUser.onboarding_completed,
    },
    family: {
      id: newFamily.id,
      name: newFamily.name,
      ownerUserId: userId,
      createdAt: newFamily.created_at,
    },
    member: {
      id: member.id,
      name: member.name,
      category: member.category,
      portionFactor: member.portionFactor,
    },
  };
}

function handleLogout(ctx, repos) {
  const hadSession = Boolean(ctx.sessionId);
  const userId = ctx.user && !ctx.user._synthetic ? ctx.user.id : null;
  const familyId = ctx.familyId || (ctx.user && ctx.user.family_id) || null;
  if (ctx.sessionId) {
    try {
      repos.auth.deleteSession(ctx.sessionId);
    } catch {
      /* ignore */
    }
  }
  clearSessionCookie(ctx.res, ctx.req);
  try {
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
          userId ? `user:${userId}` : 'anonymous',
          'POST',
          'session',
          ctx.sessionId || null,
          '/api/auth/logout',
          null,
          null,
          JSON.stringify({ event: 'logout', hadSession }).slice(0, 2000)
        );
    }
  } catch {
    /* audit must never break the response */
  }
  return { ok: true };
}

function handleLogoutAll(ctx, repos) {
  if (ctx.user && !ctx.user._synthetic) {
    repos.auth.deleteAllForUser(ctx.user.id);
  }
  clearSessionCookie(ctx.res, ctx.req);
  return { ok: true };
}

function handleListSessions(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  const sessions = repos.auth.listForUser(ctx.user.id);
  const current = ctx.sessionId;
  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      current: s.id === current,
    })),
  };
}

function handleDeleteSession(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  const id = ctx.params.id;
  if (!id) throw errors.badRequest('Session id required.');
  const list = repos.auth.listForUser(ctx.user.id);
  if (!list.some((s) => s.id === id)) {
    throw errors.notFound('Session not found for current user.');
  }
  repos.auth.deleteSession(id);
  if (id === ctx.sessionId) {
    clearSessionCookie(ctx.res, ctx.req);
  }
  return { ok: true };
}

// ============================================================
// Public auth config manifest + pilot bypass
// ============================================================

function handleAuthConfig() {
  return {
    pilotBypass: config.PILOT_BYPASS === true,
    google: !!config.GOOGLE_CLIENT_ID,
    magicLink: isEmailConfigured() || config.MAGIC_LINK_CONSOLE === true,
    passwordAuth: config.PASSWORD_AUTH_ENABLED === true,
    passwordRegister:
      config.PASSWORD_AUTH_ENABLED === true && config.PASSWORD_AUTH_OPEN_REGISTER === true,
    emailVerificationGraceSeconds: config.EMAIL_VERIFICATION_GRACE_SECONDS,
  };
}

const PILOT_EMAIL = 'pilot@local';
const PILOT_NAME = 'Pilot';

async function handlePilotLogin(ctx, repos) {
  if (!config.PILOT_BYPASS) {
    throw errors.notFound('Not found');
  }
  let user = repos.auth.findByEmail(PILOT_EMAIL);
  if (!user) {
    user = repos.auth.createUser({ email: PILOT_EMAIL, name: PILOT_NAME });
  }
  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);
  ctx.res.writeHead(302, { Location: '/' });
  ctx.res.end();
}

// ============================================================
// Pilot password gate
// ============================================================

function readPilotCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[config.PILOT_COOKIE_NAME] || null;
}

function setPilotCookie(res, req, value, maxAgeSeconds) {
  appendSetCookie(
    res,
    serializeCookie(config.PILOT_COOKIE_NAME, value, {
      maxAge: maxAgeSeconds,
      httpOnly: true,
      secure: isSecureRequest(req),
      sameSite: 'Lax',
      path: '/',
    })
  );
}

function handlePilotStatus(ctx) {
  const enabled = pilotPasswordService.isPilotEnabled();
  const cookie = readPilotCookie(ctx.req);
  const authenticated = enabled ? pilotPasswordService.isPilotCookieValid(cookie) : true;
  ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
  ctx.res.end(
    JSON.stringify({
      pilotMode: enabled,
      pilotAuthenticated: authenticated,
    })
  );
}

function handlePilotPassword(ctx, repos) {
  const ip = getClientIp(ctx.req);
  const userAgent = ctx.req.headers['user-agent'] || null;
  const password = ctx.body?.password;

  const result = pilotPasswordService.verifyPassword({
    ip,
    userAgent,
    password,
    repos,
  });

  if (result.ok) {
    setPilotCookie(ctx.res, ctx.req, result.cookieValue, result.cookieMaxAgeSeconds);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (result.code === 'rate_limited') {
    const retryAfter = Math.ceil((result.retryAfterMs || 0) / 1000);
    ctx.res.setHeader('Retry-After', String(retryAfter));
    ctx.res.writeHead(429, { 'Content-Type': 'application/json' });
    ctx.res.end(
      JSON.stringify({
        ok: false,
        code: 'rate_limited',
        retryAfterSeconds: retryAfter,
      })
    );
    return;
  }

  if (result.code === 'pilot_disabled') {
    ctx.res.writeHead(503, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ ok: false, code: 'pilot_disabled' }));
    return;
  }

  ctx.res.writeHead(401, { 'Content-Type': 'application/json' });
  ctx.res.end(
    JSON.stringify({
      ok: false,
      code: 'wrong_password',
      attemptsRemaining: result.attemptsRemaining,
    })
  );
}

// ============================================================
// Registration
// ============================================================

function registerAuthRoutes(router, { repos }) {
  router.get('/api/auth/config', () => handleAuthConfig());
  router.get('/api/auth/google/start', (ctx) => handleGoogleStart(ctx));
  router.get('/api/auth/google/callback', async (ctx) => handleGoogleCallback(ctx, repos));
  router.post('/api/auth/magic-link/start', async (ctx) => handleMagicLinkStart(ctx, repos));
  router.get('/api/auth/magic-link/verify', async (ctx) => handleMagicLinkVerify(ctx, repos));
  router.post('/api/auth/password/register', async (ctx) => handlePasswordRegister(ctx, repos));
  router.post('/api/auth/password/login', async (ctx) => handlePasswordLogin(ctx, repos));
  router.post('/api/auth/password/start-verification', async (ctx) =>
    handleStartVerification(ctx, repos)
  );
  router.post('/api/auth/password/set', async (ctx) => handleSetPassword(ctx, repos));
  router.get('/api/auth/pilot-login', async (ctx) => handlePilotLogin(ctx, repos));
  router.get('/api/auth/me', (ctx) => handleMe(ctx));
  router.post(
    '/api/auth/onboarding/complete',
    validateBody(schemas.onboardingCompleteBody),
    (ctx) => handleOnboardingComplete(ctx, repos)
  );
  router.post('/api/auth/logout', (ctx) => handleLogout(ctx, repos));
  router.post('/api/auth/logout-all', (ctx) => handleLogoutAll(ctx, repos));
  router.get('/api/auth/sessions', (ctx) => handleListSessions(ctx, repos));
  router.delete('/api/auth/sessions/:id', (ctx) => handleDeleteSession(ctx, repos));
  router.get('/api/pilot/status', (ctx) => handlePilotStatus(ctx));
  router.post('/api/auth/pilot-password', (ctx) => handlePilotPassword(ctx, repos));
  router.get('/api/admin/me', (ctx) => handleAdminMe(ctx));
  router.get('/api/admin/setup', (ctx) => handleAdminSetup(ctx, repos));
}

module.exports = {
  registerAuthRoutes,
  // exported for tests
  signPayload,
  verifyPayload,
  OAUTH_STATE_COOKIE,
};
