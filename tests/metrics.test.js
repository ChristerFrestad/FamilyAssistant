// Unit tests for metrics-modul (ren logikk)

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const metrics = require('../server/http/metrics');

describe('metrics', () => {
  beforeEach(() => metrics.reset());

  test('record + snapshot', () => {
    metrics.record('GET', '/api/today', 200, 5);
    metrics.record('GET', '/api/today', 200, 12);
    metrics.record('GET', '/api/today', 500, 300);
    const snap = metrics.snapshot();
    assert.equal(snap.totalRequests, 3);
    assert.equal(snap.totalErrors, 1);
    assert.ok(snap.errorRate > 0);
    const r = snap.routes.find((x) => x.route === 'GET /api/today');
    assert.ok(r);
    assert.equal(r.count, 3);
    assert.equal(r.byStatus['2xx'], 2);
    assert.equal(r.byStatus['5xx'], 1);
  });

  test('persentiler fra bucket-histogram', () => {
    // 100 sample: 90 @ 10ms, 10 @ 500ms
    for (let i = 0; i < 90; i++) metrics.record('GET', '/api/x', 200, 10);
    for (let i = 0; i < 10; i++) metrics.record('GET', '/api/x', 200, 500);
    const snap = metrics.snapshot();
    const r = snap.routes[0];
    assert.equal(r.count, 100);
    // p50 bør være ≤ 10ms bucket (90 % under 10)
    assert.ok(r.p50Ms <= 10);
    // p95 og p99 bør være i 500ms bucket
    assert.ok(r.p95Ms >= 100);
  });

  test('toPrometheus format', () => {
    metrics.record('GET', '/api/today', 200, 5);
    const out = metrics.toPrometheus();
    assert.ok(out.includes('familieass_http_requests_total 1'));
    assert.ok(out.includes('familieass_http_request_duration_ms'));
    assert.ok(out.includes('method="GET"'));
    assert.ok(out.includes('route="/api/today"'));
  });

  test('reset', () => {
    metrics.record('GET', '/x', 200, 1);
    metrics.reset();
    assert.equal(metrics.snapshot().totalRequests, 0);
  });
});
