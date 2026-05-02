// M2 reliability-tester (M2.1–M2.3)
//
// Dekker:
//   1. Circuit breaker state-maskin (CLOSED→OPEN→HALF_OPEN→CLOSED)
//   2. Circuit breaker: short-circuits etter failureThreshold
//   3. Circuit breaker: respekterer cooldown før HALF_OPEN
//   4. Circuit breaker: HALF_OPEN-feil → OPEN igjen
//   5. Circuit breaker: suksess i CLOSED resetter failure-teller
//   6. Backup: classifyRemote gjenkjenner mount/ssh/rsync
//   7. Backup: syncToRemote til lokal mount-path (fs.copyFile fallback)
//   8. /api/status eksponerer breaker-snapshot

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startTestServer, request } = require('./helpers');

// ============================================================
// 1. Circuit breaker — state-maskin
// ============================================================
describe('M2.3 · Circuit breaker state machine', () => {
  const { createBreaker, CircuitOpenError } = require('../server/services/circuit-breaker');

  test('CLOSED → OPEN etter failureThreshold feil på rad', async () => {
    const cb = createBreaker({ name: 'test1', failureThreshold: 3, cooldownMs: 1000 });
    assert.equal(cb.state, 'CLOSED');
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        cb.execute(async () => {
          throw new Error('boom');
        }),
        /boom/
      );
    }
    assert.equal(cb.state, 'OPEN');
  });

  test('OPEN short-circuiter uten å kalle fn', async () => {
    const cb = createBreaker({ name: 'test2', failureThreshold: 1, cooldownMs: 10_000 });
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('boom');
      })
    );
    assert.equal(cb.state, 'OPEN');

    let called = false;
    await assert.rejects(
      cb.execute(async () => {
        called = true;
        return 'ok';
      }),
      (err) => err instanceof CircuitOpenError
    );
    assert.equal(called, false, 'fn skal IKKE kalles når OPEN');
    const snap = cb.snapshot();
    assert.ok(snap.totalShortCircuits >= 1);
  });

  test('OPEN → HALF_OPEN når cooldown er utløpt', async () => {
    const cb = createBreaker({ name: 'test3', failureThreshold: 1, cooldownMs: 30 });
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    assert.equal(cb.state, 'OPEN');

    await new Promise((r) => setTimeout(r, 60));
    // Neste execute skal gå over i HALF_OPEN og kalle fn
    const r = await cb.execute(async () => 'ok');
    assert.equal(r, 'ok');
    assert.equal(cb.state, 'CLOSED');
  });

  test('HALF_OPEN-feil → OPEN igjen', async () => {
    const cb = createBreaker({ name: 'test4', failureThreshold: 1, cooldownMs: 20 });
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    assert.equal(cb.state, 'OPEN');

    await new Promise((r) => setTimeout(r, 40));
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('still broken');
      })
    );
    assert.equal(cb.state, 'OPEN', 'HALF_OPEN-feil skal sende oss tilbake til OPEN');
  });

  test('Suksess i CLOSED resetter failure-teller', async () => {
    const cb = createBreaker({ name: 'test5', failureThreshold: 3, cooldownMs: 1000 });
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    // 2 feil, men ikke OPEN ennå
    assert.equal(cb.state, 'CLOSED');
    await cb.execute(async () => 'ok'); // suksess → reset
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    // Fortsatt CLOSED siden telleren ble nullstilt
    assert.equal(cb.state, 'CLOSED');
  });

  test('snapshot() returnerer all relevant state', async () => {
    const cb = createBreaker({ name: 'test6', failureThreshold: 2, cooldownMs: 500 });
    await cb.execute(async () => 'ok');
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    const s = cb.snapshot();
    assert.equal(s.name, 'test6');
    assert.equal(s.state, 'CLOSED');
    assert.equal(s.totalCalls, 2);
    assert.equal(s.totalFailures, 1);
    assert.ok('cooldownMs' in s);
    assert.ok('failureThreshold' in s);
  });

  test('reset() setter tilbake til CLOSED', async () => {
    const cb = createBreaker({ name: 'test7', failureThreshold: 1, cooldownMs: 10_000 });
    await assert.rejects(
      cb.execute(async () => {
        throw new Error('x');
      })
    );
    assert.equal(cb.state, 'OPEN');
    cb.reset();
    assert.equal(cb.state, 'CLOSED');
    const s = cb.snapshot();
    assert.equal(s.failures, 0);
  });

  test('isFailure callback lar breakeren klassifisere non-throw-feil', async () => {
    const cb = createBreaker({
      name: 'test8',
      failureThreshold: 2,
      cooldownMs: 1000,
      isFailure: (r) => r && r.status >= 500,
    });
    await cb.execute(async () => ({ status: 200 })); // ok
    await cb.execute(async () => ({ status: 503 })); // feil
    assert.equal(cb.state, 'CLOSED');
    await cb.execute(async () => ({ status: 500 })); // feil 2
    assert.equal(cb.state, 'OPEN');
  });
});

// ============================================================
// 2. Circuit breaker — shared instances
// ============================================================
describe('M2.3 · Circuit breaker shared instances', () => {
  const {
    getBreaker,
    snapshotAll,
    resetAll,
    breakers,
  } = require('../server/services/circuit-breaker');

  test('getBreaker returnerer alle kjente backends', () => {
    for (const name of ['kassal', 'ollama', 'anthropic', 'openai', 'xai']) {
      const b = getBreaker(name);
      assert.ok(b, `breaker '${name}' skal finnes`);
      assert.ok(typeof b.execute === 'function');
    }
  });

  test('getBreaker returnerer null for ukjent navn', () => {
    assert.equal(getBreaker('ingen-slik-tjeneste'), null);
  });

  test('snapshotAll returnerer status for alle', () => {
    resetAll();
    const snap = snapshotAll();
    assert.ok('kassal' in snap);
    assert.ok('ollama' in snap);
    for (const s of Object.values(snap)) {
      assert.equal(s.state, 'CLOSED');
    }
  });
});

// ============================================================
// 3. Backup — classifyRemote
// ============================================================
describe('M2.1 · Backup classifyRemote', () => {
  const { _classifyRemote } = require('../server/backup');

  test('rsync:// → rsync', () => {
    assert.equal(_classifyRemote('rsync://host/mod'), 'rsync');
    assert.equal(_classifyRemote('rsync://192.168.1.1/backup'), 'rsync');
  });

  test('user@host:/path → ssh', () => {
    assert.equal(_classifyRemote('pi@nas.local:/mnt/backups'), 'ssh');
    assert.equal(_classifyRemote('root@192.168.1.5:/backup'), 'ssh');
  });

  test('absolutt sti → mount', () => {
    assert.equal(_classifyRemote('/mnt/nas/backup'), 'mount');
    assert.equal(_classifyRemote('/tmp/backup'), 'mount');
  });

  test('Windows-sti → mount (default)', () => {
    assert.equal(_classifyRemote('C:\\backup'), 'mount');
  });
});

// ============================================================
// 4. Backup — syncToRemote til mount-path
// ============================================================
describe('M2.1 · Backup syncToRemote (mount)', () => {
  let tmpSrc, tmpDst;

  before(() => {
    tmpSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-backup-src-'));
    tmpDst = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-backup-dst-'));
    fs.writeFileSync(path.join(tmpSrc, 'test.db'), 'DUMMY DB CONTENT');
  });

  after(() => {
    try {
      fs.rmSync(tmpSrc, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(tmpDst, { recursive: true, force: true });
    } catch {}
  });

  test('mount-path: kopierer filen til remote', async () => {
    // Re-load backup.js med ny env-variabel
    const backupPath = require.resolve('../server/backup');
    delete require.cache[backupPath];
    process.env.BACKUP_REMOTE_PATH = tmpDst;
    const { _syncToRemote } = require('../server/backup');

    const src = path.join(tmpSrc, 'test.db');
    const result = await _syncToRemote(src);
    assert.ok(result);

    const copied = path.join(tmpDst, 'test.db');
    assert.ok(fs.existsSync(copied), 'filen skal være kopiert til dst');
    assert.equal(fs.readFileSync(copied, 'utf8'), 'DUMMY DB CONTENT');

    delete process.env.BACKUP_REMOTE_PATH;
    delete require.cache[backupPath];
  });

  test('mount-path: fails when dst does not exist', async () => {
    const backupPath = require.resolve('../server/backup');
    delete require.cache[backupPath];
    process.env.BACKUP_REMOTE_PATH = '/nonexistent/path-that-should-not-exist-' + Date.now();
    const { _syncToRemote } = require('../server/backup');

    const src = path.join(tmpSrc, 'test.db');
    await assert.rejects(_syncToRemote(src), /does not exist/);

    delete process.env.BACKUP_REMOTE_PATH;
    delete require.cache[backupPath];
  });
});

// ============================================================
// 5. /api/status eksponerer breaker-snapshot
// ============================================================
describe('M2 · /api/status med breakers', () => {
  let server;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    if (server) await server.close();
  });

  test('/api/status inneholder breakers-snapshot', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.breakers, 'breakers skal være i /api/status-responsen');
    assert.ok('kassal' in res.body.breakers);
    assert.ok('ollama' in res.body.breakers);
    for (const name of ['kassal', 'ollama']) {
      const b = res.body.breakers[name];
      assert.ok(['CLOSED', 'OPEN', 'HALF_OPEN'].includes(b.state));
      assert.ok(typeof b.totalCalls === 'number');
    }
  });
});
