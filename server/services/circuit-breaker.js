// Circuit breaker (M2.3)
//
// Implementerer det klassiske 3-state mønsteret:
//   CLOSED   — kall går gjennom, feil telles opp
//   OPEN     — kall avvises raskt uten å treffe nettet, til cooldown utløper
//   HALF_OPEN — første kall etter cooldown "prober" backendet:
//               suksess → CLOSED, feil → OPEN med ny cooldown
//
// Hvorfor:
//   - Beskytter RPi5 mot å henge på hver request når Kassal/Ollama er nede
//   - Gir brukere øyeblikkelig feedback (503/cached) i stedet for 30s timeout
//   - Reduserer retry-trykk på allerede slitne backends
//
// Bruk:
//   const cb = createBreaker({ name: 'kassal', failureThreshold: 5, cooldownMs: 60_000 });
//   const result = await cb.execute(() => fetch('https://kassal.app/...'));
//   // Kaster CircuitOpenError hvis breakeren er åpen.
//
// Null dependencies. Shared-instance helper for kjente backends er nederst.

const STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

class CircuitOpenError extends Error {
  constructor(name, retryAfterMs) {
    super(`Circuit for '${name}' er åpen, prøv igjen om ${Math.round(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.breakerName = name;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Opprett en navngitt breaker-instans.
 * @param {Object} opts
 * @param {string} opts.name — for logging og feilmeldinger
 * @param {number} [opts.failureThreshold=5] — feil på rad før OPEN
 * @param {number} [opts.cooldownMs=60000] — tid i OPEN før HALF_OPEN-probe
 * @param {number} [opts.successThreshold=1] — HALF_OPEN-probes som må lykkes for CLOSED
 * @param {function} [opts.isFailure] — klassifiser et resultat som feil
 *     (standard: thrown error eller null/undefined resolved)
 * @param {function} [opts.onStateChange] — kalles som (oldState, newState) for logging
 */
function createBreaker({
  name,
  failureThreshold = 5,
  cooldownMs = 60_000,
  successThreshold = 1,
  isFailure = null,
  onStateChange = null,
} = {}) {
  if (!name) throw new Error('createBreaker: name er påkrevd');

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
        /* logging må ikke bryte breakeren */
      }
    }
  }

  function onSuccess() {
    if (state === STATE.HALF_OPEN) {
      successes++;
      if (successes >= successThreshold) transitionTo(STATE.CLOSED);
    } else if (state === STATE.CLOSED) {
      failures = 0; // reset feilteller ved suksess
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
// Shared breakers for kjente eksterne backends
// ============================================================

const { logger } = require('../logger');

// Lazy-load for å unngå sirkulær avhengighet
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
  // M4.3: varsle når breaker åpner mot kritisk backend
  if (newState === 'OPEN') {
    alerting()
      .warning(`Circuit breaker åpnet: ${ctx.name}`, {
        detail: `${ctx.failures} påfølgende feil mot ${ctx.name}`,
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
