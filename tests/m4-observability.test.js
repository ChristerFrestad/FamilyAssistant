// M4 observability-tester
//
// Dekker:
//   1. X-Request-Id header + requestId i problem-body
//   2. /ready utvidet shape (dbSizeBytes, warnings, breakersOpen, etc.)
//   3. /ready returnerer 503 ved kritiske warnings (simulert)
//   4. Alerting-modul: throttling, webhook format, no-op uten URL
//
// Alerting-webhook testes mot en mini HTTP-server.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { startTestServer, request } = require('./helpers');

// ============================================================
// 1. Request-ID propagasjon
// ============================================================
describe('M4.1 · Request-ID ende-til-ende', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.close(); });

  test('Alle responses har X-Request-Id header', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    assert.ok(res.headers['x-request-id'], 'X-Request-Id mangler');
    assert.ok(/^[a-f0-9]{8,}$/.test(res.headers['x-request-id']),
      `X-Request-Id ser ikke ut som en hex-id: ${res.headers['x-request-id']}`);
  });

  test('Klient kan sette sin egen X-Request-Id som blir echoed', async () => {
    const res = await request(server.baseUrl, 'GET', '/health', {
      headers: { 'X-Request-Id': 'client-trace-12345' },
    });
    assert.equal(res.headers['x-request-id'], 'client-trace-12345');
  });

  test('Problem-body inkluderer requestId-feltet', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.ok(res.body.requestId, 'problem.requestId mangler');
    assert.equal(res.body.requestId, res.headers['x-request-id'],
      'requestId i body matcher ikke header');
  });

  test('400-problem fra validation har requestId', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 'ugyldig' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.requestId);
  });
});

// ============================================================
// 2. Utvidet /ready
// ============================================================
describe('M4.2 · /ready utvidet health', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.close(); });

  test('/ready har utvidede felter', async () => {
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.equal(res.status, 200);
    assert.ok('checks' in res.body);
    assert.ok('warnings' in res.body);
    assert.ok(Array.isArray(res.body.warnings));
    assert.ok('breakersOpen' in res.body);
    assert.equal(typeof res.body.breakersOpen, 'number');
    assert.ok('dbSizeMB' in res.body);
    assert.ok('lastBackupAgeHours' in res.body);
  });

  test('/ready.checks har server og repos-flagg', async () => {
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.equal(res.body.checks.server, true);
    assert.equal(res.body.checks.repos, true);
  });

  test('/ready returnerer normalt 200 uten kritiske warnings', async () => {
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.ready, true);
  });

  test('breakersOpen reflekterer faktisk state', async () => {
    const cb = require('../server/services/circuit-breaker');
    // Force open en breaker
    const testBreaker = cb.getBreaker('kassal');
    // Simuler feil for å åpne breakeren
    for (let i = 0; i < 10; i++) {
      try { await testBreaker.execute(async () => { throw new Error('x'); }); } catch {}
    }
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.ok(res.body.breakersOpen >= 1, 'breakersOpen skal være ≥1 etter å ha åpnet kassal');
    assert.ok(res.body.warnings.some(w => w.startsWith('breakers_open_')),
      'warnings skal liste breakers_open_*');
    cb.resetAll();
  });
});

// ============================================================
// 3. Alerting
// ============================================================
describe('M4.3 · Alerting webhook', () => {
  let webhookServer;
  let webhookUrl;
  let received = [];

  before(async () => {
    received = [];
    webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          received.push(JSON.parse(body));
        } catch {
          received.push({ invalid: body });
        }
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise(r => webhookServer.listen(0, '127.0.0.1', r));
    const port = webhookServer.address().port;
    webhookUrl = `http://127.0.0.1:${port}/webhook`;
  });

  after(async () => {
    if (webhookServer) await new Promise(r => webhookServer.close(r));
  });

  test('isActive() returnerer false uten ALERT_WEBHOOK', () => {
    delete require.cache[require.resolve('../server/alerting')];
    delete process.env.ALERT_WEBHOOK;
    const alerting = require('../server/alerting');
    assert.equal(alerting.isActive(), false);
  });

  test('send() er no-op uten webhook URL', async () => {
    delete require.cache[require.resolve('../server/alerting')];
    delete process.env.ALERT_WEBHOOK;
    const alerting = require('../server/alerting');
    const r = await alerting.send({ level: 'warning', title: 'test' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'disabled_or_no_title');
  });

  test('send() POSTer riktig payload til webhook', async () => {
    received.length = 0;
    delete require.cache[require.resolve('../server/alerting')];
    process.env.ALERT_WEBHOOK = webhookUrl;
    const alerting = require('../server/alerting');
    alerting._resetThrottle();

    const r = await alerting.send({
      level: 'critical',
      title: 'Test-alert',
      detail: 'noe gikk galt',
      context: { foo: 'bar' },
    });
    assert.equal(r.sent, true);
    assert.equal(received.length, 1);
    const msg = received[0];
    assert.equal(msg.service, 'familieassistenten');
    assert.equal(msg.level, 'critical');
    assert.equal(msg.title, 'Test-alert');
    assert.equal(msg.detail, 'noe gikk galt');
    assert.deepEqual(msg.context, { foo: 'bar' });
    assert.ok(msg.timestamp);
    assert.ok(msg.hostname);
    delete process.env.ALERT_WEBHOOK;
    delete require.cache[require.resolve('../server/alerting')];
  });

  test('throttling hindrer spam av samme key', async () => {
    received.length = 0;
    delete require.cache[require.resolve('../server/alerting')];
    process.env.ALERT_WEBHOOK = webhookUrl;
    const alerting = require('../server/alerting');
    alerting._resetThrottle();

    const a = await alerting.send({ level: 'warning', title: 'dup', key: 'dup-key' });
    const b = await alerting.send({ level: 'warning', title: 'dup', key: 'dup-key' });
    const c = await alerting.send({ level: 'warning', title: 'dup', key: 'dup-key' });
    assert.equal(a.sent, true);
    assert.equal(b.sent, false);
    assert.equal(b.reason, 'throttled');
    assert.equal(c.sent, false);
    assert.equal(received.length, 1, 'kun første skal ha blitt sendt');
    delete process.env.ALERT_WEBHOOK;
    delete require.cache[require.resolve('../server/alerting')];
  });

  test('warning/critical/fatal wrappers setter nivå', async () => {
    received.length = 0;
    delete require.cache[require.resolve('../server/alerting')];
    process.env.ALERT_WEBHOOK = webhookUrl;
    const alerting = require('../server/alerting');
    alerting._resetThrottle();

    await alerting.warning('w1', { key: 'w1' });
    await alerting.critical('c1', { key: 'c1' });
    await alerting.fatal('f1', { key: 'f1' });
    assert.equal(received.length, 3);
    assert.equal(received[0].level, 'warning');
    assert.equal(received[1].level, 'critical');
    assert.equal(received[2].level, 'fatal');
    delete process.env.ALERT_WEBHOOK;
    delete require.cache[require.resolve('../server/alerting')];
  });

  test('send() returnerer { sent: false, reason: bad_url } for ugyldig URL', async () => {
    delete require.cache[require.resolve('../server/alerting')];
    process.env.ALERT_WEBHOOK = 'not a url';
    const alerting = require('../server/alerting');
    alerting._resetThrottle();
    const r = await alerting.send({ level: 'warning', title: 'test bad url' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'bad_url');
    delete process.env.ALERT_WEBHOOK;
    delete require.cache[require.resolve('../server/alerting')];
  });

  test('Stor context trimmes til MAX_PAYLOAD_BYTES', async () => {
    received.length = 0;
    delete require.cache[require.resolve('../server/alerting')];
    process.env.ALERT_WEBHOOK = webhookUrl;
    const alerting = require('../server/alerting');
    alerting._resetThrottle();

    const huge = { big: 'x'.repeat(10_000) };
    const r = await alerting.send({ level: 'warning', title: 'big', context: huge, key: 'big-test' });
    assert.equal(r.sent, true);
    // Hele payloaden skal fortsatt være parsable JSON
    assert.equal(received.length, 1);
    delete process.env.ALERT_WEBHOOK;
    delete require.cache[require.resolve('../server/alerting')];
  });
});
