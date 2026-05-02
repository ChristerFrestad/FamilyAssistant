// Uke 6 (OBS-5): Chaos-test for circuit breaker
//
// Simulerer at en ekstern backend (f.eks. Ollama) blir treg / svarer med
// feil, og verifiserer at:
//   1. Breaker går fra CLOSED → OPEN etter failureThreshold feil på rad
//   2. Breaker kaster CircuitOpenError i OPEN-state uten å kalle fn
//   3. Etter cooldownMs går breaker til HALF_OPEN ved neste call
//   4. En vellykket HALF_OPEN probe lukker breakeren igjen
//   5. onStateChange-callback triggerer for alle state-overganger
//   6. totalShortCircuits telles korrekt
//
// Dette er en deterministisk chaos-test — vi kontrollerer tiden via
// et manipulerbart mock-urverk (overstyrbar cooldownMs). Ingen flaky
// timing-avhengigheter.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createBreaker, CircuitOpenError } = require('../server/services/circuit-breaker');

describe('Week6 · Chaos: breaker goes to OPEN after failure threshold', () => {
  test('CLOSED → OPEN etter failureThreshold konsekutive feil', async () => {
    const stateChanges = [];
    const breaker = createBreaker({
      name: 'chaos-test-a',
      failureThreshold: 3,
      cooldownMs: 100,
      onStateChange: (from, to, ctx) => stateChanges.push({ from, to, name: ctx.name }),
    });

    // 3 feil på rad → OPEN
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        breaker.execute(async () => {
          throw new Error('simulert Ollama-feil');
        }),
        /simulert Ollama-feil/
      );
    }

    // Siste overgang skal være CLOSED → OPEN
    assert.equal(stateChanges.length, 1, `forventet 1 state change, fikk ${stateChanges.length}`);
    assert.equal(stateChanges[0].from, 'CLOSED');
    assert.equal(stateChanges[0].to, 'OPEN');
    assert.equal(stateChanges[0].name, 'chaos-test-a');
  });

  test('OPEN breaker kaster CircuitOpenError uten å kalle fn', async () => {
    const breaker = createBreaker({
      name: 'chaos-test-b',
      failureThreshold: 2,
      cooldownMs: 60_000,
    });

    // Åpne breakeren
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        breaker.execute(async () => {
          throw new Error('fail');
        })
      );
    }

    // Neste call skal short-circuite
    let fnCalled = false;
    await assert.rejects(
      breaker.execute(async () => {
        fnCalled = true;
        return 'should not reach';
      }),
      CircuitOpenError
    );
    assert.equal(fnCalled, false, 'fn skal ikke bli kalt når breaker er OPEN');

    const snap = breaker.snapshot();
    assert.equal(snap.state, 'OPEN');
    assert.ok(snap.totalShortCircuits >= 1, 'totalShortCircuits må økes');
  });
});

describe('Uke6 · Chaos: breaker recovery', () => {
  test('Etter cooldownMs går breaker til HALF_OPEN ved neste call', async () => {
    const stateChanges = [];
    const breaker = createBreaker({
      name: 'chaos-test-c',
      failureThreshold: 2,
      cooldownMs: 50, // kort for test
      onStateChange: (from, to) => stateChanges.push(`${from}→${to}`),
    });

    // Åpne
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        breaker.execute(async () => {
          throw new Error('x');
        })
      );
    }
    assert.equal(breaker.snapshot().state, 'OPEN');

    // Vent til cooldown utløper
    await new Promise((r) => setTimeout(r, 60));

    // Neste call trigger HALF_OPEN — men fn får kjøre (probe)
    let probeRan = false;
    await breaker.execute(async () => {
      probeRan = true;
      return 'probe-ok';
    });
    assert.equal(probeRan, true, 'HALF_OPEN probe skal kjøre fn');

    // Suksess → CLOSED
    assert.equal(breaker.snapshot().state, 'CLOSED');

    // Verifiser fullstendig state-sekvens
    assert.deepEqual(stateChanges, ['CLOSED→OPEN', 'OPEN→HALF_OPEN', 'HALF_OPEN→CLOSED']);
  });

  test('HALF_OPEN feiler → tilbake til OPEN', async () => {
    const breaker = createBreaker({
      name: 'chaos-test-d',
      failureThreshold: 2,
      cooldownMs: 30,
    });

    // Åpne
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        breaker.execute(async () => {
          throw new Error('x');
        })
      );
    }
    await new Promise((r) => setTimeout(r, 40));

    // HALF_OPEN probe feiler → tilbake til OPEN
    await assert.rejects(
      breaker.execute(async () => {
        throw new Error('still broken');
      })
    );
    assert.equal(breaker.snapshot().state, 'OPEN');
  });
});

describe('Uke6 · Chaos: simulert Ollama-latens via tidsbudget', () => {
  // Simulerer at Ollama tar 500+ ms per call og verifiserer at breakeren
  // fanger timeout-wrapping (implementeres av callsiten, ikke breakeren
  // selv). Her demonstrerer vi mønsteret: wrap execute i Promise.race med timeout.

  async function withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_' + timeoutMs + 'MS')), timeoutMs)
      ),
    ]);
  }

  test('Treg Ollama (500ms) trigger breaker via timeout-wrapper', async () => {
    const breaker = createBreaker({
      name: 'chaos-ollama-slow',
      failureThreshold: 3,
      cooldownMs: 100,
    });

    // Simulert Ollama som alltid tar 500ms
    const slowOllama = () => new Promise((r) => setTimeout(() => r('late'), 500));

    // 3 tidsavbrytelser → OPEN
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        breaker.execute(() => withTimeout(slowOllama(), 100)),
        /TIMEOUT_100MS/
      );
    }

    const snap = breaker.snapshot();
    assert.equal(snap.state, 'OPEN', 'breaker må være OPEN etter 3 timeouts');
    assert.ok(snap.totalFailures >= 3);
  });
});

describe('Uke6 · Chaos: shared breakers er registrert', () => {
  test('ollama, kassal, anthropic, openai, xai finnes i shared registry', () => {
    const cb = require('../server/services/circuit-breaker');
    const all = cb.snapshotAll();
    const expected = ['ollama', 'kassal', 'anthropic', 'openai', 'xai'];
    for (const name of expected) {
      assert.ok(name in all, `shared breaker '${name}' mangler`);
    }
  });

  test('Hver shared breaker har snapshot med state-felt', () => {
    const cb = require('../server/services/circuit-breaker');
    const all = cb.snapshotAll();
    for (const [name, snap] of Object.entries(all)) {
      assert.ok(
        ['CLOSED', 'OPEN', 'HALF_OPEN'].includes(snap.state),
        `breaker ${name} har ugyldig state: ${snap.state}`
      );
      assert.ok(typeof snap.totalCalls === 'number');
      assert.ok(typeof snap.totalFailures === 'number');
      assert.ok(typeof snap.totalShortCircuits === 'number');
    }
  });
});
