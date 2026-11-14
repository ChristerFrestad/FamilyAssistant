'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { regenerateUnlockedDays } = require('../server/services/meal-planning.service');
const { buildShoppingList } = require('../server/services/shopping-list.service');
const {
  buildFamilyBackup,
  importFamilyBackup,
} = require('../server/services/family-backup.service');
const { getWeekYear } = require('../server/seed');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

function addLibrary(title, category, sourceName, ingredient) {
  return server.repos.recipeLibrary.upsert({
    title,
    sourceName,
    canonicalUrl: `https://example.test/oppskrifter/${sourceName}/${title}`,
    imageUrl: null,
    servings: 4,
    totalTimeMin: 20,
    category,
    fetchedAt: '2026-11-14T00:00:00.000Z',
    ingredients: [
      {
        rawLine: ingredient,
        qty: 2,
        unit: 'stk',
        name: ingredient,
        productKey: ingredient,
      },
    ],
  });
}

test('library candidates include a recipe past the first 400 ids', () => {
  const insert = server.repos._db.prepare(
    `INSERT INTO recipe_library (title, source_name, canonical_url, fetched_at, active)
     VALUES (?, 'Meny', ?, '2026-11-14T00:00:00.000Z', 1)`
  );
  server.repos._db.transaction(() => {
    for (let i = 0; i < 450; i += 1) {
      insert.run(`Spread ${i}`, `https://meny.no/oppskrifter/spread/s${i}`);
    }
  })();
  const maxId = server.repos._db.prepare('SELECT MAX(id) AS id FROM recipe_library').get().id;
  const rows = server.repos.recipeLibrary.listPlanningCandidates([], 400);
  assert.equal(
    rows.some((row) => row.id === maxId),
    true
  );
});

test('a library dinner can be cooked, shown today, shopped and restored', async () => {
  const libraryId = addLibrary('Bibliotek middag', 'rask', 'Meny', 'potet');
  const hiddenId = addLibrary('Skjult middag', 'comfort', 'Matprat', 'hemmelig');
  const week = getWeekYear();
  const day = (new Date().getDay() + 6) % 7;
  const slot = runWithFamily(1, () => {
    server.repos.mealPlans.setLibraryRecipe('2094-W40', 0, libraryId, 'planned', 'auto');
    server.repos.mealPlans.setLibraryRecipe('2094-W40', 1, hiddenId, 'planned', 'auto');
    server.repos.mealPlans.setLibraryRecipe(week, day, libraryId, 'planned', 'auto');
    return server.repos.mealPlans.getWeek(week).find((row) => row.dayOfWeek === day);
  });

  const cooked = await request(server.baseUrl, 'POST', `/api/meals/${slot.id}/mark-eaten`);
  assert.equal(cooked.status, 200);
  assert.equal(
    cooked.body.suggestions.some((item) => item.name === 'potet'),
    true
  );

  const today = await request(server.baseUrl, 'GET', '/api/today');
  assert.equal(today.status, 200);
  assert.equal(today.body.meal.recipe.name, 'Bibliotek middag');
  assert.equal(
    today.body.meal.recipe.url.includes('meny') || today.body.meal.recipe.fromLibrary,
    true
  );

  const hidden = await request(server.baseUrl, 'GET', '/api/meals/week/2094-W40');
  const hiddenSlot = hidden.body.meals.find((row) => row.dayOfWeek === 1);
  assert.equal(hiddenSlot.recipe, null);
  const shop = runWithFamily(1, () => JSON.stringify(buildShoppingList(server.repos, '2094-W40')));
  assert.equal(shop.includes('potet'), true);
  assert.equal(shop.includes('hemmelig'), false);

  const backup = runWithFamily(1, () => buildFamilyBackup(server.repos, 1));
  const stored = backup.mealPlans.find((row) => row.libraryRecipeId === libraryId);
  assert.ok(stored);
  runWithFamily(1, () => {
    server.repos._db.prepare('DELETE FROM meal_plans WHERE week_year = ?').run('2094-W41');
    importFamilyBackup(server.repos, 1, {
      mode: 'merge',
      payload: {
        schemaVersion: 2,
        family: { name: 'Hus' },
        members: [],
        recipes: [],
        chores: [],
        mealPlans: [{ ...stored, weekYear: '2094-W41' }],
        shoppingLists: [],
        pantry: [],
        calendarEvents: [],
      },
    });
    const restored = server.repos.mealPlans.getWeek('2094-W41');
    assert.equal(restored[0].libraryRecipeId, libraryId);
    assert.equal(restored[0].recipeId, null);
  });

  const index = server.repos._db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get('idx_meal_plans_library_recipe');
  assert.ok(index);
});

test('regenerate does not repeat a cooked or manual dinner', () => {
  const week = '2095-W15';
  runWithFamily(1, () => {
    const recipes = server.repos.recipes.getAll();
    const cooked = recipes[0];
    const manual = recipes.find((recipe) => recipe.id !== cooked.id);
    server.repos.mealPlans.setRecipe(week, 0, cooked.id, 'cooked', 'manual');
    server.repos.mealPlans.setRecipe(week, 2, manual.id, 'planned', 'manual');
    regenerateUnlockedDays(server.repos, week);
    const plan = server.repos.mealPlans.getWeek(week);
    const repeated = plan.filter(
      (slot) =>
        slot.dayOfWeek !== 0 &&
        slot.dayOfWeek !== 2 &&
        (slot.recipeId === cooked.id || slot.recipeId === manual.id)
    );
    assert.equal(repeated.length, 0);
    assert.equal(plan.find((slot) => slot.dayOfWeek === 0).recipeId, cooked.id);
    assert.equal(plan.find((slot) => slot.dayOfWeek === 2).recipeId, manual.id);
  });
});
