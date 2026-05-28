#!/usr/bin/env node
//
// M3.4 Load baseline — run a simple load profile against a running
// Familieassistenten-server og rapporter p50/p95/p99 + RSS.
//
// Bruk:
//   node scripts/load-baseline.js                       # local at :7777
//   node scripts/load-baseline.js --url=https://host    # mot RPi5
//   node scripts/load-baseline.js --token=$AUTH_TOKEN   # auth headers
//   node scripts/load-baseline.js --concurrency=10 --duration=60
//
// Ingen ekstern avhengighet — bruker node:http. Kan kopieres til RPi5
// and runs there without npm install.
//
// Acceptance thresholds (dokumentert i RUNBOOK §8):
//   - p95 < 200 ms on cached endpoints (/api/today, /api/meals/current)
//   - p95 < 800 ms on write endpoints (/api/meals/swap)
//   - RSS < 250 MB etter 60s sustained load
//   - Feil-rate < 0.1 %

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ============================================================
// Args
// ============================================================
function parseArgs() {
  const args = {
    url: 'http://localhost:7777',
    token: process.env.AUTH_TOKEN || '',
    concurrency: 10,
    duration: 30,
    warmupMs: 2000,
    profile: 'smoke', // smoke|read|write|mixed
    output: '', // JSON-fil til baseline-resultat (uke 5)
    compare: '', // baseline file to compare against (week 5, CI gate)
    allowRegressionPct: 20, // tillat p95 opptil +20% vs baseline
  };
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = isNaN(+m[2]) ? m[2] : Number(m[2]);
  }
  return args;
}

const args = parseArgs();

// ============================================================
// HTTP worker
// ============================================================
const BASE = new URL(args.url);
const isHttps = BASE.protocol === 'https:';
const lib = isHttps ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: args.concurrency * 2 });

function req(method, pathname, body) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BASE.hostname,
      port: BASE.port || (isHttps ? 443 : 80),
      path: pathname,
      method,
      agent,
      headers: {
        'User-Agent': 'fam-load-baseline',
        Accept: 'application/json',
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}),
        ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
      },
      // 10s cap for treg backend
      timeout: 10_000,
      rejectUnauthorized: false, // tillat intern CA
    };
    const r = lib.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        const durNs = process.hrtime.bigint() - started;
        resolve({ status: res.statusCode, durMs: Number(durNs) / 1e6 });
      });
    });
    r.on('error', () =>
      resolve({ status: 0, durMs: Number(process.hrtime.bigint() - started) / 1e6 })
    );
    r.on('timeout', () => {
      r.destroy();
      resolve({ status: 0, durMs: 10_000 });
    });
    if (payload) r.write(payload);
    r.end();
  });
}

// ============================================================
// Scenarios
// ============================================================
const PROFILES = {
  smoke: [
    { method: 'GET', path: '/health', weight: 1 },
    { method: 'GET', path: '/ready', weight: 1 },
    { method: 'GET', path: '/api/today', weight: 3 },
    { method: 'GET', path: '/api/meals/current', weight: 2 },
    { method: 'GET', path: '/api/chores/current', weight: 2 },
  ],
  read: [
    { method: 'GET', path: '/api/today', weight: 5 },
    { method: 'GET', path: '/api/meals/current', weight: 3 },
    { method: 'GET', path: '/api/chores/current', weight: 3 },
    { method: 'GET', path: '/api/recipes', weight: 2 },
    { method: 'GET', path: '/api/calendar/events', weight: 1 },
    { method: 'GET', path: '/api/status', weight: 1 },
  ],
  mixed: [
    { method: 'GET', path: '/api/today', weight: 4 },
    { method: 'GET', path: '/api/meals/current', weight: 3 },
    { method: 'GET', path: '/api/chores/current', weight: 2 },
    { method: 'GET', path: '/api/recipes', weight: 1 },
    {
      method: 'PUT',
      path: '/api/meals/status',
      body: { dayOfWeek: 2, status: 'planned' },
      weight: 1,
    },
  ],
};

function pickScenario(profile) {
  const total = profile.reduce((s, p) => s + p.weight, 0);
  let n = Math.random() * total;
  for (const p of profile) {
    n -= p.weight;
    if (n <= 0) return p;
  }
  return profile[0];
}

// ============================================================
// Stats
// ============================================================
class Histogram {
  constructor() {
    this.values = [];
  }
  add(v) {
    this.values.push(v);
  }
  pct(p) {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
  }
  get min() {
    return Math.min(...this.values);
  }
  get max() {
    return Math.max(...this.values);
  }
  get mean() {
    return this.values.reduce((a, b) => a + b, 0) / (this.values.length || 1);
  }
  get count() {
    return this.values.length;
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  const profile = PROFILES[args.profile];
  if (!profile) {
    console.error(
      `Ukjent profil: ${args.profile}. Tilgjengelig: ${Object.keys(PROFILES).join(', ')}`
    );
    process.exit(1);
  }

  console.log(`=== Familieassistenten Load Baseline ===`);
  console.log(`URL:         ${args.url}`);
  console.log(`Profile:     ${args.profile} (${profile.length} endepunkter)`);
  console.log(`Concurrency: ${args.concurrency}`);
  console.log(`Duration:    ${args.duration}s`);
  console.log(`Warmup:      ${args.warmupMs}ms`);
  console.log('');

  // Quick health check
  const health = await req('GET', '/health');
  if (health.status !== 200) {
    console.error(`Server is not responding at /health (status=${health.status}). Exiting.`);
    process.exit(2);
  }
  console.log(`Server OK (health=${health.status}, ${health.durMs.toFixed(1)}ms)`);

  // Warmup — fyll evt. responsecache
  console.log('Warming up...');
  const warmupEnd = Date.now() + args.warmupMs;
  while (Date.now() < warmupEnd) {
    await req('GET', '/api/today');
  }

  console.log(`Running main test (${args.duration}s)...`);
  const hist = new Histogram();
  const perEndpoint = new Map();
  let totalRequests = 0;
  let totalErrors = 0;
  let total4xx = 0;
  let total5xx = 0;

  const endAt = Date.now() + args.duration * 1000;
  const workers = [];

  async function worker() {
    while (Date.now() < endAt) {
      const scenario = pickScenario(profile);
      const r = await req(scenario.method, scenario.path, scenario.body);
      totalRequests++;
      hist.add(r.durMs);
      const key = `${scenario.method} ${scenario.path}`;
      if (!perEndpoint.has(key)) perEndpoint.set(key, new Histogram());
      perEndpoint.get(key).add(r.durMs);
      if (r.status === 0) totalErrors++;
      else if (r.status >= 500) total5xx++;
      else if (r.status >= 400) total4xx++;
    }
  }

  for (let i = 0; i < args.concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  // Rapport
  console.log('');
  console.log('=== RESULTATER ===');
  console.log(`Total requests:  ${totalRequests}`);
  console.log(`RPS:             ${(totalRequests / args.duration).toFixed(1)}`);
  console.log(
    `Errors:          ${totalErrors} (${((totalErrors / totalRequests) * 100).toFixed(2)}%)`
  );
  console.log(`4xx:             ${total4xx}`);
  console.log(`5xx:             ${total5xx}`);
  console.log('');
  console.log('Globalt latency (ms):');
  console.log(`  min:  ${hist.min.toFixed(1)}`);
  console.log(`  mean: ${hist.mean.toFixed(1)}`);
  console.log(`  p50:  ${hist.pct(0.5).toFixed(1)}`);
  console.log(`  p95:  ${hist.pct(0.95).toFixed(1)}`);
  console.log(`  p99:  ${hist.pct(0.99).toFixed(1)}`);
  console.log(`  max:  ${hist.max.toFixed(1)}`);
  console.log('');
  console.log('Per endepunkt:');
  console.log(
    '  ' +
      'path'.padEnd(40) +
      'count'.padStart(8) +
      'p50'.padStart(10) +
      'p95'.padStart(10) +
      'p99'.padStart(10)
  );
  const entries = [...perEndpoint.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, h] of entries) {
    console.log(
      '  ' +
        key.padEnd(40) +
        String(h.count).padStart(8) +
        h.pct(0.5).toFixed(1).padStart(10) +
        h.pct(0.95).toFixed(1).padStart(10) +
        h.pct(0.99).toFixed(1).padStart(10)
    );
  }

  // Final check against /api/status to fetch updated breakers + mem
  console.log('');
  console.log('=== SERVER-STATE ETTER TEST ===');
  try {
    const status = await new Promise((resolve) => {
      const r = lib.request(
        {
          hostname: BASE.hostname,
          port: BASE.port || (isHttps ? 443 : 80),
          path: '/api/status',
          method: 'GET',
          agent,
          headers: args.token ? { Authorization: `Bearer ${args.token}` } : {},
          rejectUnauthorized: false,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        }
      );
      r.on('error', () => resolve(null));
      r.end();
    });
    if (status) {
      console.log(`  version:    ${status.version}`);
      console.log(`  uptime:     ${status.uptime}s`);
      if (status.breakers) {
        for (const [name, b] of Object.entries(status.breakers)) {
          console.log(
            `  breaker.${name}: ${b.state} (calls=${b.totalCalls}, failures=${b.totalFailures})`
          );
        }
      }
    }

    // Og /health for RSS
    const healthEnd = await req('GET', '/health');
    if (healthEnd.status === 200) {
      const r2 = await new Promise((resolve) => {
        const r = lib.request(
          {
            hostname: BASE.hostname,
            port: BASE.port || (isHttps ? 443 : 80),
            path: '/health',
            method: 'GET',
            agent,
            rejectUnauthorized: false,
          },
          (res) => {
            let body = '';
            res.on('data', (c) => {
              body += c;
            });
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve(null);
              }
            });
          }
        );
        r.on('error', () => resolve(null));
        r.end();
      });
      if (r2) console.log(`  server RSS: ${r2.memMB} MB (uptime ${r2.uptimeSec}s)`);
    }
  } catch (err) {
    console.log(`  (kunne ikke hente sluttstatus: ${err.message})`);
  }

  // Grade mot thresholds
  console.log('');
  console.log('=== GRADE ===');
  const p95 = hist.pct(0.95);
  const errorRate = totalErrors / totalRequests;
  const grade = {
    'p95 < 200ms': p95 < 200,
    'error rate < 0.1%': errorRate < 0.001,
    'no 5xx': total5xx === 0,
  };
  for (const [rule, ok] of Object.entries(grade)) {
    console.log(`  ${ok ? '✓' : '✗'} ${rule}`);
  }
  const allOk = Object.values(grade).every(Boolean);
  console.log('');
  console.log(allOk ? '🟢 BASELINE OK' : '🔴 BASELINE FAILED');

  // Uke 5 PERF-1: skriv strukturert JSON til --output
  const result = {
    generatedAt: new Date().toISOString(),
    profile: args.profile,
    concurrency: args.concurrency,
    durationSec: args.duration,
    totalRequests,
    rps: +(totalRequests / args.duration).toFixed(1),
    errors: totalErrors,
    errors4xx: total4xx,
    errors5xx: total5xx,
    errorRatePct: +((totalErrors / totalRequests) * 100).toFixed(3),
    global: {
      min: +hist.min.toFixed(1),
      mean: +hist.mean.toFixed(1),
      p50: +hist.pct(0.5).toFixed(1),
      p95: +hist.pct(0.95).toFixed(1),
      p99: +hist.pct(0.99).toFixed(1),
      max: +hist.max.toFixed(1),
    },
    perEndpoint: {},
    grade,
    gradeOk: allOk,
  };
  for (const [key, h] of perEndpoint) {
    result.perEndpoint[key] = {
      count: h.count,
      p50: +h.pct(0.5).toFixed(1),
      p95: +h.pct(0.95).toFixed(1),
      p99: +h.pct(0.99).toFixed(1),
    };
  }

  if (args.output) {
    try {
      const fs = require('fs');
      fs.writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n');
      console.log(`\nSkrevet baseline-JSON: ${args.output}`);
    } catch (err) {
      console.error(`Kunne ikke skrive --output: ${err.message}`);
      process.exit(4);
    }
  }

  // Uke 5 PERF-2: sammenlign mot tidligere baseline og feil hvis regresjon
  if (args.compare) {
    try {
      const fs = require('fs');
      const prev = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
      console.log('');
      console.log(`=== REGRESSION CHECK (vs ${args.compare}) ===`);
      const maxPct = Number(args.allowRegressionPct) || 20;
      const regressions = [];
      // Global p95
      const prevP95 = prev.global?.p95 ?? 0;
      const currP95 = result.global.p95;
      const deltaPct = prevP95 > 0 ? +(((currP95 - prevP95) / prevP95) * 100).toFixed(1) : 0;
      const line = `global p95: ${currP95}ms vs ${prevP95}ms (${deltaPct >= 0 ? '+' : ''}${deltaPct}%)`;
      if (deltaPct > maxPct) {
        console.log(`  ✗ ${line} (maks +${maxPct}%)`);
        regressions.push(line);
      } else {
        console.log(`  ✓ ${line}`);
      }
      // Per-endepunkt
      for (const [ep, cur] of Object.entries(result.perEndpoint)) {
        const p = prev.perEndpoint?.[ep];
        if (!p) continue;
        const d = p.p95 > 0 ? +(((cur.p95 - p.p95) / p.p95) * 100).toFixed(1) : 0;
        const l = `${ep}: ${cur.p95}ms vs ${p.p95}ms (${d >= 0 ? '+' : ''}${d}%)`;
        if (d > maxPct) {
          console.log(`  ✗ ${l}`);
          regressions.push(l);
        } else {
          console.log(`  ✓ ${l}`);
        }
      }
      if (regressions.length > 0) {
        console.log('');
        console.log(`🔴 REGRESSION: ${regressions.length} endepunkt(er) over +${maxPct}%`);
        process.exit(2);
      }
      console.log('');
      console.log('🟢 NO REGRESSION');
    } catch (err) {
      console.error(`Kunne ikke sammenligne med --compare: ${err.message}`);
      process.exit(5);
    }
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Load-test feilet:', err);
  process.exit(3);
});
