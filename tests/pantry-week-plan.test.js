'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const {
  regenerateUnlockedDays,
  resolveMode,
  suggestionReason,
} = require('../server/services/meal-planning.service');
const { rankRecipes } = require('../server/services/pantry-coverage.service');
const { getWeekYear } = require('../server/seed');
const { sundayPushJob } = require('../server/cron');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('a family with no mode ranks by pantry and expiry', () => {
  assert.equal(resolveMode(server.repos), 'balansert');
  assert.equal(suggestionReason(3, 0), 'Bruker 3 ting du har');
  assert.equal(suggestionReason(1, 2), 'Går ut snart');
});

test('pantry ranking puts the stocked dinner first', () => {
  const ranked = rankRecipes(
    [
      {
        id: 1,
        category: 'rask',
        ingredients: [{ productKey: 'poteter', qty: 200, unit: 'g' }],
      },
      {
        id: 2,
        category: 'rask',
        ingredients: [{ productKey: 'ris', qty: 200, unit: 'g' }],
      },
    ],
    { poteter: { qtyRemaining: 1, unit: 'kg' } },
    'balansert'
  );
  assert.equal(ranked[0].recipe.id, 1);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('suggest again replaces a planned day and keeps a cooked day', async () => {
  const week = '2091-W20';
  const recipes = runWithFamily(1, () => server.repos.recipes.getAll());
  const first = recipes[0];
  const second = recipes[1];
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 0, first.id, 'cooked', 'manual');
    server.repos.mealPlans.setRecipe(week, 1, second.id, 'planned', 'auto');
  });
  const res = await request(server.baseUrl, 'POST', `/api/meals/week/${week}/suggest-again`);
  assert.equal(res.status, 200);
  const plan = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  const cooked = plan.find((slot) => slot.dayOfWeek === 0);
  assert.equal(cooked.recipeId, first.id);
  assert.equal(cooked.status, 'cooked');
  assert.equal(plan.length >= 2, true);
});

test('sunday refresh updates an automatic draft instead of skipping it', () => {
  const week = getWeekYear(new Date(Date.now() + 7 * 86400000));
  const recipeId = runWithFamily(1, () => server.repos.recipes.getAll()[0].id);
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 0, recipeId, 'planned', 'auto');
  });
  sundayPushJob(server.repos);
  const after = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  const monday = after.find((slot) => slot.dayOfWeek === 0);
  assert.ok(monday);
  assert.equal(monday.planOrigin, 'auto');
  assert.equal(monday.status, 'planned');
  assert.ok(after.length > 1);
});

test('regenerate leaves a manual planned dinner when only automatic days move', () => {
  const week = '2093-W03';
  const recipes = runWithFamily(1, () => server.repos.recipes.getAll());
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 2, recipes[2].id, 'planned', 'manual');
    regenerateUnlockedDays(server.repos, week, { onlyAuto: true });
  });
  const plan = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  const kept = plan.find((slot) => slot.dayOfWeek === 2);
  assert.equal(kept.recipeId, recipes[2].id);
  assert.equal(kept.planOrigin, 'manual');
});
