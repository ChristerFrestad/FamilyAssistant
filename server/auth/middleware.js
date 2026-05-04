// Authentication middleware used by the HTTP server.
//
// Resolution order (first match wins):
//   1. PUBLIC_PATHS (health/ready/metrics) and auth routes — pass through.
//   2. Bearer token matching config.AUTH_TOKEN — populates ctx with a
//      synthetic LOCAL_USER tied to the legacy family_id=1. This keeps the
//      single-tenant RPi deployment working unchanged.
//   3. Session cookie — looks up sessions + users in the repo, attaches the
//      real user record and touches last_seen timestamps.
//   4. No AUTH_TOKEN configured and no cookie — legacy dev behaviour: treat
//      the request as the local default family. Used when the app is run
//      behind Tailscale/LAN without any auth configured.
//   5. Otherwise throw 401.
//
// requireRole(role) is a helper middleware that expects authenticate() has
// already populated ctx.user. It enforces role hierarchy owner > adult > child.

const crypto = require('crypto');
const { config } = require('../config');
const { errors } = require('../http/errors');
const { parseCookies } = require('./cookies');

// Paths that never require authentication and never attempt to resolve a user.
// Includes a couple of static pages so unauthenticated visitors can read the
// privacy policy / terms before signing up.
const PUBLIC_PATHS = new Set([
  '/health',
  '/ready',
  '/metrics',
  '/privacy.html',
  '/privacy-en.html',
  '/terms.html',
  '/login.html',
  '/invite.html',
  // Phase 22 — setup wizard (zero-config Docker deploy). Only served
  // meaningfully when BOOTSTRAP_MODE is active; the auth middleware
  // itself is also skipped by server.js in that mode.
  '/setup.html',
]);

// Paths that never require authentication but DO try to resolve the user if a
// cookie/token is present. Handlers here can behave differently for
// logged-in vs anonymous visitors (e.g. /api/auth/me returns the current user
// or a not-authenticated marker).
const SOFT_AUTH_PATH_PREFIXES = [
  '/api/auth/google/',
  '/api/auth/magic-link/',
  '/api/invitations/', // peek before login is allowed
];

const SOFT_AUTH_PATHS_EXACT = new Set(['/api/auth/me', '/api/auth/logout']);

const LOCAL_USER = Object.freeze({
  id: 0,
  email: null,
  name: 'Local',
  role: 'owner',
  family_id: 1,
  profile_member_id: null,
  _synthetic: true,
});

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  const lengthsMatch = bufA.length === bufB.length;
  const padded = lengthsMatch ? bufB : Buffer.alloc(bufA.length);
  if (!lengthsMatch) padded.fill(0);
  const equal = crypto.timingSafeEqual(bufA, padded);
  return lengthsMatch && equal;
}

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

function isSoftAuthPath(pathname) {
  if (SOFT_AUTH_PATHS_EXACT.has(pathname)) return true;
  for (const prefix of SOFT_AUTH_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function attachLocalUser(ctx) {
  ctx.user = LOCAL_USER;
  ctx.familyId = LOCAL_USER.family_id;
}

function attachSessionUser(ctx, user, sessionId) {
  ctx.user = user;
  ctx.familyId = user.family_id || null;
  ctx.sessionId = sessionId;
}

// ============================================================
// authenticate: main middleware called for every request
// ============================================================

function createAuthenticate(repos) {
  return function authenticate(ctx) {
    if (isPublicPath(ctx.pathname)) return;

    const soft = isSoftAuthPath(ctx.pathname);
    const header = ctx.req.headers.authorization || '';
    const bearerMatch = /^Bearer\s+(.+)$/.exec(header);

    // Bearer token fallback (RPi service mode)
    if (bearerMatch) {
      if (!config.AUTH_TOKEN) {
        if (soft) return;
        throw errors.unauthorized('Bearer auth not configured on this server.');
      }
      if (!constantTimeEquals(bearerMatch[1], config.AUTH_TOKEN)) {
        if (soft) return;
        throw errors.unauthorized('Invalid token.');
      }
      attachLocalUser(ctx);
      return;
    }

    // Session cookie
    const cookies = parseCookies(ctx.req.headers.cookie);
    const sid = cookies[config.SESSION_COOKIE_NAME];
    if (sid && repos?.auth) {
      const session = repos.auth.getValidSession(sid);
      if (session) {
        const user = repos.auth.findById(session.user_id);
        if (user) {
          attachSessionUser(ctx, user, session.id);
          // Best-effort last-seen updates; ignore failures.
          try {
            repos.auth.touchSession(session.id);
            repos.auth.touchLastSeen(user.id);
          } catch {
            /* ignore */
          }
          return;
        }
      }
    }

    // Legacy dev fallback: no AUTH_TOKEN configured and no session → allow as
    // local user. This preserves the existing unauthenticated local dev flow.
    if (!config.AUTH_TOKEN) {
      attachLocalUser(ctx);
      return;
    }

    if (soft) return; // anonymous visit to /api/auth/me etc.
    throw errors.unauthorized('Authentication required.');
  };
}

// ============================================================
// requireRole — role hierarchy owner > adult > child
// ============================================================

const ROLE_RANK = { child: 1, adult: 2, owner: 3 };

function hasRole(user, minRole) {
  if (!user) return false;
  const userRank = ROLE_RANK[user.role] || 0;
  const required = ROLE_RANK[minRole] || 0;
  return userRank >= required;
}

function requireRole(minRole) {
  return function requireRoleMiddleware(ctx) {
    if (!ctx.user) throw errors.unauthorized('Authentication required.');
    if (!hasRole(ctx.user, minRole)) {
      throw errors.forbidden(`Requires role '${minRole}' or higher.`);
    }
  };
}

function requireFamily(ctx) {
  if (!ctx.user) throw errors.unauthorized('Authentication required.');
  if (!ctx.familyId) {
    throw errors.forbidden('User is not currently in a family.');
  }
}

module.exports = {
  createAuthenticate,
  requireRole,
  requireFamily,
  hasRole,
  isPublicPath,
  isSoftAuthPath,
  PUBLIC_PATHS,
  SOFT_AUTH_PATH_PREFIXES,
  SOFT_AUTH_PATHS_EXACT,
  LOCAL_USER,
};
