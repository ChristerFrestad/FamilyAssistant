// Integration- og unit-tester for iterasjon 1:
//   - state-snapshot persistering (metrics)
//   - pantry-service (manual add, correct, expired cleanup)
//   - price-reference service (CPI-indeksering, lookup)
//   - nye HTTP-ruter (/api/pantry/*, /api/prices/*)

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
// Pantry service
// ============================================================

describe('pantry.service', () => {
  test('addToPantry oppretter log-rad og oppdaterer inventory', async () => {
    const pantry = require('../server/services/pantry.service');
    const { repos } = server;

    const before = repos.inventory.getByKey('test-vare-001');
    assert.equal(before, null);

    const result = pantry.addToPantry(repos, {
      productKey: 'test-vare-001',
      qty: 3,
      unit: 'stk',
      shelfDays: 7,
      notes: 'lagt til manuelt',
    });

    assert.equal(result.productKey, 'test-vare-001');
    assert.equal(result.qtyRemaining, 3);
    assert.ok(result.expiresEst);

    const inv = repos.inventory.getByKey('test-vare-001');
    assert.ok(inv);
    assert.equal(inv.qtyRemaining, 3);

    const log = repos.inventoryLog.getByKey('test-vare-001');
    assert.equal(log.length, 1);
    assert.equal(log[0].reason, 'manual');
    assert.equal(log[0].qtyDelta, 3);
    assert.equal(log[0].newQty, 3);
  });

  test('addToPantry kumulerer mengde ved gjentatt kall', () => {
    const pantry = require('../server/services/pantry.service');
    const { repos } = server;

    pantry.addToPantry(repos, { productKey: 'test-vare-002', qty: 2, unit: 'kg' });
    pantry.addToPantry(repos, { productKey: 'test-vare-002', qty: 1.5, unit: 'kg' });

    const inv = repos.inventory.getByKey('test-vare-002');
    assert.equal(inv.qtyRemaining, 3.5);

    const log = repos.inventoryLog.getByKey('test-vare-002');
    assert.equal(log.length, 2);
  });

  test('correctQty lagrer både positiv og negativ delta', () => {
    const pantry = require('../server/services/pantry.service');
    const { repos } = server;

    pantry.addToPantry(repos, { productKey: 'test-vare-003', qty: 10 });
    pantry.correctQty(repos, { productKey: 'test-vare-003', newQty: 4 });

    const inv = repos.inventory.getByKey('test-vare-003');
    assert.equal(inv.qtyRemaining, 4);

    const log = repos.inventoryLog.getByKey('test-vare-003');
    const correction = log.find(l => l.reason === 'correction');
    assert.ok(correction);
    assert.equal(correction.qtyDelta, -6);
    assert.equal(correction.newQty, 4);
  });

  test('removeExpired fjerner varer med expiresEst i fortiden', () => {
    const pantry = require('../server/services/pantry.service');
    const { repos } = server;

    // Tving en vare til å ha utløpt dato i går
    pantry.addToPantry(repos, { productKey: 'test-vare-004', qty: 5, unit: 'stk' });
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    repos._db.prepare('UPDATE inventory SET expires_est = ? WHERE product_key = ?')
      .run(yesterday, 'test-vare-004');

    const removed = pantry.removeExpired(repos);
    assert.ok(removed >= 1);

    const inv = repos.inventory.getByKey('test-vare-004');
    assert.equal(inv.qtyRemaining, 0);

    const log = repos.inventoryLog.getByKey('test-vare-004');
    const expired = log.find(l => l.reason === 'shelf_life_expired');
    assert.ok(expired);
    assert.equal(expired.qtyDelta, -5);
  });

  test('estimateShelfDays bruker produkt.shelfDays hvis tilgjengelig', () => {
    const { estimateShelfDays } = require('../server/services/pantry.service');
    assert.equal(estimateShelfDays({ shelfDays: 42 }), 42);
    assert.equal(estimateShelfDays({ category: 'Meieri' }), 10);
    assert.equal(estimateShelfDays(null), 14);
  });
});

// ============================================================
// Price-reference service
// ============================================================

describe('price-reference.service', () => {
  test('cpiMultiplier er 1 for ferske rader, større for gamle', () => {
    const { cpiMultiplier } = require('../server/services/price-reference.service');
    assert.equal(cpiMultiplier(0), 1);
    const oneYear = cpiMultiplier(365);
    assert.ok(oneYear > 1.03 && oneYear < 1.04); // ~3.5%
    const twoYears = cpiMultiplier(730);
    assert.ok(twoYears > oneYear);
  });

  test('lookupPrice returnerer null hvis ingen referanse', () => {
    const { lookupPrice } = require('../server/services/price-reference.service');
    const { repos } = server;
    const res = lookupPrice(repos, 'finnes-ikke-xyz');
    assert.equal(res, null);
  });

  test('lookupPrice returnerer fersk rad uendret, markerer indeksert ved alder', () => {
    const { lookupPrice } = require('../server/services/price-reference.service');
    const { repos } = server;

    repos.priceReferences.upsert({
      productKey: 'test-melk',
      productName: 'Test-melk',
      currentPrice: 20,
      store: 'Kiwi',
      source: 'seed',
      confidence: 1.0,
    });

    const fresh = lookupPrice(repos, 'test-melk');
    assert.ok(fresh);
    assert.equal(fresh.price, 20);
    assert.equal(fresh.indexed, false);
    assert.equal(fresh.stale, false);

    // Tving raden til å være 180 dager gammel
    const oldDate = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    repos._db.prepare(`UPDATE price_references SET last_verified = ? WHERE product_key = ?`)
      .run(oldDate, 'test-melk');

    const indexed = lookupPrice(repos, 'test-melk');
    assert.ok(indexed.price > 20);
    assert.equal(indexed.indexed, true);
    assert.ok(indexed.confidence <= 0.7);
  });

  test('applyCpiIndexing oppdaterer gamle rader og skriver price_history', () => {
    const { applyCpiIndexing } = require('../server/services/price-reference.service');
    const { repos } = server;

    // Opprett rad med 400 dagers alder
    repos.priceReferences.upsert({
      productKey: 'test-brod',
      productName: 'Test-brød',
      currentPrice: 30,
      store: 'Rema',
      source: 'seed',
      confidence: 1.0,
    });
    const oldDate = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    repos._db.prepare(`UPDATE price_references SET last_verified = ? WHERE product_key = ?`)
      .run(oldDate, 'test-brod');

    const beforeRow = repos.priceReferences.getBest('test-brod');
    const beforePrice = beforeRow.currentPrice;

    const n = applyCpiIndexing(repos, { olderThanDays: 90 });
    assert.ok(n >= 1);

    const afterRow = repos.priceReferences.getBest('test-brod');
    assert.ok(afterRow.currentPrice > beforePrice);
    assert.equal(afterRow.confidence, 0.7);

    const hist = repos.priceHistory.getForRef(afterRow.id);
    assert.ok(hist.length >= 1);
    assert.equal(hist[0].source, 'cpi_index');
  });

  test('estimatePantryValue aggregerer kjente priser', () => {
    const { estimatePantryValue } = require('../server/services/price-reference.service');
    const pantry = require('../server/services/pantry.service');
    const { repos } = server;

    // Rydd opp
    repos._db.prepare('DELETE FROM inventory').run();

    pantry.addToPantry(repos, { productKey: 'test-melk', qty: 1 });
    pantry.addToPantry(repos, { productKey: 'finnes-ikke', qty: 1 });

    const v = estimatePantryValue(repos);
    assert.ok(v.itemsKnown >= 1);
    assert.ok(v.itemsUnknown >= 1);
    assert.ok(v.totalEstimated > 0);
  });
});

// ============================================================
// Nye HTTP-ruter
// ============================================================

describe('HTTP: /api/pantry/*', () => {
  test('POST /api/pantry/add legger til og returnerer item', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: 'http-test-1', qty: 2, unit: 'stk', shelfDays: 10 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.item.productKey, 'http-test-1');
    assert.equal(res.body.item.qtyRemaining, 2);
  });

  test('POST /api/pantry/add rejects invalid body', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/pantry/add', {
      body: { qty: -1 },
    });
    assert.equal(res.status, 400);
  });

  test('PUT /api/pantry/correct oppdaterer mengde', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'http-test-1', newQty: 0.5 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.newQty, 0.5);
  });

  test('GET /api/pantry/log returnerer audit-log', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/pantry/log?productKey=http-test-1');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.log));
    assert.ok(res.body.log.length >= 2); // add + correct
    assert.ok(typeof res.body.counts === 'object');
  });

  test('GET /api/pantry/value returnerer estimat', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/pantry/value');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.totalEstimated === 'number');
    assert.ok(typeof res.body.itemsKnown === 'number');
  });
});

describe('HTTP: /api/prices/*', () => {
  test('GET /api/prices/lookup krever productKey eller ean', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/prices/lookup');
    assert.equal(res.status, 400);
  });

  test('GET /api/prices/lookup returnerer found=false for ukjent', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/prices/lookup?productKey=finnes-absolutt-ikke');
    assert.equal(res.status, 200);
    assert.equal(res.body.found, false);
  });

  test('GET /api/prices/lookup returnerer found=true for kjent', async () => {
    const { repos } = server;
    repos.priceReferences.upsert({
      productKey: 'http-test-melk',
      productName: 'HTTP-test melk',
      currentPrice: 25,
      store: 'Kiwi',
      source: 'seed',
      confidence: 1.0,
    });
    const res = await request(server.baseUrl, 'GET', '/api/prices/lookup?productKey=http-test-melk');
    assert.equal(res.status, 200);
    assert.equal(res.body.found, true);
    assert.equal(res.body.price, 25);
  });

  test('GET /api/prices/search returnerer treff', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/prices/search?q=melk');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.results));
  });

  test('GET /api/prices/stats returnerer aggregater', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/prices/stats');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.total === 'number');
  });
});

// ============================================================
// State-snapshot
// ============================================================

describe('state-snapshot', () => {
  test('snapshotOne skriver rad til DB for metrics', () => {
    const stateSnap = require('../server/state-snapshot');
    const metrics = require('../server/http/metrics');
    const { repos } = server;

    metrics.reset();
    metrics.record('GET', '/api/snap', 200, 15);
    metrics.record('GET', '/api/snap', 200, 25);

    const ok = stateSnap.snapshotOne(repos, 'metrics');
    assert.equal(ok, true);

    const row = repos.stateSnapshots.getLatest('metrics');
    assert.ok(row);
    const data = JSON.parse(row.dataJson);
    assert.equal(data.version, 1);
    assert.equal(data.totalRequests, 2);
    assert.ok(Array.isArray(data.routes));
  });

  test('trimToLast beholder kun 2 siste rader', () => {
    const stateSnap = require('../server/state-snapshot');
    const { repos } = server;

    for (let i = 0; i < 5; i++) {
      stateSnap.snapshotOne(repos, 'metrics');
    }
    const rows = repos.stateSnapshots.getAllForType('metrics');
    assert.ok(rows.length <= 2, `Forventet maks 2 rader, fikk ${rows.length}`);
  });

  test('restoreOne leser tilbake metrics etter reset', () => {
    const stateSnap = require('../server/state-snapshot');
    const metrics = require('../server/http/metrics');
    const { repos } = server;

    metrics.reset();
    metrics.record('GET', '/api/restore', 200, 7);
    metrics.record('POST', '/api/restore', 201, 12);
    stateSnap.snapshotOne(repos, 'metrics');

    // Simuler en "restart" ved å nullstille metrics
    metrics.reset();
    assert.equal(metrics.snapshot().totalRequests, 0);

    // Rehydrer
    const ok = stateSnap.restoreOne(repos, 'metrics');
    assert.equal(ok, true);

    const snap = metrics.snapshot();
    assert.equal(snap.totalRequests, 2);
    const restoreRoute = snap.routes.find(r => r.route.includes('/api/restore'));
    assert.ok(restoreRoute);
  });

  test('restoreOne hopper over rader eldre enn 72 timer', () => {
    const stateSnap = require('../server/state-snapshot');
    const metrics = require('../server/http/metrics');
    const { repos } = server;

    // Rydd snapshots og skriv én gammel rad manuelt
    repos._db.prepare("DELETE FROM state_snapshots WHERE type = 'metrics'").run();
    const veryOld = new Date(Date.now() - 100 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const json = JSON.stringify({ version: 1, totalRequests: 42, totalErrors: 0, routes: [] });
    repos._db.prepare(`
      INSERT INTO state_snapshots (type, data_json, created_at) VALUES ('metrics', ?, ?)
    `).run(json, veryOld);

    metrics.reset();
    const ok = stateSnap.restoreOne(repos, 'metrics');
    assert.equal(ok, false, 'Stale snapshot skal ikke rehydreres');
    assert.equal(metrics.snapshot().totalRequests, 0);
  });
});
