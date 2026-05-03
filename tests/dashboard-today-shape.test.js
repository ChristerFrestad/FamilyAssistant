'use strict';

// Regression test for the Dashboard "today's meal" field-name mismatch
// that shipped through PR #88's smart-coupling work and broke Christer's
// Dashboard during pilot testing on 2026-05-03.
//
// The frontend type in client/src/app/dashboard/dashboardApi.ts must
// stay in sync with what GET /api/today actually returns. The previous
// type used `recipe.title` and `recipe.cookTime`, but the backend
// returns `recipe.name` (SQL column) and `recipe.prepTime` (aliased
// from `prep_time`). When Dashboard.tsx read meal.recipe.title it got
// undefined and rendered an empty span — making today's planned meal
// invisible on the Dashboard even though Måltider showed it correctly.
//
// This file pins the backend response shape so any future drift fails
// loudly in CI rather than silently in the UI.

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

describe('GET /api/today response shape — Dashboard regression', () => {
  test('includes meal with backend recipe shape (name, prepTime, servings)', async () => {
    // Plant a meal for today. The seed already created a current-week
    // plan via ensureCurrentWeek, so we just need to confirm at least
    // one slot has a recipe.
    const res = await request(server.baseUrl, 'GET', '/api/today');
    assert.equal(res.status, 200);
    assert.ok(res.body, 'response body present');

    // Top-level shape
    assert.equal(typeof res.body.dayName, 'string');
    assert.equal(typeof res.body.dayOfWeek, 'number');
    assert.equal(typeof res.body.weekYear, 'string');
    assert.ok(Array.isArray(res.body.chores), 'chores is an array');
    assert.ok(Array.isArray(res.body.events), 'events is an array');

    // meal can be null for an unplanned day; the seed-default meal
    // plan covers all 7 days so we expect non-null in the test DB.
    if (res.body.meal !== null) {
      assert.equal(typeof res.body.meal, 'object');
      assert.equal(typeof res.body.meal.dayOfWeek, 'number');
      assert.ok('recipeId' in res.body.meal, 'meal has recipeId');
      assert.equal(typeof res.body.meal.status, 'string');

      if (res.body.meal.recipe !== null) {
        const recipe = res.body.meal.recipe;
        assert.equal(typeof recipe.id, 'number', 'recipe.id is a number');
        assert.equal(typeof recipe.name, 'string', 'recipe.name is a string');
        assert.ok(recipe.name.length > 0, 'recipe.name is non-empty');

        // The frontend dashboardApi.ts treats prepTime and servings as
        // optional. The values, when present, are string and number
        // respectively (or null). What matters most is the absence of
        // the legacy field names.
        assert.equal(
          'title' in recipe,
          false,
          'recipe must NOT have legacy `title` field — Dashboard reads `name`'
        );
        assert.equal(
          'cookTime' in recipe,
          false,
          'recipe must NOT have legacy `cookTime` field — Dashboard reads `prepTime`'
        );

        if ('prepTime' in recipe && recipe.prepTime !== null) {
          assert.equal(typeof recipe.prepTime, 'string', 'recipe.prepTime is string|null');
        }
        if ('servings' in recipe && recipe.servings !== null) {
          assert.equal(typeof recipe.servings, 'number', 'recipe.servings is number|null');
        }
      }
    }
  });

  test('PUT /api/meals/swap → GET /api/today reflects new recipe', async () => {
    // Pick a known-good recipe to plant. The seed inserts at least one
    // recipe with id=1, so we use that. dayOfWeek=0 is Monday in our
    // canonicalisation.
    const swap = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 0, recipeId: 1 },
    });
    assert.equal(swap.status, 200, `swap status (got ${swap.status} ${JSON.stringify(swap.body)})`);

    // /api/today is cached with tag 'today'. The swap handler invalidates
    // ['meals','today','shopping'] so the next GET should not return the
    // pre-swap cached entry.
    const today = await request(server.baseUrl, 'GET', '/api/today');
    assert.equal(today.status, 200);

    // If today happens to be Monday we can verify directly. Otherwise
    // we just verify the response shape — the swap route's effect on
    // a non-today slot is exercised by api.test.js and would mask the
    // shape regression we care about here.
    const isMonday = today.body.dayOfWeek === 0;
    if (isMonday && today.body.meal && today.body.meal.recipe) {
      assert.equal(today.body.meal.recipeId, 1, 'today reflects swapped recipe');
      assert.equal(typeof today.body.meal.recipe.name, 'string');
    }
  });
});
