// Circuit breaker (M2.3)
//
// Implements the classic 3-state pattern:
//   CLOSED   — calls go through, failures are counted
//   OPEN     — calls are rejected fast without hitting the network, until
//              cooldown expires
//   HALF_OPEN — first call after cooldown "probes" the backend:
//               success → CLOSED, failure → OPEN with a new cooldown
//
// Why:
//   - Protects the RPi5 from hanging on every request when Kassal/Ollama is
//     down
//   - Gives users immediate feedback (503/cached) instead of a 30s timeout
//   - Reduces retry pressure on already struggling backends
//
// Usage:
//   const cb = createBreaker({ name: 'kassal', failureThreshold: 5, cooldownMs: 60_000 });
//   const result = await cb.execute(() => fetch('https://kassal.app/...'));
//   // Throws CircuitOpenError if the breaker is open.
//
// Zero dependencies. Shared-instance helper for known backends is at the bottom.

const STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

class CircuitOpenError extends Error {
  constructor(name, retryAfterMs) {
    super(`Circuit for '${name}' is open, retry in ${Math.round(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.breakerName = name;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Create a named breaker instance.
 * @param {Object} opts
 * @param {string} opts.name — for logging and error messages
 * @param {number} [opts.failureThreshold=5] — consecutive failures before OPEN
 * @param {number} [opts.cooldownMs=60000] — time in OPEN before HALF_OPEN probe
 * @param {number} [opts.successThreshold=1] — HALF_OPEN probes that must
 *     succeed for CLOSED
 * @param {function} [opts.isFailure] — classify a result as a failure
 *     (default: thrown error or null/undefined resolved)
 * @param {function} [opts.onStateChange] — called as (oldState, newState) for
 *     logging
 */
function createBreaker({
  name,
  failureThreshold = 5,
  cooldownMs = 60_000,
  successThreshold = 1,
  isFailure = null,
  onStateChange = null,
} = {}) {
  if (!name) throw new Error('createBreaker: name is required');

  let state = STATE.CLOSED;
  let failures = 0;
  let successes = 0;
  let openedAt = 0;
  let totalCalls = 0;
  let totalFailures = 0;
  let totalShortCircuits = 0;

  function transitionTo(newState) {
    if (state === newState) return;
    const old = state;
    state = newState;
    if (newState === STATE.OPEN) openedAt = Date.now();
    if (newState === STATE.CLOSED) {
      failures = 0;
      successes = 0;
    }
    if (newState === STATE.HALF_OPEN) {
      successes = 0;
    }
    if (onStateChange) {
      try {
        onStateChange(old, newState, { name, failures, totalFailures });
      } catch {
        /* logging must not break the breaker */
      }
    }
  }

  function onSuccess() {
    if (state === STATE.HALF_OPEN) {
      successes++;
      if (successes >= successThreshold) transitionTo(STATE.CLOSED);
    } else if (state === STATE.CLOSED) {
      failures = 0; // reset failure counter on success
    }
  }

  function onFailure() {
    totalFailures++;
    if (state === STATE.HALF_OPEN) {
      transitionTo(STATE.OPEN);
      return;
    }
    if (state === STATE.CLOSED) {
      failures++;
      if (failures >= failureThreshold) transitionTo(STATE.OPEN);
    }
  }

  function checkAndMaybeHalfOpen() {
    if (state !== STATE.OPEN) return;
    if (Date.now() - openedAt >= cooldownMs) {
      transitionTo(STATE.HALF_OPEN);
    }
  }

  async function execute(fn) {
    totalCalls++;
    checkAndMaybeHalfOpen();

    if (state === STATE.OPEN) {
      totalShortCircuits++;
      const remaining = Math.max(0, cooldownMs - (Date.now() - openedAt));
      throw new CircuitOpenError(name, remaining);
    }

    try {
      const result = await fn();
      const failed = isFailure ? isFailure(result) : result === null || result === undefined;
      if (failed) {
        onFailure();
      } else {
        onSuccess();
      }
      return result;
    } catch (err) {
      onFailure();
      throw err;
    }
  }

  function snapshot() {
    return {
      name,
      state,
      failures,
      successes,
      openedAt: state === STATE.OPEN ? openedAt : null,
      cooldownMs,
      failureThreshold,
      totalCalls,
      totalFailures,
      totalShortCircuits,
    };
  }

  function reset() {
    state = STATE.CLOSED;
    failures = 0;
    successes = 0;
    openedAt = 0;
  }

  return {
    execute,
    snapshot,
    reset,
    get state() {
      return state;
    },
    STATE,
  };
}

// ============================================================
// Shared breakers for known external backends
// ============================================================

const { logger } = require('../logger');

// Lazy-load to avoid circular dependency
let _alerting = null;
function alerting() {
  if (!_alerting) _alerting = require('../alerting');
  return _alerting;
}

function onStateChange(old, newState, ctx) {
  const level = newState === 'OPEN' ? 'warn' : 'info';
  logger[level](
    {
      breaker: ctx.name,
      from: old,
      to: newState,
      failures: ctx.failures,
      totalFailures: ctx.totalFailures,
    },
    'circuit breaker state change'
  );
  // M4.3: alert when the breaker opens against a critical backend
  if (newState === 'OPEN') {
    alerting()
      .warning(`Circuit breaker opened: ${ctx.name}`, {
        detail: `${ctx.failures} consecutive failures against ${ctx.name}`,
        context: { breaker: ctx.name, totalFailures: ctx.totalFailures },
        key: `breaker_open_${ctx.name}`,
      })
      .catch(() => {});
  }
}

const breakers = {
  kassal: createBreaker({ name: 'kassal', failureThreshold: 5, cooldownMs: 60_000, onStateChange }),
  ollama: createBreaker({ name: 'ollama', failureThreshold: 3, cooldownMs: 30_000, onStateChange }),
  anthropic: createBreaker({
    name: 'anthropic',
    failureThreshold: 5,
    cooldownMs: 60_000,
    onStateChange,
  }),
  openai: createBreaker({ name: 'openai', failureThreshold: 5, cooldownMs: 60_000, onStateChange }),
  xai: createBreaker({ name: 'xai', failureThreshold: 5, cooldownMs: 60_000, onStateChange }),
};

function getBreaker(name) {
  return breakers[name] || null;
}

function snapshotAll() {
  return Object.fromEntries(Object.entries(breakers).map(([k, b]) => [k, b.snapshot()]));
}

function resetAll() {
  for (const b of Object.values(breakers)) b.reset();
}

module.exports = {
  createBreaker,
  getBreaker,
  snapshotAll,
  resetAll,
  breakers,
  CircuitOpenError,
  STATE,
};
