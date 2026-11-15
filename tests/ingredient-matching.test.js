'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { matchCatalogKey } = require('../server/services/recipe-library/catalog-match');
const { convertQuantity, toCanonical } = require('../server/services/unit-convert');
const { computeShoppingListForWeek } = require('../server/services/shopping-list.service');
const { scoreRecipeByPantry } = require('../server/services/pantry-coverage.service');
const { backfillIngredientMatches } = require('../server/services/ingredient-match-backfill');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('catalog match normalises, pluralises and uses synonyms without crossing foods', () => {
  const products = server.repos.products.getAllAsMap();
  assert.equal(matchCatalogKey('poteter', products), 'poteter');
  assert.equal(matchCatalogKey('store poteter', products), 'poteter');
  assert.equal(matchCatalogKey('500 g poteter', products), 'poteter');
  assert.equal(matchCatalogKey('potet', products), 'poteter');
  assert.equal(matchCatalogKey('løk', products), 'løk');
  assert.notEqual(matchCatalogKey('løk', products), 'hvitløk');
  assert.equal(matchCatalogKey('hvitløk', products), 'hvitløk');
  assert.equal(matchCatalogKey('gul løk', products), 'løk');
  assert.equal(matchCatalogKey('noe-helt-ukjent', products), null);
});

test('units convert inside a dimension and refuse a different one', () => {
  assert.equal(convertQuantity(1, 'kg', 'g'), 1000);
  assert.equal(convertQuantity(2, 'dl', 'ml'), 200);
  assert.equal(convertQuantity(1, 'l', 'ml'), 1000);
  assert.equal(convertQuantity(2, 'ss', 'ml'), 30);
  assert.equal(convertQuantity(3, 'ts', 'ml'), 15);
  assert.equal(toCanonical(2, 'stk').qty, 2);
  assert.equal(convertQuantity(100, 'g', 'ml'), null);
  assert.equal(convertQuantity(1, 'stk', 'g'), null);
});

test('shopping list sums compatible units and keeps a line with no amount', () => {
  const recipeId = runWithFamily(1, () =>
    server.repos.recipes.insert({
      name: 'To mengder potet',
      category: 'rask',
      servings: 4,
      sourceType: 'manual',
      ingredients: [
        { name: 'Poteter', productKey: 'poteter', qty: 500, unit: 'g' },
        { name: 'Poteter', productKey: 'poteter', qty: 0.5, unit: 'kg' },
        { name: 'salt og pepper', qty: null, unit: null },
      ],
    })
  );
  const week = '2088-W11';
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 0, recipeId, 'planned');
  });
  const list = runWithFamily(1, () => computeShoppingListForWeek(server.repos, week));
  const potato = list.flatItems.find((item) => item.productKey === 'poteter');
  const salt = list.flatItems.find((item) => item.ingredientName === 'salt og pepper');
  assert.ok(potato);
  assert.equal(potato.unit, 'g');
  assert.equal(potato.qty, 1000);
  assert.ok(salt);
  assert.equal(salt.qty, null);
  assert.equal(salt.needsBuy, true);
});

test('pantry coverage converts kilograms to grams', () => {
  const score = scoreRecipeByPantry(
    {
      ingredients: [{ name: 'Poteter', productKey: 'poteter', qty: 500, unit: 'g' }],
    },
    { poteter: { qtyRemaining: 1, unit: 'kg' } },
    'maksimer'
  );
  assert.equal(score.ingredientsAtHome, 1);
  assert.ok(score.score >= 1);
});

test('backfill fills empty product keys and is safe to repeat', () => {
  const db = server.repos._db;
  const products = server.repos.products.getAllAsMap();
  const libraryId = Number(
    db
      .prepare(
        `INSERT INTO recipe_library (title, source_name, canonical_url, servings, category, fetched_at, active)
       VALUES ('Backfill', 'Meny', 'https://meny.no/oppskrifter/test/backfill-match', 2, 'rask', '2026-11-14T00:00:00.000Z', 1)`
      )
      .run().lastInsertRowid
  );
  db.prepare(
    `INSERT INTO recipe_library_ingredients (library_id, raw_line, qty, unit, name, product_key, sort_order)
     VALUES (?, 'store poteter', 500, 'g', 'store poteter', NULL, 0),
            (?, 'noe ukjent', NULL, NULL, 'noe ukjent', NULL, 1)`
  ).run(libraryId, libraryId);
  const recipeId = runWithFamily(1, () =>
    server.repos.recipes.insert({
      name: 'Familie uten nøkkel',
      category: 'rask',
      servings: 2,
      sourceType: 'manual',
      ingredients: [{ name: 'gul løk', qty: 1, unit: 'stk', productKey: null }],
    })
  );
  const beforeRows = db
    .prepare(`SELECT name, product_key FROM recipe_ingredients WHERE recipe_id = ?`)
    .all(recipeId);
  assert.equal(beforeRows[0].product_key, null);

  const first = backfillIngredientMatches(db, products);
  const potato = db
    .prepare('SELECT product_key FROM recipe_library_ingredients WHERE library_id = ? AND name = ?')
    .get(libraryId, 'store poteter');
  const unknown = db
    .prepare('SELECT product_key FROM recipe_library_ingredients WHERE library_id = ? AND name = ?')
    .get(libraryId, 'noe ukjent');
  const onion = db
    .prepare('SELECT product_key FROM recipe_ingredients WHERE recipe_id = ?')
    .get(recipeId);
  assert.equal(potato.product_key, 'poteter');
  assert.equal(unknown.product_key, null);
  assert.equal(onion.product_key, 'løk');
  assert.ok(
    first.recipe_library_ingredients.after.matched >=
      first.recipe_library_ingredients.before.matched
  );
  assert.ok(first.recipe_ingredients.updated >= 1);
  const names = db
    .prepare('SELECT COUNT(*) AS n FROM recipe_ingredients WHERE recipe_id = ?')
    .get(recipeId);
  assert.equal(names.n, 1);

  const second = backfillIngredientMatches(db, products);
  assert.equal(second.recipe_library_ingredients.updated, 0);
  assert.equal(second.recipe_ingredients.updated, 0);
});
