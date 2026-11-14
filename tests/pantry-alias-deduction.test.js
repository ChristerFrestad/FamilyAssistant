'use strict';

// A deduction recorded under one spelling of a Norwegian key must block
// the other spelling, and a request must drain both rows.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { getWeekYear } = require('../server/seed');
const { applyDeduction, buildSuggestions } = require('../server/services/pantry-deduction.service');
const { computeShoppingListForWeek } = require('../server/services/shopping-list.service');
const { dedupeSearchSuggestions } = require('../server/services/product-key-alias');
const { scoreRecipeByPantry } = require('../server/services/pantry-coverage.service');
const { dailyDepletionJob } = require('../server/cron');

let server;

const FIXED_NOW = new Date('2026-06-15T12:00:00Z');

function qtyOf(familyId, key) {
  const row = server.repos._db
    .prepare('SELECT qty_remaining as qty FROM inventory WHERE family_id = ? AND product_key = ?')
    .get(familyId, key);
  return row ? row.qty : null;
}

function stock(familyId, key, qty) {
  server.repos._db
    .prepare(
      `INSERT INTO inventory (family_id, product_key, qty_remaining, unit, updated_at)
       VALUES (?, ?, ?, 'g', datetime('now'))`
    )
    .run(familyId, key, qty);
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('catalog add is case-insensitive for æ, ø, and å', async () => {
  const res = await request(server.baseUrl, 'POST', '/api/pantry/add', {
    body: { productKey: 'Kjøttpølser', qty: 4, unit: 'g' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.productKey, 'kjøttpølser');
  assert.equal(qtyOf(1, 'kjøttpølser'), 4);
  assert.equal(qtyOf(1, 'kjottpolser'), null);
});

test('a deduction recorded under one key is seen from the other', () => {
  stock(1, 'romme', 9);
  const first = runWithFamily(1, () =>
    applyDeduction(server.repos, 40, [{ productKey: 'rømme', amountToDeduct: 2 }])
  );
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].productKey, 'romme');
  assert.equal(qtyOf(1, 'romme'), 7);

  const again = runWithFamily(1, () =>
    applyDeduction(server.repos, 40, [{ productKey: 'romme', amountToDeduct: 2 }])
  );
  assert.equal(again.applied.length, 0);
  assert.equal(again.skipped[0].reason, 'already-deducted');
  assert.equal(qtyOf(1, 'romme'), 7);

  const suggestions = runWithFamily(1, () =>
    buildSuggestions(server.repos, {
      id: 40,
      recipeId: runWithFamily(1, () =>
        Number(
          server.repos.recipes.insert({
            name: 'Rømme suggestion',
            category: 'rask',
            servings: 2,
            ingredients: [{ productKey: 'rømme', name: 'Rømme', qty: 2, unit: 'g' }],
          })
        )
      ),
    })
  );
  assert.equal(suggestions[0].suggestedDeduction, 0);
  assert.equal(suggestions[0].alreadyDeducted, true);
});

test('a request of 3 drains 1 on the raw row and 2 on the slug row', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Split rows')
      .lastInsertRowid
  );
  stock(familyId, 'kjøttpølser', 1);
  stock(familyId, 'kjottpolser', 5);
  const result = runWithFamily(familyId, () =>
    applyDeduction(server.repos, 41, [{ productKey: 'kjøttpølser', amountToDeduct: 3 }])
  );
  assert.equal(result.applied.length, 2);
  assert.equal(qtyOf(familyId, 'kjøttpølser'), 0);
  assert.equal(qtyOf(familyId, 'kjottpolser'), 3);
});

test('a recipe that lists both spellings deducts the shared row once', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Alias once')
      .lastInsertRowid
  );
  stock(familyId, 'rømme', 10);
  const dow = (FIXED_NOW.getUTCDay() + 6) % 7;
  const weekYear = getWeekYear(new Date(FIXED_NOW.getTime()));
  const mealId = runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: 'Both spellings',
        category: 'rask',
        ingredients: [
          { productKey: 'rømme', name: 'Rømme', qty: 3, unit: 'g' },
          { productKey: 'romme', name: 'Romme', qty: 3, unit: 'g' },
        ],
      })
    );
    server.repos.mealPlans.setRecipe(weekYear, dow, recipeId, 'planned');
    return server.repos.mealPlans.getWeek(weekYear).find((row) => row.dayOfWeek === dow).id;
  });

  dailyDepletionJob(server.repos, FIXED_NOW);
  assert.equal(qtyOf(familyId, 'rømme'), 4);
  const logs = server.repos._db
    .prepare(
      `SELECT COUNT(*) as c FROM inventory_log WHERE family_id = ? AND notes = ? AND reason = 'cron_depletion'`
    )
    .get(familyId, `meal_deduction:${mealId}`).c;
  assert.equal(logs, 1);

  dailyDepletionJob(server.repos, FIXED_NOW);
  assert.equal(qtyOf(familyId, 'rømme'), 4);
});

test('dialog log on the raw key stops the nightly job from deducting the slug row', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Dialog then cron')
      .lastInsertRowid
  );
  stock(familyId, 'rømme', 10);
  stock(familyId, 'romme', 10);
  const dow = (FIXED_NOW.getUTCDay() + 6) % 7;
  const weekYear = getWeekYear(new Date(FIXED_NOW.getTime()));
  runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: 'Sour cream',
        category: 'rask',
        ingredients: [{ productKey: 'rømme', name: 'Rømme', qty: 2, unit: 'g' }],
      })
    );
    server.repos.mealPlans.setRecipe(weekYear, dow, recipeId, 'planned');
    const mealId = server.repos.mealPlans.getWeek(weekYear).find((row) => row.dayOfWeek === dow).id;
    applyDeduction(server.repos, mealId, [{ productKey: 'rømme', amountToDeduct: 2 }]);
  });
  assert.equal(qtyOf(familyId, 'rømme'), 8);
  assert.equal(qtyOf(familyId, 'romme'), 10);

  dailyDepletionJob(server.repos, FIXED_NOW);
  assert.equal(qtyOf(familyId, 'rømme'), 8);
  assert.equal(qtyOf(familyId, 'romme'), 10);
});

test('shopping and coverage count stock stored under the other spelling', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Shop alias')
      .lastInsertRowid
  );
  stock(familyId, 'romme', 10);
  const weekYear = '2026-W30';
  runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: 'Needs rømme',
        category: 'rask',
        servings: 2,
        ingredients: [{ productKey: 'rømme', name: 'Rømme', qty: 4, unit: 'g' }],
      })
    );
    for (let day = 0; day < 7; day += 1) {
      server.repos.mealPlans.setRecipe(weekYear, day, recipeId, day === 0 ? 'planned' : 'removed');
    }
    const computed = computeShoppingListForWeek(server.repos, weekYear);
    const line = computed.flatItems.find(
      (item) => item.ingredientName === 'Rømme' || item.productKey === 'rømme'
    );
    assert.ok(line);
    assert.equal(line.needsBuy, false);
    assert.equal(line.pantryQty, 10);

    const score = scoreRecipeByPantry(
      { ingredients: [{ productKey: 'rømme', name: 'Rømme', qty: 4 }] },
      server.repos.inventory.getAll()
    );
    assert.ok(score.ingredientsAtHome >= 1);
  });
});

test('romme listed first still deducts stock stored as rømme', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Romme first')
      .lastInsertRowid
  );
  stock(familyId, 'rømme', 10);
  const dow = (FIXED_NOW.getUTCDay() + 6) % 7;
  const weekYear = getWeekYear(new Date(FIXED_NOW.getTime()));
  runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: 'Slug before catalog',
        category: 'rask',
        ingredients: [
          { productKey: 'romme', name: 'Romme', qty: 2, unit: 'g' },
          { productKey: 'rømme', name: 'Rømme', qty: 2, unit: 'g' },
        ],
      })
    );
    server.repos.mealPlans.setRecipe(weekYear, dow, recipeId, 'planned');
    const suggestions = buildSuggestions(
      server.repos,
      server.repos.mealPlans.getWeek(weekYear).find((row) => row.dayOfWeek === dow)
    );
    const sour = suggestions.find(
      (row) => row.productKey === 'rømme' || row.productKey === 'romme'
    );
    assert.ok(sour);
    assert.equal(sour.productKey, 'rømme');
    assert.equal(sour.pantryRemaining, 10);
  });
  dailyDepletionJob(server.repos, FIXED_NOW);
  assert.equal(qtyOf(familyId, 'rømme'), 6);

  const onlySlug = runWithFamily(familyId, () =>
    applyDeduction(server.repos, 77, [{ productKey: 'romme', amountToDeduct: 1 }])
  );
  assert.equal(onlySlug.applied.length, 1);
  assert.equal(onlySlug.applied[0].productKey, 'rømme');
  assert.equal(qtyOf(familyId, 'rømme'), 5);
});

test('a capitalised recipe key matches the catalog spelling', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Capital key')
      .lastInsertRowid
  );
  stock(familyId, 'rømme', 4);
  const result = runWithFamily(familyId, () =>
    applyDeduction(server.repos, 78, [{ productKey: 'Rømme', amountToDeduct: 1 }])
  );
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].productKey, 'rømme');
  assert.equal(qtyOf(familyId, 'rømme'), 3);
});

test('search suggestions collapse rømme and romme onto the catalog spelling', () => {
  const collapsed = dedupeSearchSuggestions(
    [
      { productKey: 'romme', name: 'romme', source: 'lokal', confidence: 0.4 },
      { productKey: 'rømme', name: 'Rømme', source: 'kassal', confidence: 1 },
    ],
    server.repos
  );
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].productKey, 'rømme');
});

test('a name-only ingredient is not stored under a lowercased product key', () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Name only')
      .lastInsertRowid
  );
  const weekYear = '2026-W31';
  runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: 'No key',
        category: 'rask',
        servings: 2,
        ingredients: [{ name: 'Ukjent Krydder', qty: 1, unit: 'stk' }],
      })
    );
    for (let day = 0; day < 7; day += 1) {
      server.repos.mealPlans.setRecipe(weekYear, day, recipeId, day === 0 ? 'planned' : 'removed');
    }
    const computed = computeShoppingListForWeek(server.repos, weekYear);
    const line = computed.flatItems.find((item) => item.ingredientName === 'Ukjent Krydder');
    assert.ok(line);
    assert.equal(line.productKey, null);
  });
});
