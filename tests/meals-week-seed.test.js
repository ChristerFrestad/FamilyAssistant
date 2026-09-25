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

// F1 (audit 2026-09-24): a week must always have 7 dinner rows, even when
// the family has deactivated a seed recipe, and weeks stored with <7 rows
// (pre-fix) self-heal on read so Shopping is no longer a dead end.
describe('Meals week seed — always 7 days (F1)', () => {
  const seed = require('../server/seed');
  const DAY_NAMES = [
    'Mandag',
    'Tirsdag',
    'Onsdag',
    'Torsdag',
    'Fredag',
    'L\u00f8rdag',
    'S\u00f8ndag',
  ];
  const weekPlusDays = (days) => getWeekYear(new Date(Date.now() + days * 86400000));
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  function countRows(wk) {
    return ctx.repos._db
      .prepare("SELECT COUNT(*) AS n FROM meal_plans WHERE week_year = ? AND meal_type = 'middag'")
      .get(wk).n;
  }

  test('deactivated seed recipe → new week still has 7 correctly labelled days', async () => {
    const wednesdaySeed = seed.recipes.find(
      (r) => r.id === seed.defaultMealPlan.find((s) => s.dayOfWeek === 2).recipeId
    );
    const wednesdayRecipe = ctx.repos.recipes.findByName(wednesdaySeed.name);
    assert.ok(wednesdayRecipe, 'fixture: Wednesday seed recipe exists');
    const deact = await request(
      ctx.baseUrl,
      'POST',
      `/api/recipes/${wednesdayRecipe.id}/deactivate`,
      { body: {} }
    );
    assert.equal(deact.status, 200);

    const wk = weekPlusDays(21);
    const res = await request(ctx.baseUrl, 'GET', `/api/meals/week/${wk}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.meals.length, 7);
    assert.deepEqual(
      res.body.meals.map((m) => m.dayOfWeek),
      [0, 1, 2, 3, 4, 5, 6]
    );
    assert.deepEqual(
      res.body.meals.map((m) => m.dayName),
      DAY_NAMES
    );
    const wednesday = res.body.meals[2];
    assert.equal(wednesday.recipeId, null, 'deactivated seed day is left unplanned');
    assert.equal(wednesday.recipe, null);
    assert.equal(wednesday.status, 'planned');
    // Thursday keeps its own seed recipe (no shift).
    const thursdaySeed = seed.recipes.find(
      (r) => r.id === seed.defaultMealPlan.find((s) => s.dayOfWeek === 3).recipeId
    );
    assert.equal(res.body.meals[3].recipe.name, thursdaySeed.name);
    assert.equal(countRows(wk), 7);
  });

  test('existing 6-day week (pre-fix data) is backfilled to 7 on read', async () => {
    const wk = weekPlusDays(35);
    // Simulate a week stored by the old partial seed: Wednesday missing.
    const recipes = ctx.repos.recipes.getAll();
    ctx.repos.mealPlans.seedDefault(
      wk,
      [0, 1, 3, 4, 5, 6].map((dayOfWeek, i) => ({
        dayOfWeek,
        recipeId: recipes[i].id,
        status: 'planned',
      }))
    );
    assert.equal(countRows(wk), 6);

    const res = await request(ctx.baseUrl, 'GET', `/api/meals/week/${wk}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.meals.length, 7);
    assert.deepEqual(
      res.body.meals.map((m) => m.dayName),
      DAY_NAMES
    );
    assert.equal(res.body.meals[2].recipeId, null);
    assert.equal(res.body.meals[3].recipeId, recipes[2].id, 'existing rows untouched');
    assert.equal(countRows(wk), 7, 'missing day persisted (self-heal)');

    // Idempotent: a second read does not add rows.
    await request(ctx.baseUrl, 'GET', `/api/meals/week/${wk}`);
    assert.equal(countRows(wk), 7);
  });

  test('shopping list for a healed week: blocked until the empty day is planned, then generates', async () => {
    const wk = weekPlusDays(35);
    const blocked = await request(ctx.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk },
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, 'WEEK_NOT_COMPLETE');

    // The healed day exists and can be planned from the UI (swap).
    const recipes = ctx.repos.recipes.getAll();
    const swap = await request(ctx.baseUrl, 'PUT', '/api/meals/swap', {
      body: { weekYear: wk, dayOfWeek: 2, recipeId: recipes[recipes.length - 1].id },
    });
    assert.equal(swap.status, 200);

    const gen = await request(ctx.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk },
    });
    assert.equal(gen.status, 200);
    assert.equal(gen.body.ok, true);
    assert.equal(gen.body.weekYear, wk);
    assert.ok(gen.body.itemCount > 0);

    const list = await request(ctx.baseUrl, 'GET', `/api/shopping/list/current?week=${wk}`);
    assert.equal(list.status, 200);
    assert.ok(Number.isInteger(list.body.id));
  });

  test('current week is also backfilled (ensureCurrentWeek path)', async () => {
    const wk = getWeekYear();
    ctx.repos._db.prepare('DELETE FROM meal_plans WHERE week_year = ? AND day_of_week = 6').run(wk);
    assert.equal(countRows(wk), 6);
    const res = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    assert.equal(res.status, 200);
    assert.equal(res.body.meals.length, 7);
    assert.equal(res.body.meals[6].dayName, 'S\u00f8ndag');
    assert.equal(countRows(wk), 7);
  });
});

// F2 (audit 2026-09-24): browsing back to a past week that was never
// planned must not write rows (meal_plans or chore_schedules). It is
// returned as 7 virtual empty slots with readOnly: true.
describe('Meals week — no fabricated past weeks (F2)', () => {
  const {
    isPastWeek,
    getWeekYearInTimeZone,
    ensureWeek,
  } = require('../server/services/seed.service');
  const weekPlusDays = (days) => getWeekYear(new Date(Date.now() + days * 86400000));
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  function rowCounts(wk) {
    const db = ctx.repos._db;
    return {
      meals: db.prepare('SELECT COUNT(*) AS n FROM meal_plans WHERE week_year = ?').get(wk).n,
      chores: db.prepare('SELECT COUNT(*) AS n FROM chore_schedules WHERE week_year = ?').get(wk).n,
    };
  }

  test('GET past unseen week writes nothing and returns 7 empty read-only slots', async () => {
    const wk = weekPlusDays(-28);
    assert.deepEqual(rowCounts(wk), { meals: 0, chores: 0 });

    const res = await request(ctx.baseUrl, 'GET', `/api/meals/week/${wk}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.weekYear, wk);
    assert.equal(res.body.readOnly, true);
    assert.equal(res.body.meals.length, 7);
    assert.deepEqual(
      res.body.meals.map((m) => m.dayOfWeek),
      [0, 1, 2, 3, 4, 5, 6]
    );
    for (const m of res.body.meals) {
      assert.equal(m.id, null);
      assert.equal(m.recipeId, null);
      assert.equal(m.recipe, null);
    }
    assert.deepEqual(rowCounts(wk), { meals: 0, chores: 0 }, 'no rows written');

    // Shopping for that week does not write either.
    const list = await request(ctx.baseUrl, 'GET', `/api/shopping/list/current?week=${wk}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.id, null);
    const gen = await request(ctx.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk },
    });
    assert.equal(gen.status, 400);
    assert.deepEqual(rowCounts(wk), { meals: 0, chores: 0 });
  });

  test('future unseen week still seeds 7 rows + chore schedule, not read-only', async () => {
    const wk = weekPlusDays(14);
    const res = await request(ctx.baseUrl, 'GET', `/api/meals/week/${wk}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.readOnly, false);
    assert.equal(res.body.meals.length, 7);
    assert.ok(res.body.meals.every((m) => Number.isInteger(m.id)));
    const counts = rowCounts(wk);
    assert.equal(counts.meals, 7);
    assert.ok(counts.chores > 0, 'chore schedule seeded for future week');
  });

  test('current week is never read-only', async () => {
    const res = await request(ctx.baseUrl, 'GET', `/api/meals/week/${getWeekYear()}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.readOnly, false);
    assert.equal(res.body.meals.length, 7);
  });

  test('past week WITH a stored plan is returned as-is (editable), partial days virtual only', async () => {
    const wk = weekPlusDays(-42);
    const recipe = ctx.repos.recipes.getAll()[0];
    ctx.repos.mealPlans.seedDefault(wk, [
      { dayOfWeek: 0, recipeId: recipe.id, status: 'cooked' },
      { dayOfWeek: 1, recipeId: recipe.id, status: 'planned' },
    ]);
    const res = await request(ctx.baseUrl, 'GET', `/api/meals/week/${wk}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.readOnly, false);
    assert.equal(res.body.meals.length, 7);
    assert.equal(res.body.meals[0].status, 'cooked');
    assert.equal(res.body.meals[0].recipe.id, recipe.id);
    assert.equal(res.body.meals[4].id, null, 'missing past day is virtual');
    assert.deepEqual(rowCounts(wk), { meals: 2, chores: 0 }, 'past week not backfilled');
  });

  test('isPastWeek/getWeekYearInTimeZone use Europe/Oslo ISO weeks', () => {
    // Mon 2026-09-28 00:30 Oslo (CEST) = Sun 2026-09-27 22:30 UTC.
    const mondayOslo = new Date('2026-09-27T22:30:00Z');
    assert.equal(getWeekYear(new Date(mondayOslo)), '2026-W39', 'UTC still W39');
    assert.equal(getWeekYearInTimeZone(mondayOslo), '2026-W40', 'Oslo already W40');
    assert.equal(isPastWeek('2026-W39', mondayOslo), true);
    assert.equal(isPastWeek('2026-W40', mondayOslo), false);
    assert.equal(isPastWeek('2026-W41', mondayOslo), false);
    // Year boundary: 2026-W53 < 2027-W01 (string order == chronological).
    assert.equal(isPastWeek('2026-W53', new Date('2027-01-06T12:00:00Z')), true);
    assert.equal(isPastWeek('2025-W52', new Date('2026-01-01T12:00:00Z')), true);
  });

  test('ensureWeek({ now }) skips past weeks; allowPast overrides', () => {
    const now = new Date('2026-09-30T12:00:00Z'); // 2026-W40
    const wk = '2026-W30';
    assert.equal(ensureWeek(ctx.repos, wk, { now }), wk);
    assert.deepEqual(rowCounts(wk), { meals: 0, chores: 0 });
    ensureWeek(ctx.repos, wk, { now, allowPast: true });
    assert.equal(rowCounts(wk).meals, 7);
  });
});
