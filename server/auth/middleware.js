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
// Sprint 8 (2026-05-05): trimmed to the post-v1-cleanup surface. Legal pages
// (privacy + terms) are still served from public/ as static HTML; the sw.js
// tombstone is reachable so cached v1 service workers can fetch it and
// unregister themselves. /login.html and /invite.html stay gone (v2 handles
// those under /v2/*). /setup.html was restored for the Portainer zero-config
// bootstrap wizard — it is only useful while BOOTSTRAP_MODE is active, but
// must remain reachable without AUTH_TOKEN so the first-run flow works.
const PUBLIC_PATHS = new Set([
  '/health',
  '/ready',
  '/metrics',
  '/privacy.html',
  '/privacy-en.html',
  '/terms.html',
  '/terms-en.html',
  '/sw.js',
  '/setup.html',
]);

// Sprint 7 / pre-pilot — paths that bypass the pilot-password gate.
// These are the paths a visitor needs to reach BEFORE entering the
// pilot password (the gate page itself, the status check that tells
// the React app whether the gate is needed, the password submission
// endpoint, and the public legal pages). All other paths require a
// valid pilot cookie when PILOT_MODE=true.
const PILOT_GATE_BYPASS_PATHS = new Set([
  '/api/pilot/status',
  '/api/auth/pilot-password',
  '/health',
  '/ready',
  '/privacy.html',
  '/privacy-en.html',
  '/terms.html',
  '/terms-en.html',
  '/setup.html',
]);

// Path prefixes that bypass the pilot-password gate. Added 2026-05-06
// after a real pilot user was 403'd when clicking a magic-link in their
// email — the link target /api/auth/magic-link/verify was not in the
// exact-match bypass set, so the gate refused before the verify-handler
// could create a session.
//
// The security argument for bypassing these: each path validates its
// own token (HMAC-signed magic-link, OAuth state, invitation token).
// The pilot-gate is designed to keep anonymous visitors out, not to
// gate authenticated flows whose own tokens are the auth signal.
//
// Adding a new auth route under one of these prefixes? It will
// automatically bypass — but it MUST validate its own token in the
// handler. Do not add an admin-only route under /api/invitations/
// without verifying tokens first.
const PILOT_GATE_BYPASS_PREFIXES = [
  '/api/auth/magic-link/', // start + verify
  '/api/auth/google/', // OAuth start + callback
  '/api/invitations/', // peek + accept
];

// Paths that never require authentication but DO try to resolve the user if a
// cookie/token is present. Handlers here can behave differently for
// logged-in vs anonymous visitors (e.g. /api/auth/me returns the current user
// or a not-authenticated marker).
const SOFT_AUTH_PATH_PREFIXES = [
  '/api/auth/google/',
  '/api/auth/magic-link/',
  '/api/auth/password/', // register + login + start-verification (set requires session)
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
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Entire v2 SPA surface is public at the HTTP layer — including client
  // routes like /v2/login, /v2/invite/:token, /v2/dashboard. Docker deploys
  // always have AUTH_TOKEN (auto-created); if only /v2/ and /v2/assets/*
  // were public, deep-links returned JSON 401 and the React app never
  // loaded. Frontend Guards (PilotGuard, AuthGuard, OnboardingGuard)
  // enforce auth after the bundle mounts. API stays under /api/* only.
  if (pathname === '/v2' || pathname.startsWith('/v2/')) return true;
  // SPA bootstrap endpoints (brand + auth manifest) — called before login.
  if (pathname === '/api/config') return true;
  if (pathname === '/api/auth/config') return true;
  if (pathname === '/favicon.svg' || pathname === '/favicon.ico') return true;
  if (pathname === '/manifest.json') return true;
  // Pilot-gate bootstrap endpoints.
  if (pathname === '/api/pilot/status') return true;
  if (pathname === '/api/auth/pilot-password') return true;
  return false;
}

function isPilotGateBypassPath(pathname) {
  if (PILOT_GATE_BYPASS_PATHS.has(pathname)) return true;
  // Full v2 SPA must render so PilotPasswordGate / login can show.
  if (pathname === '/v2' || pathname.startsWith('/v2/')) return true;
  if (pathname === '/api/config' || pathname === '/api/auth/config') return true;
  if (pathname === '/favicon.svg' || pathname === '/favicon.ico') return true;
  if (pathname === '/manifest.json') return true;
  for (const prefix of PILOT_GATE_BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

// Returns true when the visitor is past the pilot-gate bar. Two paths:
//   1. Valid `fa_pilot` cookie (entered the pilot password)
//   2. Valid `fa_session` cookie (already authenticated via magic-link,
//      OAuth, or invitation accept) — a real session implies the
//      visitor is no longer anonymous, which is what the pilot-gate is
//      designed to enforce. Without this, every authenticated user
//      would get 403'd on every /api/* call until they also entered
//      the pilot password — defeating the soft-launch UX.
//
// `repos` is optional for backward compatibility; without it the
// session-cookie path is skipped and behavior matches the pre-fix
// pilot-cookie-only check.
function isPilotAuthenticated(req, repos) {
  const pilotPasswordService = require('../services/pilot-password.service');
  if (!pilotPasswordService.isPilotEnabled()) return true;
  const cookies = parseCookies(req.headers.cookie);
  if (pilotPasswordService.isPilotCookieValid(cookies[config.PILOT_COOKIE_NAME])) {
    return true;
  }
  const sid = cookies[config.SESSION_COOKIE_NAME];
  if (sid && repos?.auth?.getValidSession) {
    const session = repos.auth.getValidSession(sid);
    if (session) return true;
  }
  return false;
}

function enforcePilotGate(ctx, repos) {
  const pilotPasswordService = require('../services/pilot-password.service');
  if (!pilotPasswordService.isPilotEnabled()) return;
  if (isPilotGateBypassPath(ctx.pathname)) return;
  if (isPilotAuthenticated(ctx.req, repos)) return;
  // For API calls return JSON 403 so the React client can show the
  // gate without trying to parse an HTML response.
  if (ctx.pathname.startsWith('/api/')) {
    throw errors.forbidden('Pilot password required.');
  }
  // For HTML / asset paths outside /v2/ (legacy SPA pages, etc.) the
  // simplest behaviour is to redirect into the v2 app where the gate
  // component renders. The gate runs before any React route and
  // covers the full visible surface.
  ctx.res.writeHead(302, { Location: '/v2/' });
  ctx.res.end();
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
    // Pilot gate runs FIRST. If PILOT_MODE is on and the visitor has
    // not entered the password, this short-circuits the response so
    // the rest of the auth chain never sees the request. `repos` is
    // forwarded so the gate can honor an existing session-cookie as
    // pilot-auth (see isPilotAuthenticated).
    enforcePilotGate(ctx, repos);
    if (ctx.res.writableEnded) return;

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
  isPilotGateBypassPath,
  isPilotAuthenticated,
  enforcePilotGate,
  PUBLIC_PATHS,
  PILOT_GATE_BYPASS_PATHS,
  PILOT_GATE_BYPASS_PREFIXES,
  SOFT_AUTH_PATH_PREFIXES,
  SOFT_AUTH_PATHS_EXACT,
  LOCAL_USER,
};
