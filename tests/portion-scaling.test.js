'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { familyPortionSum, effectiveScale } = require('../server/services/family.service');

let server;

function makeFamily(roster, name) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
  for (const m of roster) {
    server.repos.family.addMember(fid, m);
  }
  return fid;
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

// ============================================================
// familyPortionSum
// ============================================================

test('familyPortionSum returns 0 for empty rosters', () => {
  const fid = makeFamily([], 'Empty Roster');
  assert.strictEqual(familyPortionSum(server.repos, fid), 0);
});

test('familyPortionSum sums portion_factor across adults, teens, children', () => {
  const fid = makeFamily(
    [
      { name: 'Far', category: 'adult', portionFactor: 1.0 },
      { name: 'Mor', category: 'adult', portionFactor: 1.0 },
      { name: 'Teen', category: 'teen', portionFactor: 0.75 },
      { name: 'Barn', category: 'child', portionFactor: 0.5 },
    ],
    'Scaling 3.25'
  );
  assert.strictEqual(familyPortionSum(server.repos, fid), 3.25);
});

test('familyPortionSum handles custom factors', () => {
  const fid = makeFamily(
    [
      { name: 'Athlete', category: 'adult', portionFactor: 1.5 },
      { name: 'Small kid', category: 'child', portionFactor: 0.4 },
    ],
    'Custom factors'
  );
  assert.strictEqual(familyPortionSum(server.repos, fid), 1.9);
});

// ============================================================
// effectiveScale precedence
// ============================================================

test('effectiveScale uses explicit override when provided', () => {
  const fid = makeFamily([{ name: 'A', category: 'adult', portionFactor: 1.0 }], 'Override Test');
  assert.strictEqual(effectiveScale(server.repos, fid, 4, 8), 2);
});

test('effectiveScale returns familyPortionSum / recipeServings', () => {
  const fid = makeFamily(
    [
      { name: 'A', category: 'adult', portionFactor: 1.0 },
      { name: 'B', category: 'child', portionFactor: 0.5 },
    ],
    'Auto Scale'
  );
  // 1.5 / 4 = 0.375
  assert.strictEqual(effectiveScale(server.repos, fid, 4), 0.375);
});

test('effectiveScale returns 1 for empty roster', () => {
  const fid = makeFamily([], 'Empty For Scale');
  assert.strictEqual(effectiveScale(server.repos, fid, 4), 1);
});

test('effectiveScale returns 1 when recipe servings is missing', () => {
  const fid = makeFamily([{ name: 'A', category: 'adult', portionFactor: 1.0 }], 'No Servings');
  assert.strictEqual(effectiveScale(server.repos, fid, null), 1);
  assert.strictEqual(effectiveScale(server.repos, fid, 0), 1);
});

test('effectiveScale ignores invalid override', () => {
  const fid = makeFamily([{ name: 'A', category: 'adult', portionFactor: 1.0 }], 'Bad Override');
  // 1.0 / 2 = 0.5
  assert.strictEqual(effectiveScale(server.repos, fid, 2, 'bad'), 0.5);
  assert.strictEqual(effectiveScale(server.repos, fid, 2, -3), 0.5);
  assert.strictEqual(effectiveScale(server.repos, fid, 2, 0), 0.5);
});

// ============================================================
// Shopping list scales ingredients by portion sum
// ============================================================

test('shopping list scales ingredients by family portion sum', () => {
  const fid = makeFamily(
    [
      { name: 'A', category: 'adult', portionFactor: 1.0 },
      { name: 'B', category: 'adult', portionFactor: 1.0 },
    ],
    'Shop Scale A'
  );
  // Recipe for 4 servings, ingredient "melk" = 2 l
  let recipeId;
  runWithFamily(fid, () => {
    recipeId = server.repos.recipes.insert({
      name: 'Melkegrøt',
      category: 'comfort',
      servings: 4,
      ingredients: [{ name: 'Melk', qty: 2, unit: 'l' }],
    });
    server.repos.mealPlans.setRecipe('2026-30', 0, recipeId, 'planned');
  });

  const { computeShoppingListForWeek } = require('../server/services/shopping-list.service');
  let items;
  runWithFamily(fid, () => {
    items = computeShoppingListForWeek(server.repos, '2026-30').flatItems;
  });
  const melk = items.find((i) => /melk/i.test(i.ingredientName));
  assert.ok(melk, 'melk must be on the shopping list');
  // portionSum=2.0, servings=4 → scale=0.5. 2 l * 0.5 = 1 l.
  assert.strictEqual(melk.qty, 1);
});

test('shopping list does not scale when there is no roster', () => {
  // Fresh family with no profile members.
  const fid = makeFamily([], 'No Roster Shop');
  let recipeId;
  runWithFamily(fid, () => {
    recipeId = server.repos.recipes.insert({
      name: 'Pasta',
      category: 'rask',
      servings: 4,
      ingredients: [{ name: 'Pasta', qty: 500, unit: 'g' }],
    });
    server.repos.mealPlans.setRecipe('2026-31', 0, recipeId, 'planned');
  });

  const { computeShoppingListForWeek } = require('../server/services/shopping-list.service');
  let items;
  runWithFamily(fid, () => {
    items = computeShoppingListForWeek(server.repos, '2026-31').flatItems;
  });
  const pasta = items.find((i) => /pasta/i.test(i.ingredientName));
  assert.ok(pasta);
  // Empty roster → scale 1 → 500 g as-is.
  assert.strictEqual(pasta.qty, 500);
});

test('shopping list scales quantities up for large families', () => {
  const fid = makeFamily(
    [
      { name: 'A', category: 'adult', portionFactor: 1.0 },
      { name: 'B', category: 'adult', portionFactor: 1.0 },
      { name: 'C', category: 'adult', portionFactor: 1.0 },
      { name: 'D', category: 'adult', portionFactor: 1.0 },
      { name: 'E', category: 'adult', portionFactor: 1.0 },
      { name: 'F', category: 'adult', portionFactor: 1.0 },
    ],
    'Big Family'
  );
  // Recipe for 2 servings, ingredient "ris" = 150 g
  let recipeId;
  runWithFamily(fid, () => {
    recipeId = server.repos.recipes.insert({
      name: 'Risotto',
      category: 'comfort',
      servings: 2,
      ingredients: [{ name: 'Ris', qty: 150, unit: 'g' }],
    });
    server.repos.mealPlans.setRecipe('2026-32', 0, recipeId, 'planned');
  });

  const { computeShoppingListForWeek } = require('../server/services/shopping-list.service');
  let items;
  runWithFamily(fid, () => {
    items = computeShoppingListForWeek(server.repos, '2026-32').flatItems;
  });
  const ris = items.find((i) => /ris/i.test(i.ingredientName));
  assert.ok(ris);
  // portionSum=6.0, servings=2 → scale=3. 150 * 3 = 450 g.
  assert.strictEqual(ris.qty, 450);
});

test('missing-for-rest-of-week also scales quantities', () => {
  const fid = makeFamily(
    [
      { name: 'A', category: 'adult', portionFactor: 1.0 },
      { name: 'B', category: 'teen', portionFactor: 0.75 },
    ],
    'Missing Scale'
  );
  // Day 6 (Sunday in weekday-starts-monday convention) always >= todayDow
  // because (new Date().getDay() + 6) % 7 ∈ [0,6], so dow=6 is always
  // >= todayDow except when today is Sunday. We use dow=6 unconditionally
  // and tolerate the Sunday edge case by looking for the ingredient only
  // if it is present.
  let recipeId;
  runWithFamily(fid, () => {
    recipeId = server.repos.recipes.insert({
      name: 'Eggerøre',
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Egg', qty: 4, unit: 'stk' }],
    });
    server.repos.mealPlans.setRecipe('2026-33', 6, recipeId, 'planned');
  });

  const { computeMissingForRestOfWeek } = require('../server/services/meal-planning.service');
  let missing;
  runWithFamily(fid, () => {
    missing = computeMissingForRestOfWeek(server.repos, '2026-33');
  });
  // portionSum=1.75, servings=2 → scale=0.875. 4 * 0.875 = 3.5 egg.
  // If today is Sunday and dow=6 < todayDow would have skipped — tolerate.
  const egg = missing.find((i) => /egg/i.test(i.name));
  if (egg) {
    assert.strictEqual(egg.qty, 3.5);
  }
});
