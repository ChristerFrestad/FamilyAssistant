// Fase F2 — Mengde med enhet og total + lav-terskel-trigger
//
// Tester:
//   1. units.js — validering, ratio, isLowStock
//   2. addToPantry med total + unit → lagres korrekt
//   3. correctQty med newTotal + newUnit
//   4. Lav-beholdning auto-trigger til handleliste
//   5. GET /api/pantry returnerer ratio og isLow

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const units = require('../server/services/units');
const { startTestServer, request } = require('./helpers');

describe('Fase F2 — units.js', () => {
  test('validateUnit godtar whitelist', () => {
    for (const u of ['g', 'kg', 'ml', 'dl', 'l', 'stk']) {
      assert.equal(units.validateUnit(u), u);
    }
  });

  test('validateUnit avviser ugyldige', () => {
    assert.throws(() => units.validateUnit('oz'), /Ugyldig enhet/);
    assert.throws(() => units.validateUnit('pound'), /Ugyldig enhet/);
    assert.throws(() => units.validateUnit('cup'), /Ugyldig enhet/);
  });

  test('validateUnit faller tilbake til "stk" for tom/null', () => {
    // Tom/null normaliserer til default 'stk' som er gyldig
    assert.equal(units.validateUnit(''), 'stk');
    assert.equal(units.validateUnit(null), 'stk');
    assert.equal(units.validateUnit(undefined), 'stk');
  });

  test('normalizeUnit mapper aliaser', () => {
    assert.equal(units.normalizeUnit('gram'), 'g');
    assert.equal(units.normalizeUnit('GR'), 'g');
    assert.equal(units.normalizeUnit('liter'), 'l');
    assert.equal(units.normalizeUnit('stykker'), 'stk');
  });

  test('calculateRatio beregner riktig', () => {
    assert.equal(units.calculateRatio(300, 1000), 0.3);
    assert.equal(units.calculateRatio(500, 500), 1);
    assert.equal(units.calculateRatio(0, 1000), 0);
  });

  test('calculateRatio håndterer edge-cases', () => {
    assert.equal(units.calculateRatio(100, 0), null);
    assert.equal(units.calculateRatio(100, null), null);
    assert.equal(units.calculateRatio(null, 100), null);
    // Clamping: qty > total → 1
    assert.equal(units.calculateRatio(2000, 1000), 1);
  });

  test('isLowStock bruker 15% default-terskel', () => {
    assert.equal(units.isLowStock(10, 100), true);   // 10% < 15%
    assert.equal(units.isLowStock(14, 100), true);   // 14% < 15%
    assert.equal(units.isLowStock(15, 100), false);  // eksakt 15% er IKKE < 15%
    assert.equal(units.isLowStock(50, 100), false);
    assert.equal(units.isLowStock(100, null), null); // ingen total → null
  });

  test('isLowStock med custom terskel', () => {
    assert.equal(units.isLowStock(20, 100, 0.25), true);  // 20% < 25%
    assert.equal(units.isLowStock(30, 100, 0.25), false);
  });
});

describe('Fase F2 — addToPantry med total + unit', () => {
  let ctx;
  before(async () => { ctx = await startTestServer(); });
  after(async () => { await ctx.close(); });

  test('add med total og unit lagres og returneres av GET /api/pantry', async () => {
    const addR = await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Test Milk F2', qty: 300, total: 1000, unit: 'ml' },
    });
    assert.equal(addR.status, 200);
    assert.equal(addR.body.ok, true);

    const listR = await request(ctx.baseUrl, 'GET', '/api/pantry');
    assert.equal(listR.status, 200);
    const item = listR.body.items.find(i => i.productKey === 'test-milk-f2');
    assert.ok(item, 'vara finnes i pantry-listen');
    assert.equal(item.quantity, 300);
    assert.equal(item.total, 1000);
    assert.equal(item.unit, 'ml');
    assert.equal(item.ratio, 0.3);
    assert.equal(item.isLow, false);
  });

  test('add med ugyldig unit → 400', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Ugyldig Enhet F2', qty: 1, unit: 'pound' },
    });
    assert.equal(r.status, 400);
  });
});

describe('Fase F2 — correctQty med newTotal + newUnit', () => {
  let ctx;
  before(async () => { ctx = await startTestServer(); });
  after(async () => { await ctx.close(); });

  test('correctQty kan sette ny total og unit', async () => {
    // Først: legg til en vare
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Correct F2', qty: 500, total: 1000, unit: 'g' },
    });
    // Korrigér til 200 av 800 g
    const corR = await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'correct-f2', newQty: 200, newTotal: 800, newUnit: 'g' },
    });
    assert.equal(corR.status, 200);

    // Verifiser
    const listR = await request(ctx.baseUrl, 'GET', '/api/pantry');
    const item = listR.body.items.find(i => i.productKey === 'correct-f2');
    assert.ok(item);
    assert.equal(item.quantity, 200);
    assert.equal(item.total, 800);
    assert.equal(item.unit, 'g');
    assert.equal(item.ratio, 0.25);
  });

  test('correctQty med ugyldig newUnit → 400', async () => {
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Bad Unit F2', qty: 1 },
    });
    const r = await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'bad-unit-f2', newQty: 1, newUnit: 'invalid' },
    });
    assert.equal(r.status, 400);
  });
});

describe('Fase F2 — Lav-beholdning auto-trigger', () => {
  let ctx;
  before(async () => { ctx = await startTestServer(); });
  after(async () => { await ctx.close(); });

  test('correctQty under 15% trigger-respons inneholder lowStock-info', async () => {
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Low Trigger F2', qty: 1000, total: 1000, unit: 'g' },
    });
    // Reduser til 50 av 1000 (5% → under 15%)
    const r = await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'low-trigger-f2', newQty: 50 },
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.lowStock, 'lowStock-info er i responsen');
    // Kan være triggered=true eller no-active-list avhengig av om test-server har aktiv shopping-list
    assert.ok(typeof r.body.lowStock.triggered === 'boolean');
  });

  test('correctQty over 15% gir triggered=false', async () => {
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'High Trigger F2', qty: 800, total: 1000, unit: 'g' },
    });
    const r = await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'high-trigger-f2', newQty: 500 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.lowStock.triggered, false);
  });
});
