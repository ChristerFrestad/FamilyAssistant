// Phase 17 — optional Sentry integration.
//
// Design goals:
//   - Zero runtime cost when SENTRY_DSN is unset (the RPi5 self-host path).
//     In that case we never even try to require('@sentry/node').
//   - @sentry/node is an optionalDependency: production/cloud deployments
//     that want observability run `npm install @sentry/node`, dev/RPi can
//     skip it.
//   - Aggressive PII scrubbing in beforeSend:
//       * request body is always dropped
//       * user.email / user.username is replaced with '[redacted]'
//       * only a SHA-256-truncated family_id lands in user.id
//     This matches the privacy policy: no emails or names ever leave the
//     server except in the scrubbed stack trace itself.
//   - Graceful degradation: every exported function is safe to call even
//     when Sentry never initialized (no DSN, or @sentry/node missing).
//
// All init/capture logic is guarded by `state.enabled` so a missing module
// never crashes the parent app.

const crypto = require('crypto');

const state = {
  enabled: false,
  Sentry: null,
  loadError: null,
};

function hashFamilyId(familyId) {
  if (familyId === null || familyId === undefined) return null;
  return crypto.createHash('sha256').update(String(familyId)).digest('hex').slice(0, 16);
}

function beforeSend(event) {
  // Wholesale-drop request bodies — never ship pantry content, AI chat
  // messages, feedback text or anything the user typed.
  if (event.request) {
    if (event.request.data !== undefined) delete event.request.data;
    if (event.request.cookies) delete event.request.cookies;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        const lower = key.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie') {
          event.request.headers[key] = '[redacted]';
        }
      }
    }
  }
  if (event.user) {
    if (event.user.email) event.user.email = '[redacted]';
    if (event.user.username) event.user.username = '[redacted]';
    if (event.user.ip_address) event.user.ip_address = '[redacted]';
  }
  // Extra-field scrub: strip anything that looks like an email or bearer.
  if (event.extra) {
    for (const k of Object.keys(event.extra)) {
      const v = event.extra[k];
      if (typeof v === 'string') {
        if (/^Bearer\s+/i.test(v) || /@[\w.-]+/.test(v)) {
          event.extra[k] = '[redacted]';
        }
      }
    }
  }
  return event;
}

/**
 * Initialize Sentry if SENTRY_DSN is configured AND @sentry/node is
 * installed. Safe to call repeatedly; only the first call does work.
 *
 * Returns { enabled, reason } so callers can log the outcome.
 */
function initSentry(config, logger) {
  if (state.enabled) return { enabled: true, reason: 'already-initialized' };
  if (!config || !config.SENTRY_DSN) {
    return { enabled: false, reason: 'no-dsn' };
  }
  let Sentry;
  try {
    Sentry = require('@sentry/node');
  } catch (err) {
    state.loadError = err;
    if (logger?.warn) {
      logger.warn(
        { err: err.message },
        '@sentry/node not installed; SENTRY_DSN ignored. Run `npm install @sentry/node` in your deployment to enable observability.'
      );
    }
    return { enabled: false, reason: 'module-missing' };
  }
  try {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.SENTRY_ENVIRONMENT || config.NODE_ENV,
      release: config.SENTRY_RELEASE,
      tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
      beforeSend,
      // Avoid auto-capturing unhandled promise rejections twice — the
      // parent app already logs them through pino.
      integrations: (defaults) => defaults.filter((i) => i.name !== 'OnUnhandledRejection'),
    });
    state.Sentry = Sentry;
    state.enabled = true;
    if (logger?.info) {
      logger.info({ env: config.SENTRY_ENVIRONMENT || config.NODE_ENV }, 'Sentry initialized');
    }
    return { enabled: true, reason: 'ok' };
  } catch (err) {
    state.loadError = err;
    if (logger?.warn) logger.warn({ err: err.message }, 'Sentry.init failed');
    return { enabled: false, reason: 'init-failed' };
  }
}

/**
 * Capture an error with optional request/user context. Safe no-op when
 * Sentry is disabled.
 */
function captureException(err, ctx) {
  if (!state.enabled) return null;
  const Sentry = state.Sentry;
  try {
    return Sentry.withScope((scope) => {
      if (ctx?.user) {
        const hashed = hashFamilyId(ctx.user.family_id);
        scope.setUser({
          id: hashed,
          // email/username intentionally omitted; beforeSend redacts
          // anything that sneaks in.
          role: ctx.user.role,
        });
      }
      if (ctx?.requestId) scope.setTag('request_id', ctx.requestId);
      if (ctx?.sessionCorr) scope.setTag('session_corr', ctx.sessionCorr);
      if (ctx?.req?.method && ctx?.pathname) {
        scope.setTag('route', `${ctx.req.method} ${ctx.pathname}`);
      }
      return Sentry.captureException(err);
    });
  } catch {
    return null;
  }
}

/**
 * Close Sentry flushing pending events. Used during graceful shutdown.
 * Returns a Promise resolved within `timeoutMs`.
 */
async function closeSentry(timeoutMs = 2000) {
  if (!state.enabled) return true;
  try {
    return await state.Sentry.close(timeoutMs);
  } catch {
    return false;
  }
}

function isEnabled() {
  return state.enabled;
}

// Test-only: wipe module-level state between integration tests.
function resetForTests() {
  state.enabled = false;
  state.Sentry = null;
  state.loadError = null;
}

module.exports = {
  initSentry,
  captureException,
  closeSentry,
  isEnabled,
  beforeSend,
  hashFamilyId,
  resetForTests,
};
