'use strict';

// Sunday-push, shelf-life, and pantry depletion must run for every family.
// Depletion must not touch a removed dinner, a dinner already deducted in
// the cook dialog, or the same dinner a second time.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { getWeekYear } = require('../server/seed');
const { dailyDepletionJob, sundayPushJob, shelfLifeCheckJob } = require('../server/cron');
const { applyDeduction } = require('../server/services/pantry-deduction.service');

let server;

// Noon UTC, away from every local midnight, so week and weekday cannot
// disagree during the test.
const FIXED_NOW = new Date('2026-06-15T12:00:00Z');

function isoDow(date) {
  return (date.getUTCDay() + 6) % 7;
}

function createFamily(name) {
  return Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
}

function qtyOf(familyId, key) {
  const row = server.repos._db
    .prepare('SELECT qty_remaining as qty FROM inventory WHERE family_id = ? AND product_key = ?')
    .get(familyId, key);
  return row ? row.qty : null;
}

function plantDinner(familyId, { status, productKey, withDeduction }, now = FIXED_NOW) {
  return runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: `Dinner ${productKey}`,
        category: 'rask',
        ingredients: [{ productKey, name: productKey, qty: 2, unit: 'stk' }],
      })
    );
    const wk = getWeekYear(new Date(now.getTime()));
    const dow = isoDow(now);
    server.repos.mealPlans.setRecipe(wk, dow, recipeId, status);
    server.repos.inventory.addPurchase(productKey, { packSize: 10, unit: 'stk' });
    const slot = server.repos.mealPlans.getWeek(wk).find((row) => row.dayOfWeek === dow);
    if (withDeduction) {
      server.repos.inventoryLog.insert({
        productKey,
        qtyDelta: 0,
        newQty: 10,
        unit: 'stk',
        reason: 'correction',
        notes: `meal_deduction:${slot.id}`,
      });
    }
    return slot.id;
  });
}

before(async () => {
  server = await startTestServer({ authToken: 'cron-depletion-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('dailyDepletionJob deducts every family once and skips removed or already deducted', () => {
  const familyA = createFamily('Deplete A');
  const familyB = createFamily('Deplete B');
  const familyRemoved = createFamily('Deplete Removed');
  const familyDone = createFamily('Deplete Done');
  const keyA = `dep-a-${familyA}`;
  const keyB = `dep-b-${familyB}`;
  const keyRemoved = `dep-r-${familyRemoved}`;
  const keyDone = `dep-d-${familyDone}`;

  plantDinner(familyA, { status: 'planned', productKey: keyA });
  plantDinner(familyB, { status: 'cooked', productKey: keyB });
  plantDinner(familyRemoved, { status: 'removed', productKey: keyRemoved });
  plantDinner(familyDone, { status: 'cooked', productKey: keyDone, withDeduction: true });

  dailyDepletionJob(server.repos, FIXED_NOW);

  assert.equal(qtyOf(familyA, keyA), 8);
  assert.equal(qtyOf(familyB, keyB), 8);
  assert.equal(qtyOf(familyRemoved, keyRemoved), 10);
  assert.equal(qtyOf(familyDone, keyDone), 10);
  const reason = server.repos._db
    .prepare(
      `SELECT reason FROM inventory_log WHERE family_id = ? AND product_key = ? AND notes LIKE 'meal_deduction:%'`
    )
    .get(familyA, keyA);
  assert.equal(reason.reason, 'cron_depletion');

  dailyDepletionJob(server.repos, FIXED_NOW);

  assert.equal(qtyOf(familyA, keyA), 8, 'second run must not deduct again');
  assert.equal(qtyOf(familyB, keyB), 8, 'second run must not deduct again');
});

test('sundayPushJob and shelfLifeCheckJob visit a family that is not family 1', () => {
  const familyId = createFamily('Cron Other');
  const key = `shelf-${familyId}`;
  runWithFamily(familyId, () => {
    server.repos.inventory.addPurchase(key, { packSize: 1, unit: 'l' });
  });
  server.repos._db
    .prepare(
      `UPDATE inventory SET expires_est = date('now') WHERE family_id = ? AND product_key = ?`
    )
    .run(familyId, key);

  sundayPushJob(server.repos);
  shelfLifeCheckJob(server.repos);

  const sunday = server.repos._db
    .prepare(`SELECT COUNT(*) as c FROM notifications WHERE family_id = ? AND type = 'sunday_push'`)
    .get(familyId).c;
  const shelf = server.repos._db
    .prepare(`SELECT COUNT(*) as c FROM notifications WHERE family_id = ? AND type = 'shelf_life'`)
    .get(familyId).c;
  assert.equal(sunday, 1);
  assert.ok(shelf >= 1);
});

test('cron deduction blocks a later dialog apply, and a repeat apply is a no-op', () => {
  const familyId = createFamily('Cron Then Dialog');
  const key = 'shared-milk';
  const mealId = plantDinner(familyId, { status: 'planned', productKey: key });

  dailyDepletionJob(server.repos, FIXED_NOW);
  assert.equal(qtyOf(familyId, key), 8);

  const first = runWithFamily(familyId, () =>
    applyDeduction(server.repos, mealId, [{ productKey: key, amountToDeduct: 2 }])
  );
  assert.equal(first.applied.length, 0);
  assert.equal(first.skipped[0].reason, 'already-deducted');
  assert.equal(qtyOf(familyId, key), 8);

  const second = runWithFamily(familyId, () =>
    applyDeduction(server.repos, mealId, [{ productKey: key, amountToDeduct: 2 }])
  );
  assert.equal(second.applied.length, 0);
  assert.equal(qtyOf(familyId, key), 8);
});

test('a longer meal id in the log does not block a shorter meal, and families do not share a key', () => {
  const familyA = createFamily('Exact A');
  const familyB = createFamily('Exact B');
  const key = 'shared-milk';
  const mealA = plantDinner(familyA, { status: 'planned', productKey: key });
  const mealB = plantDinner(familyB, { status: 'planned', productKey: key });

  runWithFamily(familyA, () => {
    server.repos.inventoryLog.insert({
      productKey: key,
      qtyDelta: 0,
      newQty: 10,
      unit: 'stk',
      reason: 'cron_depletion',
      notes: `meal_deduction:${mealA}1`,
    });
  });

  const deducted = runWithFamily(familyA, () =>
    applyDeduction(server.repos, mealA, [{ productKey: key, amountToDeduct: 2 }])
  );
  assert.equal(deducted.applied.length, 1);
  assert.equal(qtyOf(familyA, key), 8);
  assert.equal(qtyOf(familyB, key), 10);

  const again = runWithFamily(familyA, () =>
    applyDeduction(server.repos, mealA, [{ productKey: key, amountToDeduct: 2 }])
  );
  assert.equal(again.applied.length, 0);
  assert.equal(qtyOf(familyA, key), 8);

  const otherFamily = runWithFamily(familyB, () =>
    applyDeduction(server.repos, mealB, [{ productKey: key, amountToDeduct: 2 }])
  );
  assert.equal(otherFamily.applied.length, 1);
  assert.equal(qtyOf(familyB, key), 8);
  assert.equal(qtyOf(familyA, key), 8);
});
