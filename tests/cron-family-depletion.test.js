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

let server;

function todayDow() {
  return (new Date().getDay() + 6) % 7;
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

function plantDinner(familyId, { status, productKey, withDeduction }) {
  return runWithFamily(familyId, () => {
    const recipeId = Number(
      server.repos.recipes.insert({
        name: `Dinner ${productKey}`,
        category: 'rask',
        ingredients: [{ productKey, name: productKey, qty: 2, unit: 'stk' }],
      })
    );
    const wk = getWeekYear();
    server.repos.mealPlans.setRecipe(wk, todayDow(), recipeId, status);
    server.repos.inventory.addPurchase(productKey, { packSize: 10, unit: 'stk' });
    const slot = server.repos.mealPlans.getWeek(wk).find((row) => row.dayOfWeek === todayDow());
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

  dailyDepletionJob(server.repos);

  assert.equal(qtyOf(familyA, keyA), 8);
  assert.equal(qtyOf(familyB, keyB), 8);
  assert.equal(qtyOf(familyRemoved, keyRemoved), 10);
  assert.equal(qtyOf(familyDone, keyDone), 10);

  dailyDepletionJob(server.repos);

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
