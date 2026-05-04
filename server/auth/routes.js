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
const { createSessionForUser, setSessionCookie, clearSessionCookie } = require('./sessions');
const { parseCookies, serializeCookie, appendSetCookie, clearCookie } = require('./cookies');
const { seedFamilyDefaults } = require('../services/seed.service');
const {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  redirectTargetForUser,
} = require('./magic-link');
const { isEmailConfigured } = require('../services/email.service');
const pilotPasswordService = require('../services/pilot-password.service');
const { getClientIp } = require('../http/security');
const adminBootstrap = require('../services/admin-bootstrap.service');

const OAUTH_STATE_COOKIE = 'fa_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// ============================================================
// Signed state-cookie helpers
// ============================================================

// Multi-tenant activation (uke 2 B1, C3): the previous 'dev-secret'
// fallback silently allowed OAuth state + magic-link tokens to be
// signed with a publicly known string if SESSION_SECRET happened to
// be missing. C1 eliminated the "missing" case for bootstrapped
// deploys (wizard + self-heal), and config-validation refuses to
// start in production when an auth feature is enabled without the
// secret. This helper closes the last loophole: if code somehow
// reaches the signer without a real secret (e.g. in an isolated
// test that spins up the module), throw loudly instead of signing
// with a guessable value.
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
      secure: config.NODE_ENV === 'production',
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

  // Upsert user
  let user = repos.auth.findByGoogleSub(claims.sub) || repos.auth.findByEmail(claims.email);
  if (!user) {
    user = repos.auth.createUser({
      email: claims.email,
      googleSub: claims.sub,
      name: claims.name || claims.email,
      avatarUrl: claims.picture || null,
    });
  } else {
    user = repos.auth.updateProfile(user.id, {
      name: claims.name || user.name,
      avatarUrl: claims.picture || user.avatar_url,
      googleSub: claims.sub,
    });
  }

  const sessionId = createSessionForUser(repos, { userId: user.id, req: ctx.req });
  setSessionCookie(ctx.res, ctx.req, sessionId);
  repos.auth.touchLastSeen(user.id);

  // Onboarding-aware redirect. Same logic as magic-link verify so the
  // post-login behaviour matches across providers — Google OAuth users
  // also have to complete the onboarding flow (family setup + profile)
  // before they reach the main app surface.
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
      // Coerce to boolean — SQLite stores INTEGER 0/1 (migration 021).
      // Frontend AuthContext checks this flag to decide whether the
      // user belongs in the onboarding flow or in the main app.
      onboardingCompleted: !!ctx.user.onboarding_completed,
      synthetic: !!ctx.user._synthetic,
      isAdmin: !!ctx.user.is_admin,
    },
  };
}

// ============================================================
// Admin endpoints (skeleton — full UI lands post-pilot)
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

// POST /api/auth/onboarding/complete
//
// Atomic completion of the two-step onboarding wizard. The frontend
// collects family-name (Step 1) and personal profile (Step 2) into
// local OnboardingContext state and calls this endpoint exactly once
// when the user clicks "Done". Everything happens in a single
// transaction so a tab-close between Step 1 and Step 2 leaves no
// trace in the database. Replaces the old "flag-flip only" version
// of this endpoint and the now-deleted POST /api/onboarding/create-
// family from Sprint 3.
//
// Body shape (validated by validateBody(schemas.onboardingCompleteBody)):
//   {
//     family: { name: string },
//     user:   { name: string, category: 'adult'|'teen'|'child',
//               portionFactor: number 0.1..2.0 }
//   }
//
// Authentication: required. Synthetic / pilot-bypass users are
// rejected — they have no real session and any state mutation would
// be lost on the next request. Returns 409 if the caller is already
// in a family (e.g. they accepted an invitation, or a previous
// onboarding succeeded and they navigated back to the wizard URL).
function handleOnboardingComplete(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  if (ctx.user.family_id) {
    throw errors.conflict('User is already in a family.');
  }

  const userId = ctx.user.id;
  const { family, user } = ctx.body;
  // Trim happened in Zod; the schema enforces min(1) post-trim, so
  // these are guaranteed non-empty here.
  const familyName = family.name;
  const userName = user.name;
  const category = user.category;
  const portionFactor = user.portionFactor;

  let result;
  try {
    const tx = repos._db.transaction(() => {
      // 1. Create family. createFamily() seeds owner_user_id in a
      //    second statement; both run inside this outer transaction.
      const newFamily = repos.family.createFamily(familyName, userId);

      // 2. Add the owner-user as the first profile-member row so
      //    portion_factor + category have a permanent home and
      //    Sprint 4's per-member edit screen has a row to edit.
      const member = repos.family.addMember(newFamily.id, {
        name: userName,
        category,
        portionFactor,
      });

      // 3. Update users: link to family as owner, store profile
      //    fields, flip onboarding_completed=1. setFamily() handles
      //    family_id + role + profile_member_id; the remaining
      //    fields go through a single inline UPDATE so the user
      //    state is consistent in one statement instead of three.
      repos.auth.setFamily(userId, newFamily.id, 'owner', member.id);
      repos._db
        .prepare(
          `UPDATE users
              SET name = ?, portion_factor = ?, onboarding_completed = 1
            WHERE id = ?`
        )
        .run(userName, portionFactor, userId);

      // 4. Seed per-family defaults — recipes, chores, consumables,
      //    family_profile parent row, default meal-plan and
      //    chore-schedules for the current ISO week. Without this
      //    step a freshly onboarded family is empty (no recipes to
      //    pick, no chores in the dashboard) — see the multi-tenant
      //    audit (docs/analyses/2026-05-02-multi-tenant-audit.md C1).
      //    seedFamilyDefaults wraps its own runWithFamily; it is
      //    idempotent against a partial state.
      const seedSummary = seedFamilyDefaults(repos, newFamily.id);

      // 5. Audit-log entry inside the same transaction. We bypass
      //    repos.auditLog.record() because that helper reads
      //    family_id from AsyncLocalStorage (which is still null at
      //    this point — the request is mid-onboarding and has no
      //    family-context middleware applied). Direct INSERT lets us
      //    pin the audit-row to the just-created family explicitly.
      //    The audit_log.action CHECK constraint allows only HTTP
      //    methods (DELETE/PUT/PATCH/POST), so we record 'POST' and
      //    keep the semantic event-type ('onboarding_completed') in
      //    the metadata blob so analytics can still group on it.
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

      // 6. Admin bootstrap. If APP_ADMIN_EMAIL matches the onboarding
      //    email (or the env-var is unset and no admin exists yet),
      //    flip is_admin=1 and persist the app_setup row. Idempotent:
      //    once the bootstrap row exists this is a no-op for every
      //    subsequent onboarding.
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
    // SQLite rolls back automatically on throw inside db.transaction().
    // Re-raise as a generic 500 so the client sees a clean RFC-7807
    // payload rather than a leaked SQL constraint message.
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
  if (ctx.sessionId) {
    try {
      repos.auth.deleteSession(ctx.sessionId);
    } catch {
      /* ignore */
    }
  }
  clearSessionCookie(ctx.res, ctx.req);
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

// GET /api/auth/config — minimal public manifest so login.html can show
// provider-specific buttons only when that provider is enabled.
function handleAuthConfig() {
  return {
    pilotBypass: config.PILOT_BYPASS === true,
    google: !!config.GOOGLE_CLIENT_ID,
    magicLink: isEmailConfigured() || config.MAGIC_LINK_CONSOLE === true,
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
// Pilot password gate (Sprint 7 / pre-pilot)
// ============================================================

function readPilotCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[config.PILOT_COOKIE_NAME] || null;
}

function setPilotCookie(res, value, maxAgeSeconds) {
  appendSetCookie(
    res,
    serializeCookie(config.PILOT_COOKIE_NAME, value, {
      maxAge: maxAgeSeconds,
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
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
    setPilotCookie(ctx.res, result.cookieValue, result.cookieMaxAgeSeconds);
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
