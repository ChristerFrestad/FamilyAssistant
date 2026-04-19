// HTTP endpoints for authentication flows.
//
// Registered from server/routes.js via registerAuthRoutes(router, { repos }).
// Every path under /api/auth/* is treated as public by the authenticate
// middleware (see auth/middleware.js), so these handlers never see ctx.user
// populated — they create it.

const crypto = require('crypto');
const { config } = require('../config');
const { errors } = require('../http/errors');
const {
  generatePkcePair,
  buildAuthorizationUrl,
  exchangeCodeForIdToken,
  verifyIdToken,
  redirectUriFor,
} = require('./google');
const { createSessionForUser, setSessionCookie, clearSessionCookie } = require('./sessions');
const { parseCookies, serializeCookie, appendSetCookie, clearCookie } = require('./cookies');
const { handleMagicLinkStart, handleMagicLinkVerify } = require('./magic-link');
const { isEmailConfigured } = require('../services/email.service');

const OAUTH_STATE_COOKIE = 'fa_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// ============================================================
// Signed state-cookie helpers
// ============================================================

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto
    .createHmac('sha256', config.SESSION_SECRET || 'dev-secret')
    .update(body)
    .digest('base64url');
  return `${body}.${mac}`;
}

function verifyPayload(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const [body, mac] = signed.split('.');
  const expected = crypto
    .createHmac('sha256', config.SESSION_SECRET || 'dev-secret')
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

  // Redirect to app root. If user has no family yet, the frontend will route
  // them to onboarding (or to the invitation-pending peek page).
  ctx.res.writeHead(302, { Location: '/' });
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
      synthetic: !!ctx.user._synthetic,
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
  router.post('/api/auth/logout', (ctx) => handleLogout(ctx, repos));
  router.post('/api/auth/logout-all', (ctx) => handleLogoutAll(ctx, repos));
  router.get('/api/auth/sessions', (ctx) => handleListSessions(ctx, repos));
  router.delete('/api/auth/sessions/:id', (ctx) => handleDeleteSession(ctx, repos));
}

module.exports = {
  registerAuthRoutes,
  // exported for tests
  signPayload,
  verifyPayload,
  OAUTH_STATE_COOKIE,
};
