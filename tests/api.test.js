// Integration tests for core API routes
// Kjøres med: node --test tests/
//
// Dekker:
//   - Health + ready
//   - Meals: get/swap/invalidate
//   - Shopping: read/add/cache-invalidering
//   - Chores: get/complete
//   - Calendar: CRUD
//   - ETag + gzip + 304
//   - Metrics-endpoint
//   - Error handling (404, 400 validation)

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
});

// ============================================================
describe('Health + Ready', () => {
  test('GET /health returns 200 with uptime', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.ok(typeof res.body.uptimeSec === 'number');
  });

  test('GET /ready returns 200 when DB ready', async () => {
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.ready, true);
    assert.ok(res.body.driver);
  });

  test('Security headers applied', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });
});

// ============================================================
describe('Meals', () => {
  test('GET /api/meals/current returns weekly plan', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(res.status, 200);
    assert.ok(res.body.weekYear);
    assert.ok(Array.isArray(res.body.meals));
    assert.equal(res.body.meals.length, 7);
  });

  test('Cache: second call returns X-Cache: HIT', async () => {
    // Invalider eksplisitt slik at denne testen har en ren startilstand
    // uavhengig av rekkefølge med tidligere tester som varmet cachen.
    const { invalidate } = require('../server/http/cache');
    invalidate('meals');
    const r1 = await request(server.baseUrl, 'GET', '/api/meals/current');
    const r2 = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(r1.headers['x-cache'], 'MISS');
    assert.equal(r2.headers['x-cache'], 'HIT');
  });

  test('PUT /api/meals/swap invalidates cache', async () => {
    // Warm cache
    await request(server.baseUrl, 'GET', '/api/meals/current');

    // Swap day 0 to recipe 1
    const swap = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 0, recipeId: 1 },
    });
    assert.equal(swap.status, 200);

    // Next GET should be MISS (invalidated)
    const r = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(r.headers['x-cache'], 'MISS');
  });

  test('GET /api/meals/swap with invalid dayOfWeek → 400 validation', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 99, recipeId: 1 },
    });
    assert.equal(res.status, 400);
    assert.ok(res.headers['content-type'].includes('problem+json'));
  });
});

// ============================================================
describe('Shopping', () => {
  test('GET /api/shopping/current returns list', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/shopping/current');
    assert.equal(res.status, 200);
    assert.ok(res.body.categories);
  });

  test('POST /api/shopping/add invalidates cache', async () => {
    await request(server.baseUrl, 'GET', '/api/shopping/current');
    const add = await request(server.baseUrl, 'POST', '/api/shopping/add', {
      body: { name: 'Test-vare', category: 'Tørrvarer & annet', quantity: 1 },
    });
    assert.equal(add.status, 200);
    const after = await request(server.baseUrl, 'GET', '/api/shopping/current');
    assert.equal(after.headers['x-cache'], 'MISS');
  });
});

// ============================================================
describe('Chores', () => {
  test('GET /api/chores/current returns week schedule', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/chores/current');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.chores));
  });

  test('PUT /api/chores/complete marks done + invalidates', async () => {
    const before = await request(server.baseUrl, 'GET', '/api/chores/current');
    const choreId = before.body.chores[0]?.choreId;
    if (choreId) {
      const done = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
        body: { choreId },
      });
      assert.equal(done.status, 200);
      const after = await request(server.baseUrl, 'GET', '/api/chores/current');
      assert.equal(after.headers['x-cache'], 'MISS');
    }
  });
});

// ============================================================
describe('Calendar', () => {
  test('POST → GET → DELETE calendar event', async () => {
    const created = await request(server.baseUrl, 'POST', '/api/calendar/events', {
      body: { title: 'Test-event', date: '2026-04-15' },
    });
    assert.equal(created.status, 200);
    const id = created.body.event.id;
    assert.ok(id);

    const list = await request(
      server.baseUrl,
      'GET',
      '/api/calendar/events?from=2026-04-15&to=2026-04-15'
    );
    assert.equal(list.status, 200);
    assert.ok(list.body.events.some((e) => e.id === id));

    const del = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${id}`);
    assert.equal(del.status, 200);
  });
});

// ============================================================
describe('HTTP: ETag + gzip + 304', () => {
  test('ETag header present + If-None-Match returns 304', async () => {
    const r1 = await request(server.baseUrl, 'GET', '/api/recipes');
    assert.equal(r1.status, 200);
    assert.ok(r1.headers.etag);

    const r2 = await request(server.baseUrl, 'GET', '/api/recipes', {
      headers: { 'If-None-Match': r1.headers.etag },
    });
    assert.equal(r2.status, 304);
  });

  test('gzip applied to large responses', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/recipes', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers.vary, 'Accept-Encoding');
  });
});

// ============================================================
describe('Metrics', () => {
  test('GET /metrics returns Prometheus format', async () => {
    await request(server.baseUrl, 'GET', '/api/today');
    await request(server.baseUrl, 'GET', '/api/today');
    const res = await request(server.baseUrl, 'GET', '/metrics');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].startsWith('text/plain'));
    assert.ok(res.raw.includes('familieass_http_requests_total'));
    assert.ok(res.raw.includes('familieass_http_request_duration_ms'));
  });

  test('GET /metrics?format=json returns snapshot', async () => {
    const res = await request(server.baseUrl, 'GET', '/metrics?format=json');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.totalRequests === 'number');
    assert.ok(Array.isArray(res.body.routes));
    const todayRoute = res.body.routes.find((r) => r.route.includes('/api/today'));
    assert.ok(todayRoute, 'should track /api/today');
    assert.ok(todayRoute.p50Ms >= 0);
  });
});

// ============================================================
describe('Error handling', () => {
  test('404 for unknown API route', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.ok(res.headers['content-type'].includes('problem+json'));
  });

  test('Invalid JSON body → 400', async () => {
    // Send raw bad JSON
    const http = require('http');
    const url = new URL(server.baseUrl + '/api/shopping/add');
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () =>
            resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() })
          );
        }
      );
      req.on('error', reject);
      req.write('{not valid json');
      req.end();
    });
    assert.equal(res.status, 400);
  });
});

// ============================================================
describe('LLM cache', () => {
  test('repos.llmCache set/get/expire', async () => {
    // Direkte mot repos — ingen Ollama nødvendig
    const r = server.repos;
    r.llmCache.set('test-key', {
      model: 'test-model',
      prompt: 'hello',
      response: '{"ok":true}',
      ttlSeconds: 60,
    });
    const hit = r.llmCache.get('test-key');
    assert.ok(hit);
    assert.equal(hit.response, '{"ok":true}');

    // Expired key
    r.llmCache.set('expired-key', {
      model: 'test-model',
      prompt: 'hi',
      response: 'x',
      ttlSeconds: -1,
    });
    const miss = r.llmCache.get('expired-key');
    assert.equal(miss, null);
  });
});
