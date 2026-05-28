'use strict';

// Pilot-mode pre-auth password gate service.
//
// Background: Sprint 7 / pre-pilot. The 13-17 May 2026 pilot deploys
// behind app.familyassistant.com but is reachable from the open
// internet via Cloudflare Tunnel. To keep random visitors out before
// they ever see the magic-link login, every request goes through this
// gate first.
//
// Flow:
//   1. Operator sets PILOT_MODE=true and PILOT_PASSWORD=xyz in Portainer.
//   2. Visitor sees the React PilotPasswordGate component.
//   3. Visitor POSTs the password to /api/auth/pilot-password.
//   4. Server checks rate-limit (5/IP/10min), then constant-time-compares
//      the password against PILOT_PASSWORD, records the attempt, and on
//      success sets the pilot cookie (30 days, HttpOnly, Secure, Lax).
//   5. Subsequent requests carry the cookie; middleware accepts them.
//
// All logic lives here so the routes layer is dumb-thin and the
// middleware can call isPilotAuthenticated() without pulling in policy.

const crypto = require('crypto');
const { config } = require('../config');

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Per-IP attempt counter (in-memory; resets on restart, which is OK for
// pilot scope — the audit table is the persistent record).
const ipState = new Map(); // ip -> { count, windowStart }

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  const lengthsMatch = bufA.length === bufB.length;
  const padded = lengthsMatch ? bufB : Buffer.alloc(bufA.length);
  if (!lengthsMatch) padded.fill(0);
  const equal = crypto.timingSafeEqual(bufA, padded);
  return lengthsMatch && equal;
}

// Generate the cookie value. Constant per-process so revoking access
// only requires PILOT_PASSWORD rotation. The HMAC binds the cookie
// value to the current password so changing PILOT_PASSWORD invalidates
// every previously-issued cookie automatically.
function pilotCookieValue() {
  if (!config.PILOT_PASSWORD) return null;
  return crypto.createHmac('sha256', config.PILOT_PASSWORD).update('pilot-gate-v1').digest('hex');
}

function isPilotEnabled() {
  return (
    config.PILOT_MODE === true &&
    typeof config.PILOT_PASSWORD === 'string' &&
    config.PILOT_PASSWORD.length > 0
  );
}

function isPilotCookieValid(cookieValue) {
  if (!cookieValue) return false;
  const expected = pilotCookieValue();
  if (!expected) return false;
  return constantTimeEquals(cookieValue, expected);
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipState.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipState.set(ip, { count: 1, windowStart: now });
    return { allowed: true, attemptsRemaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterMs = entry.windowStart + RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, attemptsRemaining: 0, retryAfterMs };
  }
  entry.count += 1;
  return { allowed: true, attemptsRemaining: RATE_LIMIT_MAX - entry.count };
}

function resetRateLimitForTests() {
  ipState.clear();
}

function recordAttempt(repos, ip, userAgent, success) {
  if (!repos?.pilotPasswordAttempts) return;
  try {
    repos.pilotPasswordAttempts.insert({
      ip_address: ip,
      user_agent: userAgent || null,
      success: success ? 1 : 0,
    });
  } catch {
    // Audit-log insertion failures must not block the user response.
  }
}

// Verify the submitted password and return a structured result. Caller
// decides whether to set the cookie and what to put in the HTTP body.
function verifyPassword({ ip, userAgent, password, repos }) {
  if (!isPilotEnabled()) {
    return { ok: false, code: 'pilot_disabled', status: 503 };
  }

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    recordAttempt(repos, ip, userAgent, false);
    return {
      ok: false,
      code: 'rate_limited',
      status: 429,
      retryAfterMs: rate.retryAfterMs,
    };
  }

  if (typeof password !== 'string' || password.length === 0) {
    recordAttempt(repos, ip, userAgent, false);
    return {
      ok: false,
      code: 'wrong_password',
      status: 401,
      attemptsRemaining: rate.attemptsRemaining,
    };
  }

  const matches = constantTimeEquals(password, config.PILOT_PASSWORD);
  recordAttempt(repos, ip, userAgent, matches);
  if (!matches) {
    return {
      ok: false,
      code: 'wrong_password',
      status: 401,
      attemptsRemaining: rate.attemptsRemaining,
    };
  }

  return {
    ok: true,
    cookieValue: pilotCookieValue(),
    cookieMaxAgeSeconds: config.PILOT_COOKIE_TTL_DAYS * 24 * 60 * 60,
  };
}

module.exports = {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  isPilotEnabled,
  isPilotCookieValid,
  pilotCookieValue,
  verifyPassword,
  resetRateLimitForTests,
};
