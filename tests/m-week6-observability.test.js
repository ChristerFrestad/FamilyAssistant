// Uke 6 observabilitets-tester
//
// Dekker:
//   OBS-1: Grafana-dashboard JSON er gyldig + har 10 nøkkelpaneler
//   OBS-2: alert-rules.yml har 10 regler med severity + runbook-ref
//   OBS-3: sessionCorr + userHint på ctx, X-Session-Correlation-Id-ekko
//   OBS-4: logrotate.conf har rotate 14, gzip, copytruncate
//   OBS-6: backup-restore workflow finnes
//   OBS-7: RUNBOOK §11 har alle 8 alert-runbooks

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, request } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// ============================================================
// OBS-1: Grafana dashboard
// ============================================================
describe('Uke6 · OBS-1 Grafana dashboard', () => {
  const DASH_PATH = path.join(ROOT, 'docs', 'monitoring', 'grafana-dashboard.json');

  test('docs/monitoring/grafana-dashboard.json finnes og er gyldig JSON', () => {
    assert.ok(fs.existsSync(DASH_PATH), 'grafana-dashboard.json mangler');
    const content = fs.readFileSync(DASH_PATH, 'utf8');
    assert.doesNotThrow(() => JSON.parse(content), 'dashboard-JSON må parse');
  });

  test('Dashboard har minst 10 paneler', () => {
    const dash = JSON.parse(fs.readFileSync(DASH_PATH, 'utf8'));
    assert.ok(Array.isArray(dash.panels), 'panels skal være array');
    assert.ok(dash.panels.length >= 10, `forventet >=10 paneler, fant ${dash.panels.length}`);
  });

  test('Dashboard dekker noekkel-metrikker', () => {
    const dash = JSON.parse(fs.readFileSync(DASH_PATH, 'utf8'));
    const allTargets = JSON.stringify(dash.panels);
    // Sjekk at de viktigste prometheus-queryene er referert
    const keyMetrics = [
      'familieass_uptime_seconds',
      'familieass_http_requests_total',
      'familieass_http_errors_total',
      'familieass_http_request_duration_ms',
      'process_resident_memory_bytes',
      'familieass_circuit_breaker_state',
      'familieass_last_backup_age_hours',
      'familieass_disk_free_mb',
      'familieass_db_size_mb',
      'familieass_rate_limit_drops_total',
    ];
    for (const m of keyMetrics) {
      assert.ok(allTargets.includes(m), `dashboard mangler metric ${m}`);
    }
  });

  test('Dashboard har template-variabel for route', () => {
    const dash = JSON.parse(fs.readFileSync(DASH_PATH, 'utf8'));
    assert.ok(dash.templating?.list?.some((t) => t.name === 'route'));
  });
});

// ============================================================
// OBS-2: Alertmanager rules
// ============================================================
describe('Uke6 · OBS-2 alert-rules.yml', () => {
  const RULES_PATH = path.join(ROOT, 'docs', 'monitoring', 'alert-rules.yml');

  test('alert-rules.yml finnes', () => {
    assert.ok(fs.existsSync(RULES_PATH), 'alert-rules.yml mangler');
  });

  test('Har minst 10 alert-regler', () => {
    const yml = fs.readFileSync(RULES_PATH, 'utf8');
    const alertCount = (yml.match(/- alert: /g) || []).length;
    assert.ok(alertCount >= 10, `forventet >=10 alerts, fant ${alertCount}`);
  });

  test('Hver alert har severity og runbook-referanse', () => {
    const yml = fs.readFileSync(RULES_PATH, 'utf8');
    const alertBlocks = yml.split('- alert: ').slice(1);
    for (const block of alertBlocks) {
      const alertName = block.split('\n')[0].trim();
      assert.ok(
        /severity:\s*(critical|warning|info)/.test(block),
        `alert ${alertName} mangler severity`
      );
      assert.ok(
        /runbook:\s*"RUNBOOK\.md §/.test(block),
        `alert ${alertName} mangler runbook-referanse`
      );
    }
  });

  test('Dekker de 8 kritiske alert-kategoriene', () => {
    const yml = fs.readFileSync(RULES_PATH, 'utf8');
    const expectedAlerts = [
      'ServerDown',
      'WatchdogMiss',
      'High5xxRate',
      'CircuitBreakerOpen',
      'HighMemoryUsage',
      'BackupStale',
      'DiskLow',
      'HighP95Latency',
    ];
    for (const alert of expectedAlerts) {
      assert.ok(yml.includes(`- alert: ${alert}`), `alert ${alert} mangler`);
    }
  });
});

// ============================================================
// OBS-3: Structured logging (sessionCorr, userHint)
// ============================================================
describe('Uke6 · OBS-3 structured logging', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('X-Session-Correlation-Id ekkes tilbake i response', async () => {
    const corrId = 'test-session-abc123';
    const res = await request(server.baseUrl, 'GET', '/health', {
      headers: { 'X-Session-Correlation-Id': corrId },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers['x-session-correlation-id'],
      corrId,
      'X-Session-Correlation-Id skal ekkes tilbake'
    );
  });

  test('Uten X-Session-Correlation-Id: header ekkes ikke tilbake', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(
      res.headers['x-session-correlation-id'],
      undefined,
      'X-Session-Correlation-Id skal ikke ekkes når klient ikke sendte den'
    );
  });

  test('X-Request-ID ekkes alltid tilbake', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-request-id'], 'X-Request-ID må alltid ekkes');
  });

  test('middleware.js validerer X-User-Hint regex', () => {
    const js = fs.readFileSync(path.join(ROOT, 'server', 'http', 'middleware.js'), 'utf8');
    assert.ok(js.includes('x-user-hint'), 'X-User-Hint header ikke lest');
    assert.ok(/\[a-zA-Z0-9_-\]\{1,32\}/.test(js), 'X-User-Hint regex-validering mangler');
  });

  test('ctx eksponerer sessionCorr og userHint', () => {
    const js = fs.readFileSync(path.join(ROOT, 'server', 'http', 'middleware.js'), 'utf8');
    assert.ok(js.includes('sessionCorr,'), 'ctx.sessionCorr mangler');
    assert.ok(js.includes('userHint,'), 'ctx.userHint mangler');
  });
});

// ============================================================
// OBS-4: Log rotation
// ============================================================
describe('Uke6 · OBS-4 logrotate.conf', () => {
  const LR_PATH = path.join(ROOT, 'docs', 'monitoring', 'logrotate.conf');

  test('logrotate.conf finnes', () => {
    assert.ok(fs.existsSync(LR_PATH), 'logrotate.conf mangler');
  });

  test('Rotate 14 dager + gzip + copytruncate', () => {
    const conf = fs.readFileSync(LR_PATH, 'utf8');
    assert.ok(/rotate\s+14/.test(conf), 'rotate 14 mangler');
    assert.ok(/compress/.test(conf), 'compress mangler');
    assert.ok(/delaycompress/.test(conf), 'delaycompress mangler');
    assert.ok(/copytruncate/.test(conf), 'copytruncate mangler');
    assert.ok(/maxage\s+14/.test(conf), 'maxage 14 mangler');
  });
});

// ============================================================
// OBS-6: Backup restore CI workflow
// ============================================================
describe('Uke6 · OBS-6 backup restore workflow', () => {
  const WF_PATH = path.join(ROOT, '.github', 'workflows', 'backup-restore.yml');

  test('backup-restore.yml finnes', () => {
    assert.ok(fs.existsSync(WF_PATH), 'backup-restore.yml mangler');
  });

  test('Workflow har ukentlig cron-trigger', () => {
    const yml = fs.readFileSync(WF_PATH, 'utf8');
    assert.ok(/cron:\s*['"]?15\s+3\s+\*\s+\*\s+1/.test(yml), 'weekly cron mangler');
  });

  test('Workflow gjor backup + restore + query canary', () => {
    const yml = fs.readFileSync(WF_PATH, 'utf8');
    assert.ok(yml.includes('backupNow'), 'backupNow ikke kalt');
    assert.ok(yml.includes('restore_marker'), 'canary audit-row mangler');
    assert.ok(yml.includes('uke-6-backup-roundtrip'), 'canary metadata-verdi mangler');
  });
});

// ============================================================
// OBS-7: RUNBOOK alert-runbooks
// ============================================================
describe('Uke6 · OBS-7 RUNBOOK §11 alert-runbooks', () => {
  const RB_PATH = path.join(ROOT, 'RUNBOOK.md');

  test('RUNBOOK.md har §11 Alert runbooks', () => {
    // Updated 2026-05-27: RUNBOOK.md translated to English in PR 4
    // (`docs/analyses/2026-05-27-public-repo-readiness.md` §13 beslutning 2).
    // Heading capitalization changed to "Alert Runbooks"; loosened to
    // case-insensitive match. Policy intent unchanged: §11 must still exist.
    const md = fs.readFileSync(RB_PATH, 'utf8');
    assert.ok(/§11\s+Alert\s+Runbooks/i.test(md), '§11 mangler');
  });

  test('Alle 8 alert-runbooks er dekket (§11.1 - §11.8)', () => {
    const md = fs.readFileSync(RB_PATH, 'utf8');
    for (let n = 1; n <= 8; n++) {
      assert.ok(md.includes(`### §11.${n}`), `§11.${n} mangler`);
    }
  });

  test('Hver alert-runbook har Impact og First-response', () => {
    const md = fs.readFileSync(RB_PATH, 'utf8');
    // Finn §11-seksjonen (fra "## §11 Alert runbooks" og utover)
    const sectionStart = md.indexOf('## §11');
    assert.ok(sectionStart >= 0, '§11 header mangler');
    const section = md.slice(sectionStart);
    const impactCount = (section.match(/\*\*Impact:\*\*/g) || []).length;
    const firstResponseCount = (section.match(/\*\*First-response/g) || []).length;
    assert.ok(impactCount >= 8, `forventet >=8 Impact, fant ${impactCount}`);
    assert.ok(firstResponseCount >= 8, `forventet >=8 First-response, fant ${firstResponseCount}`);
  });
});
