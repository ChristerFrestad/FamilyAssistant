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
  if (process.env.HTTPS_TERMINATED === 'true') return true;
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

function setSessionCookie(res, req, sessionId) {
  const cookie = serializeCookie(config.SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: isSecureRequest(req) || config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_DAYS * 86400,
  });
  appendSetCookie(res, cookie);
}

function clearSessionCookie(res, req) {
  clearCookie(res, config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureRequest(req) || config.NODE_ENV === 'production',
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
