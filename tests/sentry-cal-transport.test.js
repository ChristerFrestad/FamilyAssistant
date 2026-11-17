'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// End-to-end check with the real SDK and an in-memory transport. The
// shaped-event tests cover the hooks; this one fails if initSentry
// forgets to register them.
test('the Sentry SDK transport does not receive a calendar secret', async (t) => {
  let Sentry;
  try {
    Sentry = require('@sentry/node');
  } catch (err) {
    t.skip(`@sentry/node is optional (${err.code || err.message})`);
    return;
  }
  if (typeof Sentry.createTransport !== 'function' || typeof Sentry.startSpan !== 'function') {
    t.skip('this @sentry/node build cannot take an in-memory transport');
    return;
  }

  process.env.NODE_ENV = 'test';
  const sentry = require('../server/observability/sentry');
  sentry.resetForTests();
  const secret = 'sdk-feed-secret';
  const bodies = [];
  const started = sentry.initSentry({
    SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
    SENTRY_TRACES_SAMPLE_RATE: 1,
    transport(options) {
      return Sentry.createTransport(options, (request) => {
        const body =
          typeof request.body === 'string'
            ? request.body
            : Buffer.from(request.body).toString('utf8');
        bodies.push(body);
        return Promise.resolve({ statusCode: 200 });
      });
    },
  });
  if (!started.enabled) {
    t.skip(`Sentry did not start (${started.reason})`);
    return;
  }

  await Sentry.startSpan(
    {
      name: `GET /cal/${secret}.ics`,
      op: 'http.server',
      forceTransaction: true,
      attributes: {
        url: `http://127.0.0.1/cal/${secret}.ics`,
        'http.target': `/cal/${secret}.ics`,
        'http.url': `http://127.0.0.1/cal/${secret}.ics`,
      },
    },
    () => {
      Sentry.captureException(new Error(`explode /cal/${secret}.ics`));
    }
  );
  if (typeof Sentry.flush === 'function') await Sentry.flush(2000);

  const packed = bodies.join('\n');
  assert.ok(packed.length > 0, 'the transport saw no envelope');
  assert.equal(packed.includes(secret), false);
  assert.match(packed, /GET \/cal\/:secret/);
  await sentry.closeSentry(500);
  sentry.resetForTests();
});
