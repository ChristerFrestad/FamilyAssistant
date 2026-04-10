// HTTP metrics (Fase 5.1)
//
// In-memory metrics med to datatyper:
//   1. Counters — pr. (method, route, statusClass) → antall requests
//   2. Latency buckets — pr. route → histogram med faste grenser
//
// Designvalg:
//   - Route-label normaliseres til "route template" (ikke full path),
//     slik at /api/recipes/42 og /api/recipes/17 aggregeres til samme bucket.
//   - Latency lagres som bucket-count for p50/p95/p99-beregning.
//     Full HDR er unødvendig for en RPi5 — 16 buckets gir holdbar presisjon.
//   - Ingen ekstern avhengighet (Prometheus client er overkill).
//
// Eksposerer:
//   - record(method, routeTemplate, status, durationMs)
//   - snapshot() → JSON
//   - toPrometheus() → text/plain Prometheus exposition format

// Bucket-grenser i millisekunder, dekker 1ms–10s
const LATENCY_BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

const state = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalErrors: 0,
  routes: new Map(), // "GET /api/today" → routeMetric
};

function makeRouteMetric() {
  return {
    count: 0,
    sum: 0,           // sum av durations (for gjennomsnitt)
    min: Infinity,
    max: 0,
    byStatus: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    // Histogram: index = bucket-nr, siste bucket = +Inf
    buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
  };
}

function statusClass(status) {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

function bucketFor(durationMs) {
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
    if (durationMs <= LATENCY_BUCKETS_MS[i]) return i;
  }
  return LATENCY_BUCKETS_MS.length; // +Inf bucket
}

function record(method, routeTemplate, status, durationMs) {
  state.totalRequests++;
  if (status >= 500) state.totalErrors++;

  const key = `${method} ${routeTemplate}`;
  let m = state.routes.get(key);
  if (!m) { m = makeRouteMetric(); state.routes.set(key, m); }

  m.count++;
  m.sum += durationMs;
  if (durationMs < m.min) m.min = durationMs;
  if (durationMs > m.max) m.max = durationMs;
  m.byStatus[statusClass(status)]++;
  m.buckets[bucketFor(durationMs)]++;
}

/**
 * Beregner persentil fra et bucket-histogram.
 * Returnerer øvre grense for bucketen der persentilen faller.
 */
function percentile(buckets, totalCount, p) {
  if (totalCount === 0) return 0;
  const target = Math.ceil(totalCount * p);
  let cum = 0;
  for (let i = 0; i < buckets.length; i++) {
    cum += buckets[i];
    if (cum >= target) {
      return i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i] : LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
    }
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
}

function snapshot() {
  const uptimeSec = Math.round((Date.now() - state.startedAt) / 1000);
  const routes = [];
  for (const [key, m] of state.routes.entries()) {
    const avg = m.count > 0 ? m.sum / m.count : 0;
    routes.push({
      route: key,
      count: m.count,
      avgMs: Math.round(avg * 100) / 100,
      minMs: m.min === Infinity ? 0 : m.min,
      maxMs: m.max,
      p50Ms: percentile(m.buckets, m.count, 0.5),
      p95Ms: percentile(m.buckets, m.count, 0.95),
      p99Ms: percentile(m.buckets, m.count, 0.99),
      byStatus: { ...m.byStatus },
    });
  }
  routes.sort((a, b) => b.count - a.count);
  return {
    uptimeSec,
    totalRequests: state.totalRequests,
    totalErrors: state.totalErrors,
    errorRate: state.totalRequests > 0
      ? Math.round((state.totalErrors / state.totalRequests) * 10000) / 10000
      : 0,
    routes,
  };
}

/**
 * Prometheus-exposition format (text/plain).
 * Gir ops-team mulighet til å scrape /metrics direkte.
 */
function toPrometheus() {
  const lines = [];
  const snap = snapshot();

  lines.push('# HELP familieass_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE familieass_uptime_seconds gauge');
  lines.push(`familieass_uptime_seconds ${snap.uptimeSec}`);
  lines.push('');

  lines.push('# HELP familieass_http_requests_total Total HTTP requests');
  lines.push('# TYPE familieass_http_requests_total counter');
  lines.push(`familieass_http_requests_total ${snap.totalRequests}`);
  lines.push('');

  lines.push('# HELP familieass_http_errors_total HTTP 5xx responses');
  lines.push('# TYPE familieass_http_errors_total counter');
  lines.push(`familieass_http_errors_total ${snap.totalErrors}`);
  lines.push('');

  lines.push('# HELP familieass_http_request_duration_ms Request duration histogram');
  lines.push('# TYPE familieass_http_request_duration_ms histogram');
  for (const r of snap.routes) {
    const [method, routeRaw] = r.route.split(' ');
    const route = routeRaw.replace(/"/g, '');
    const labels = `method="${method}",route="${route}"`;
    lines.push(`familieass_http_request_duration_ms_count{${labels}} ${r.count}`);
    lines.push(`familieass_http_request_duration_ms_sum{${labels}} ${(r.avgMs * r.count).toFixed(2)}`);
    lines.push(`familieass_http_request_duration_ms{quantile="0.5",${labels}} ${r.p50Ms}`);
    lines.push(`familieass_http_request_duration_ms{quantile="0.95",${labels}} ${r.p95Ms}`);
    lines.push(`familieass_http_request_duration_ms{quantile="0.99",${labels}} ${r.p99Ms}`);
  }
  lines.push('');

  return lines.join('\n') + '\n';
}

function reset() {
  state.startedAt = Date.now();
  state.totalRequests = 0;
  state.totalErrors = 0;
  state.routes.clear();
}

// ============================================================
// Serialize / hydrate (for persistert metrics)
// ============================================================
//
// Prometheus counters må være monotont voksende på tvers av restarts, ellers
// får rate()-beregninger kunstige "counter reset"-events. Ved å lagre state
// til disk ved shutdown + daglig cron kan vi hydrate ved oppstart og bevare
// telleverdier. bucket-arrays og byStatus serialiseres direkte; prosessens
// startedAt tas IKKE med — den nullstilles per prosess (uptime = nåværende
// prosesstid, ikke akkumulert).

function serialize() {
  const routes = [];
  for (const [key, m] of state.routes.entries()) {
    routes.push({
      key,
      count: m.count,
      sum: m.sum,
      min: m.min === Infinity ? null : m.min,
      max: m.max,
      byStatus: { ...m.byStatus },
      buckets: m.buckets.slice(),
    });
  }
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    totalRequests: state.totalRequests,
    totalErrors: state.totalErrors,
    routes,
  };
}

function hydrate(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.version !== 1) return false;
  if (!Array.isArray(data.routes)) return false;

  state.totalRequests = Number.isFinite(data.totalRequests) ? data.totalRequests : 0;
  state.totalErrors = Number.isFinite(data.totalErrors) ? data.totalErrors : 0;
  state.routes.clear();

  for (const r of data.routes) {
    if (!r || typeof r.key !== 'string') continue;
    const m = makeRouteMetric();
    m.count = Number.isFinite(r.count) ? r.count : 0;
    m.sum = Number.isFinite(r.sum) ? r.sum : 0;
    m.min = r.min == null ? Infinity : r.min;
    m.max = Number.isFinite(r.max) ? r.max : 0;
    if (r.byStatus && typeof r.byStatus === 'object') {
      m.byStatus = {
        '2xx': r.byStatus['2xx'] || 0,
        '3xx': r.byStatus['3xx'] || 0,
        '4xx': r.byStatus['4xx'] || 0,
        '5xx': r.byStatus['5xx'] || 0,
      };
    }
    if (Array.isArray(r.buckets) && r.buckets.length === LATENCY_BUCKETS_MS.length + 1) {
      m.buckets = r.buckets.map(n => Number.isFinite(n) ? n : 0);
    }
    state.routes.set(r.key, m);
  }
  return true;
}

module.exports = {
  record, snapshot, toPrometheus, reset,
  serialize, hydrate,
  LATENCY_BUCKETS_MS,
};
