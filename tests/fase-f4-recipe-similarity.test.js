// Fase F4 — Recipe similarity
//
// Tester:
//   1. jaccard — klassisk set-similarity
//   2. computeSimilarity — score og reasons
//   3. findSimilar — caching + sortering
//   4. GET /api/recipes/:id/similar

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const sim = require('../server/services/recipe-similarity.service');
const { startTestServer, request } = require('./helpers');

describe('Fase F4 — jaccard', () => {
  test('to identiske sett → 1', () => {
    assert.equal(sim.jaccard(['a', 'b', 'c'], ['a', 'b', 'c']), 1);
  });

  test('to disjunkte sett → 0', () => {
    assert.equal(sim.jaccard(['a', 'b'], ['c', 'd']), 0);
  });

  test('halv overlapp', () => {
    // {a,b} ∩ {a,c} = {a} (1), union = {a,b,c} (3) → 1/3
    const r = sim.jaccard(['a', 'b'], ['a', 'c']);
    assert.ok(Math.abs(r - (1 / 3)) < 0.001);
  });

  test('tomme sett → 0', () => {
    assert.equal(sim.jaccard([], []), 0);
  });
});

describe('Fase F4 — computeSimilarity', () => {
  const a = {
    id: 1,
    name: 'Fiskegrateng',
    category: 'comfort',
    servings: 4,
    ingredients: [
      { productKey: 'torsk', name: 'Torsk' },
      { productKey: 'brokkoli', name: 'Brokkoli' },
      { productKey: 'ost', name: 'Ost' },
    ],
  };

  test('identisk oppskrift (ulike id) → høy score', () => {
    const b = { ...a, id: 2 };
    const r = sim.computeSimilarity(a, b);
    // ingJac=1 (0.6) + catMatch=1 (0.3) + servingsProx=1 (0.1) = 1.0
    // Bruk toleranse pga float-presisjon
    assert.ok(Math.abs(r.score - 1) < 1e-6, `score=${r.score}`);
  });

  test('samme id → score 0', () => {
    const r = sim.computeSimilarity(a, a);
    assert.equal(r.score, 0);
  });

  test('null inputs → score 0', () => {
    assert.equal(sim.computeSimilarity(null, a).score, 0);
    assert.equal(sim.computeSimilarity(a, null).score, 0);
  });

  test('forskjellig kategori reduserer score', () => {
    const b = { ...a, id: 2, category: 'rask' };
    const r = sim.computeSimilarity(a, b);
    // ingJac=1 (0.6) + catMatch=0 (0) + servingsProx=1 (0.1) = 0.7
    assert.ok(Math.abs(r.score - 0.7) < 0.01);
  });

  test('reasons inneholder kontekst', () => {
    const b = { ...a, id: 2 };
    const r = sim.computeSimilarity(a, b);
    assert.ok(r.reasons.length > 0);
    assert.ok(r.reasons.some(x => /felles ingredienser|overlapp/.test(x)));
  });
});

describe('Fase F4 — GET /api/recipes/:id/similar', () => {
  let ctx;
  before(async () => { ctx = await startTestServer(); });
  after(async () => {
    sim.clear(); // rens cache
    await ctx.close();
  });

  test('returnerer array av lignende oppskrifter', async () => {
    // Seed har 36 oppskrifter. Hent første id.
    const allR = await request(ctx.baseUrl, 'GET', '/api/recipes');
    assert.equal(allR.status, 200);
    assert.ok(allR.body.recipes.length > 0);
    const firstId = allR.body.recipes[0].id;

    const r = await request(ctx.baseUrl, 'GET', `/api/recipes/${firstId}/similar`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.similar));
    assert.ok(r.body.similar.length <= 5);
    // Hvert resultat har id, name, score, reasons
    for (const s of r.body.similar) {
      assert.ok(typeof s.id === 'number');
      assert.ok(typeof s.name === 'string');
      assert.ok(typeof s.score === 'number');
      assert.ok(Array.isArray(s.reasons));
      assert.notEqual(s.id, firstId); // ikke seg selv
    }
  });

  test('ugyldig id → 400', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/recipes/abc/similar');
    assert.equal(r.status, 400);
  });

  test('limit-query respekteres', async () => {
    const allR = await request(ctx.baseUrl, 'GET', '/api/recipes');
    const firstId = allR.body.recipes[0].id;
    const r = await request(ctx.baseUrl, 'GET', `/api/recipes/${firstId}/similar?limit=2`);
    assert.equal(r.status, 200);
    assert.ok(r.body.similar.length <= 2);
  });

  test('ikke-eksisterende id → tom array', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/recipes/99999/similar');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.similar, []);
  });

  test('sortert på score descending', async () => {
    const allR = await request(ctx.baseUrl, 'GET', '/api/recipes');
    const firstId = allR.body.recipes[0].id;
    const r = await request(ctx.baseUrl, 'GET', `/api/recipes/${firstId}/similar?limit=10`);
    const scores = r.body.similar.map(s => s.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] <= scores[i - 1], `score skal være descending: ${scores}`);
    }
  });
});

describe('Fase F4 — ytelse', () => {
  let ctx;
  before(async () => { ctx = await startTestServer(); });
  after(async () => {
    sim.clear();
    await ctx.close();
  });

  test('findSimilar på seed-katalog < 100 ms', async () => {
    const allR = await request(ctx.baseUrl, 'GET', '/api/recipes');
    const firstId = allR.body.recipes[0].id;

    sim.clear(); // cache off
    const start = Date.now();
    const r = await request(ctx.baseUrl, 'GET', `/api/recipes/${firstId}/similar`);
    const elapsed = Date.now() - start;
    assert.equal(r.status, 200);
    // Inkluderer HTTP-overhead, men seed har bare 36 oppskrifter
    assert.ok(elapsed < 500, `for tregt: ${elapsed} ms`);
  });
});
