// Uke 5 performance tests
//
// Dekker:
//   PERF-1: perf-baseline.json struktur + feltnavn
//   PERF-3: audit_log getRecent/getByEntity bruker timestamp-index
//   PERF-4: Memory budget warning i /ready
//   PERF-5: /api/llm/warm endpoint returnerer ok + entriesAfter
//   load-baseline.js CLI har --output, --compare, --allowRegressionPct

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, request } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// ============================================================
// PERF-1: Baseline JSON struktur
// ============================================================
describe('Uke5 · PERF-1 perf-baseline.json', () => {
  test('perf-baseline.json finnes i repo-rot', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'perf-baseline.json')), 'perf-baseline.json mangler');
  });

  test('perf-baseline.json har forventet struktur', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'perf-baseline.json'), 'utf8'));
    const requiredFields = [
      'generatedAt',
      'profile',
      'totalRequests',
      'rps',
      'global',
      'perEndpoint',
      'grade',
      'gradeOk',
    ];
    for (const f of requiredFields) {
      assert.ok(f in baseline, `baseline.${f} mangler`);
    }
    assert.ok(
      ['p50', 'p95', 'p99'].every((p) => p in baseline.global),
      'baseline.global mangler p50/p95/p99'
    );
    assert.ok(
      Object.keys(baseline.perEndpoint).length > 0,
      'baseline.perEndpoint må ha minst ett endpoint'
    );
  });

  test('perf-baseline.json p95 er under SLO-terskel 200ms', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'perf-baseline.json'), 'utf8'));
    assert.ok(
      baseline.global.p95 < 200,
      `baseline p95 ${baseline.global.p95}ms overskrider SLO 200ms`
    );
  });
});

// ============================================================
// PERF-2: load-baseline.js CLI utvidelser
// ============================================================
describe('Uke5 · PERF-2 load-baseline.js CLI', () => {
  test('scripts/load-baseline.js har --output flag', () => {
    const js = fs.readFileSync(path.join(ROOT, 'scripts', 'load-baseline.js'), 'utf8');
    assert.ok(js.includes('--output'), '--output flag mangler i load-baseline.js');
    assert.ok(js.includes('--compare'), '--compare flag mangler');
    assert.ok(js.includes('allowRegressionPct'), '--allowRegressionPct flag mangler');
  });

  test('load-baseline.js skriver JSON-result med perEndpoint', () => {
    const js = fs.readFileSync(path.join(ROOT, 'scripts', 'load-baseline.js'), 'utf8');
    assert.ok(js.includes('perEndpoint:'), 'perEndpoint felt mangler i JSON-output');
    assert.ok(js.includes('gradeOk:'), 'gradeOk felt mangler');
  });

  test('performance.yml workflow finnes', () => {
    const p = path.join(ROOT, '.github', 'workflows', 'performance.yml');
    assert.ok(fs.existsSync(p), 'performance.yml mangler');
    const yml = fs.readFileSync(p, 'utf8');
    assert.ok(yml.includes('load-baseline'), 'workflow mangler load-baseline job');
    assert.ok(yml.includes('--compare=perf-baseline.json'), 'workflow må sammenligne mot baseline');
    // Baseline is locally captured; we tolerate CI-runner variance up to
    // ~75% on sub-ms paths. Accept any integer in [20, 100] so the
    // threshold can be tuned without ceremony when runner variance
    // shifts.
    const match = /--allowRegressionPct=(\d+)/.exec(yml);
    assert.ok(match, 'workflow mangler --allowRegressionPct flag');
    const pct = Number(match[1]);
    assert.ok(pct >= 20 && pct <= 100, `regression threshold (${pct}%) må være mellom 20 og 100`);
  });
});

// ============================================================
// PERF-3: audit_log bruker timestamp index
// ============================================================
describe('Uke5 · PERF-3 audit_log ORDER BY optimalisering', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('auditLog.getRecent bruker timestamp DESC, id DESC', () => {
    // Statisk sjekk i repositories.js — se etter alle ORDER BY-strenger
    // innenfor auditLog-objektet
    const js = fs.readFileSync(path.join(ROOT, 'server', 'repositories', 'system.repo.js'), 'utf8');
    const auditLogStart = js.indexOf('const auditLog = {');
    assert.ok(auditLogStart > 0, 'auditLog repository mangler');
    // Ta resten av filen fra auditLog-start
    const auditLogSection = js.slice(auditLogStart, auditLogStart + 5000);
    const orderBys = auditLogSection.match(/ORDER BY [^\n]+/g) || [];
    // Tell hvor mange av read-path-spørringene (getRecent, 2x getByEntity)
    // som bruker 'timestamp DESC'. stats()-aggregering bruker 'ORDER BY c DESC'
    // og er legitim (count-basert sortering), så vi teller bare at minst 3
    // av ORDER BY-strengene starter med 'timestamp DESC, id DESC'.
    const timestampOrderBys = orderBys.filter((o) => /timestamp DESC,\s*id DESC/.test(o));
    assert.ok(
      timestampOrderBys.length >= 3,
      `auditLog må ha minst 3 "ORDER BY timestamp DESC, id DESC" (getRecent + 2x getByEntity), fant ${timestampOrderBys.length}`
    );
  });

  test('auditLog fungerer korrekt etter index-optimalisering', () => {
    for (let i = 0; i < 5; i++) {
      server.repos.auditLog.record({
        requestId: `perf-r${i}`,
        action: 'DELETE',
        entityType: 'perf_test',
        entityId: i,
        route: '/x',
      });
    }
    const rows = server.repos.auditLog.getRecent(10);
    assert.ok(rows.length >= 5);
    const perfRows = rows.filter((r) => r.entityType === 'perf_test');
    assert.equal(perfRows.length, 5);
    // Sjekk at rekkefølgen er DESC
    for (let i = 1; i < perfRows.length; i++) {
      assert.ok(
        perfRows[i].id <= perfRows[i - 1].id,
        'audit_log getRecent må returnere DESC rekkefølge'
      );
    }
    server.repos._db.prepare('DELETE FROM audit_log WHERE entity_type = ?').run('perf_test');
  });
});

// ============================================================
// PERF-4: Memory budget warning i /ready
// ============================================================
describe('Uke5 · PERF-4 memory budget i /ready', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('/ready returnerer rssMB og memoryBudgetMB', async () => {
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.rssMB === 'number', 'rssMB mangler eller er ikke number');
    assert.ok(res.body.rssMB > 0, `rssMB må være positiv, fikk ${res.body.rssMB}`);
    assert.ok(
      typeof res.body.memoryBudgetMB === 'number',
      'memoryBudgetMB mangler eller er ikke number'
    );
    assert.ok(res.body.memoryBudgetMB >= 128, 'memoryBudgetMB default bør være >=128');
  });

  test('config.MEMORY_BUDGET_MB default er 512', () => {
    const js = fs.readFileSync(path.join(ROOT, 'server', 'config.js'), 'utf8');
    assert.ok(
      /MEMORY_BUDGET_MB[\s\S]*?\.default\(512\)/.test(js),
      'MEMORY_BUDGET_MB default 512 mangler'
    );
  });
});

// ============================================================
// PERF-5: /api/llm/warm endpoint
// ============================================================
describe('Uke5 · PERF-5 LLM cache warm endpoint', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('POST /api/llm/warm returnerer entriesBefore, pruned, entriesAfter', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/llm/warm');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.entriesBefore === 'number', 'entriesBefore mangler');
    assert.ok(typeof res.body.pruned === 'number', 'pruned mangler');
    assert.ok(typeof res.body.entriesAfter === 'number', 'entriesAfter mangler');
    assert.ok(typeof res.body.totalHits === 'number', 'totalHits mangler');
    assert.ok(res.body.note, 'note-felt mangler');
  });

  test('GET /api/llm/cache/stats returnerer entries og totalHits', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/llm/cache/stats');
    assert.equal(res.status, 200);
    assert.ok('entries' in res.body, 'stats.entries mangler');
    assert.ok('totalHits' in res.body, 'stats.totalHits mangler');
  });
});

// ============================================================
// PERF-7: SLO dokumentasjon i RUNBOOK.md
// ============================================================
describe('Uke5 · PERF-7 SLO i RUNBOOK', () => {
  test('RUNBOOK.md har §10 SLO-seksjon', () => {
    const md = fs.readFileSync(path.join(ROOT, 'RUNBOOK.md'), 'utf8');
    assert.ok(/§10\s+Service Level Objectives/i.test(md), 'SLO §10 mangler');
    assert.ok(/Latency-m[aå]l/.test(md), 'Latency-mål tabell mangler');
    assert.ok(/Resource-m[aå]l/.test(md), 'Resource-mål tabell mangler');
  });

  test('RUNBOOK.md SLO nevner MEMORY_BUDGET_MB', () => {
    const md = fs.readFileSync(path.join(ROOT, 'RUNBOOK.md'), 'utf8');
    assert.ok(md.includes('MEMORY_BUDGET_MB'), 'MEMORY_BUDGET_MB ikke dokumentert');
  });

  test('DB_INDEXES.md finnes og dekker audit_log fix', () => {
    const p = path.join(ROOT, 'docs', 'DB_INDEXES.md');
    assert.ok(fs.existsSync(p), 'docs/DB_INDEXES.md mangler');
    const md = fs.readFileSync(p, 'utf8');
    assert.ok(/audit_log/i.test(md), 'DB_INDEXES.md nevner ikke audit_log');
    assert.ok(/PERF-3/.test(md), 'DB_INDEXES.md refererer ikke PERF-3 fix');
  });
});
