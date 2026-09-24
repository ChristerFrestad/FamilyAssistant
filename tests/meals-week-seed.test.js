// Locks Option A: GET /api/meals/week/:weekYear must seed THAT week
// (not only ensureCurrentWeek then return an empty future).

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');
const { getWeekYear } = require('../server/seed');

describe('Meals week seed — requested weekYear', () => {
  let ctx;
  let currentWeek;
  let nextWeek;

  before(async () => {
    ctx = await startTestServer();
    currentWeek = getWeekYear();
    // Derive a week that is definitely not the current one.
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 14);
    nextWeek = getWeekYear(new Date(d));
    assert.notEqual(nextWeek, currentWeek, 'fixture needs a non-current week');
  });

  after(async () => {
    await ctx.close();
  });

  test('GET /api/meals/week/:future seeds that week with 7 slots', async () => {
    const before = await request(ctx.baseUrl, 'GET', `/api/meals/week/${nextWeek}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.weekYear, nextWeek);
    assert.equal(before.body.meals.length, 7, 'seeded week must have 7 dinner slots');
    // Exists in DB now — second call is idempotent.
    const again = await request(ctx.baseUrl, 'GET', `/api/meals/week/${nextWeek}`);
    assert.equal(again.status, 200);
    assert.equal(again.body.meals.length, 7);
    assert.equal(again.body.weekYear, nextWeek);
  });

  test('GET /api/meals/week/:future does not wipe the current week', async () => {
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    assert.equal(cur.status, 200);
    assert.equal(cur.body.weekYear, currentWeek);
    assert.equal(cur.body.meals.length, 7);
  });

  test('PUT /api/meals/swap with weekYear plans a day on the requested week', async () => {
    const recipes = ctx.repos.recipes.getAll();
    assert.ok(recipes.length > 0);
    const recipeId = recipes[0].id;

    const swap = await request(ctx.baseUrl, 'PUT', '/api/meals/swap', {
      body: {
        weekYear: nextWeek,
        dayOfWeek: 0,
        recipeId,
      },
    });
    assert.equal(swap.status, 200);
    assert.equal(swap.body.ok, true);

    const week = await request(ctx.baseUrl, 'GET', `/api/meals/week/${nextWeek}`);
    const monday = week.body.meals.find((m) => m.dayOfWeek === 0);
    assert.ok(monday);
    assert.equal(monday.recipeId, recipeId);
  });

  test('GET /api/shopping/list/current?week= returns that weekYear', async () => {
    const r = await request(ctx.baseUrl, 'GET', `/api/shopping/list/current?week=${nextWeek}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.weekYear, nextWeek);
    // May be null (empty shell) or a list id if swap auto-generated one.
    assert.ok(r.body.id === null || Number.isInteger(r.body.id));
  });

  test('GET /api/meals/week/invalid returns 400', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/meals/week/not-a-week');
    assert.equal(r.status, 400);
  });
});
