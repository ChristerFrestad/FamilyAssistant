// Fase F3 — family_profile + filter_usage
//
// Tester:
//   1. GET /api/profile returnerer default-profil
//   2. PUT /api/profile oppdaterer felter
//   3. GET /api/profile/defaults returnerer anbefalinger fra allergier/preferences
//   4. POST /api/profile/filter-usage tracker usage
//   5. GET /api/profile/filter-usage returnerer topp-N

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Fase F3 — family_profile', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('GET /api/profile returnerer tom profil ved oppstart', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/profile');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.members, []);
    assert.deepEqual(r.body.allergies, []);
    assert.deepEqual(r.body.dislikes, []);
    assert.deepEqual(r.body.preferences, {});
  });

  test('PUT /api/profile oppdaterer felter', async () => {
    const r = await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: {
        members: ['Christer', 'Martine'],
        allergies: ['Laktose', 'Nøtter'],
        dislikes: ['Sopp'],
        preferences: { vegetarian: false, quickMeals: true },
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.profile.members, ['Christer', 'Martine']);

    // Verifiser at det faktisk er persistert
    const getR = await request(ctx.baseUrl, 'GET', '/api/profile');
    assert.deepEqual(getR.body.members, ['Christer', 'Martine']);
    assert.deepEqual(getR.body.allergies, ['Laktose', 'Nøtter']);
    assert.equal(getR.body.preferences.quickMeals, true);
  });

  test('PUT /api/profile avviser ugyldige typer', async () => {
    const r = await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: { members: 'ikke en array' },
    });
    assert.equal(r.status, 400);
  });
});

describe('Fase F3 — profile defaults', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('GET /api/profile/defaults returnerer tomt ved ingen profil', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/profile/defaults');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.recommended, []);
    assert.equal(r.body.profile.hasData, false);
  });

  test('GET /api/profile/defaults foreslår basert på allergier', async () => {
    await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: { members: ['A'], allergies: ['Laktose'] },
    });
    const r = await request(ctx.baseUrl, 'GET', '/api/profile/defaults');
    assert.equal(r.status, 200);
    assert.ok(r.body.recommended.includes('laktosefri'), 'laktosefri anbefales');
  });

  test('GET /api/profile/defaults foreslår basert på preferences', async () => {
    await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: {
        members: ['B'],
        preferences: { vegetarian: true, quickMeals: true, familyFriendly: true },
      },
    });
    const r = await request(ctx.baseUrl, 'GET', '/api/profile/defaults');
    assert.equal(r.status, 200);
    assert.ok(r.body.recommended.includes('vegetar'));
    assert.ok(r.body.recommended.includes('rask'));
    assert.ok(r.body.recommended.includes('barnevennlig'));
  });
});

describe('Fase F3 — filter_usage', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('POST /api/profile/filter-usage registrerer bruk', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/profile/filter-usage', {
      body: { filterId: 'vegetar', action: 'enabled' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  test('POST /api/profile/filter-usage avviser ugyldig action', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/profile/filter-usage', {
      body: { filterId: 'vegetar', action: 'foobar' },
    });
    assert.equal(r.status, 400);
  });

  test('POST /api/profile/filter-usage avviser mangler filterId', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/profile/filter-usage', {
      body: { action: 'enabled' },
    });
    assert.equal(r.status, 400);
  });

  test('GET /api/profile/filter-usage returnerer topp-N etter bruk', async () => {
    // Reset-aktig: register usage flere ganger
    for (let i = 0; i < 5; i++) {
      await request(ctx.baseUrl, 'POST', '/api/profile/filter-usage', {
        body: { filterId: 'laktosefri', action: 'enabled' },
      });
    }
    for (let i = 0; i < 3; i++) {
      await request(ctx.baseUrl, 'POST', '/api/profile/filter-usage', {
        body: { filterId: 'rask', action: 'enabled' },
      });
    }
    for (let i = 0; i < 1; i++) {
      await request(ctx.baseUrl, 'POST', '/api/profile/filter-usage', {
        body: { filterId: 'vegetar', action: 'enabled' },
      });
    }

    const r = await request(ctx.baseUrl, 'GET', '/api/profile/filter-usage?limit=3');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.top));
    assert.ok(r.body.top.length > 0);
    // Sortert på enableCount desc
    assert.equal(r.body.top[0].filterId, 'laktosefri');
    assert.ok(r.body.top[0].enableCount >= 5);
  });
});
