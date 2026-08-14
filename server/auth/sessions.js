// Session lifecycle helpers used by the OAuth callback and logout routes.
//
// These are thin wrappers around repos.auth that handle:
//   - random session ID generation
//   - Set-Cookie + Clear-Cookie formatting with prod-safe flags
//   - consistent TTL resolution from config

const crypto = require('crypto');
const { config } = require('../config');
const { serializeCookie, appendSetCookie, clearCookie } = require('./cookies');
const { sha256 } = require('./crypto');

function isSecureRequest(req) {
  // Prefer the Zod-validated config value. Also honour a live process.env
  // mutation so unit tests (and rare late-binding operator overrides) continue
  // to work without requiring a full process restart.
  // Do NOT default HTTPS_TERMINATED=true in the Docker image: LAN
  // http://<ip>:7777 then gets a Secure cookie the browser silently drops,
  // and POST /api/auth/onboarding/complete 401s after a successful register.
  if (config.HTTPS_TERMINATED || process.env.HTTPS_TERMINATED === 'true') return true;
  if (req.headers['x-forwarded-proto'] === 'https') return true;
  return req.socket && req.socket.encrypted === true;
}

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSessionForUser(repos, { userId, req }) {
  const id = newSessionId();
  const userAgent = (req?.headers?.['user-agent'] || '').slice(0, 255) || null;
  const ip = req?.socket?.remoteAddress || null;
  const ipHash = ip ? sha256(ip).slice(0, 32) : null;
  repos.auth.createSession({
    id,
    userId,
    ttlDays: config.SESSION_TTL_DAYS,
    userAgent,
    ipHash,
  });
  return id;
}

// Set-Cookie helpers below intentionally use `isSecureRequest(req)` only,
// without an extra `|| config.NODE_ENV === 'production'` short-circuit.
// The override looked defensive but was actively harmful: it forced the
// `Secure` attribute on cookies in any production deploy, which made
// browsers silently drop the cookie when the connection was plain HTTP
// (LAN pilot, dev-staging without TLS, etc.). The 2026-05-04 cookie-flag
// regression locked Christer's first pilot deploy out of the magic-link
// flow because of this exact bug. `isSecureRequest()` already handles
// the three real cases (`HTTPS_TERMINATED=true`, `x-forwarded-proto`
// header, direct `socket.encrypted`) — trust it.
function setSessionCookie(res, req, sessionId) {
  const cookie = serializeCookie(config.SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_DAYS * 86400,
  });
  appendSetCookie(res, cookie);
}

function clearSessionCookie(res, req) {
  clearCookie(res, config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
  });
}

module.exports = {
  newSessionId,
  createSessionForUser,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
};
