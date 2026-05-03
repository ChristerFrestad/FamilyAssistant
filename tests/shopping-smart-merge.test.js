'use strict';

// Smart-merge auto-generation tests (2026-05-03 PR feat/shopping-smart-merge).
//
// Covers the user-visible contract from the analysis doc:
//   1. merge preserves bought rows (any source_type)
//   2. merge preserves manual + extra rows regardless of bought-status
//   3. merge drops unbought meal_ingredient rows from the previous gen
//      and re-emits them from the current meal plan
//   4. merge dedupes new vs preserved by (sourceType, productKey/name, unit)
//   5. auto-trigger fires on swap even when an active list already exists
//      (the pre-2026-05-03 early-return bailed out — that bug is the
//      pilot blocker this PR fixes)
//   6. mode='replace' wipes everything (legacy behavior)

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');
const { generateForWeek } = require('../server/services/shopping-list.service');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
});

function fillWeek(repos, wk) {
  // 5 recipes + away + removed (matches iteration3b helper).
  for (let d = 0; d < 5; d++) {
    repos.mealPlans.setRecipe(wk, d, 1, 'planned');
  }
  repos.mealPlans.setRecipe(wk, 5, null, 'away');
  repos.mealPlans.setRecipe(wk, 6, null, 'removed');
}

describe('generateForWeek — smart-merge', () => {
  test('default mode is merge', () => {
    const { repos } = server;
    const wk = '2080-W30';
    fillWeek(repos, wk);

    // First generate — there is no existing list, so merge reduces to
    // a fresh emit.
    const result = generateForWeek(repos, wk);
    assert.ok(result.listId > 0);
    assert.equal(result.preservedCount, 0);
    assert.ok(result.addedCount > 0);
  });

  test('preserves a row that has bought_at set', () => {
    const { repos } = server;
    const wk = '2080-W31';
    fillWeek(repos, wk);

    // Generate the first list.
    const first = generateForWeek(repos, wk);
    const firstActive = repos.shoppingLists.getActive(wk);
    assert.ok(firstActive, 'first generate produced an active list');
    assert.ok(firstActive.items.length > 0, 'first generate produced items');

    // Mark one item as bought to simulate the user shopping.
    const target = firstActive.items.find((it) => it.sourceType === 'meal_ingredient');
    assert.ok(target, 'have a meal_ingredient row to mark bought');
    repos.shoppingLists.markItemBought(target.id, target.qty);

    // Regenerate via merge.
    const second = generateForWeek(repos, wk, { mode: 'merge' });
    const secondActive = repos.shoppingLists.getActive(wk);
    assert.ok(secondActive.id !== first.listId, 'a new list was created');

    // The bought item should still be there with bought_at set.
    const matched = secondActive.items.find(
      (it) =>
        it.sourceType === target.sourceType &&
        (it.productKey === target.productKey || it.ingredientName === target.ingredientName)
    );
    assert.ok(matched, 'bought ingredient is preserved on the new list');
    assert.ok(matched.boughtAt, 'bought_at is preserved on the new list');
    assert.equal(matched.needsBuy, false, 'needs_buy stays 0 for preserved bought rows');

    assert.ok(second.preservedCount >= 1, 'preservedCount reflects the carry-over');
  });

  test('preserves manual rows even when not bought', () => {
    const { repos } = server;
    const wk = '2080-W32';
    fillWeek(repos, wk);

    // First generate, then add a manual row directly to the active list.
    generateForWeek(repos, wk);
    const list = repos.shoppingLists.getActive(wk);
    repos.shoppingLists.addItem(list.id, { name: 'Pilot-test-tilbehør' });

    // Sanity: manual row is on the list.
    const withManual = repos.shoppingLists.getActive(wk);
    const manualBefore = withManual.items.find((it) => it.ingredientName === 'Pilot-test-tilbehør');
    assert.ok(manualBefore, 'manual row exists before regenerate');
    assert.ok(!manualBefore.boughtAt, 'manual row is unbought');

    // Regenerate.
    const result = generateForWeek(repos, wk, { mode: 'merge' });
    assert.ok(result.preservedCount >= 1, 'manual row contributed to preserved count');

    const after = repos.shoppingLists.getActive(wk);
    const manualAfter = after.items.find((it) => it.ingredientName === 'Pilot-test-tilbehør');
    assert.ok(manualAfter, 'manual row is preserved on regenerate');
    assert.equal(manualAfter.sourceType, 'manual');
  });

  test('dedupes a computed item against a preserved bought row', () => {
    const { repos } = server;
    const wk = '2080-W33';
    fillWeek(repos, wk);

    generateForWeek(repos, wk);
    const list = repos.shoppingLists.getActive(wk);
    const target = list.items.find((it) => it.sourceType === 'meal_ingredient');
    assert.ok(target, 'have a meal_ingredient to mark bought');
    repos.shoppingLists.markItemBought(target.id, target.qty);

    // Regenerate. The same recipe is still on the meal plan, so
    // computeShoppingListForWeek would emit a duplicate — merge must
    // dedupe it against the bought row.
    generateForWeek(repos, wk, { mode: 'merge' });
    const after = repos.shoppingLists.getActive(wk);

    const duplicates = after.items.filter(
      (it) =>
        it.sourceType === target.sourceType &&
        (it.productKey
          ? it.productKey === target.productKey
          : it.ingredientName === target.ingredientName) &&
        (it.unit || '') === (target.unit || '')
    );
    assert.equal(
      duplicates.length,
      1,
      'merge produces no duplicate of an ingredient the user already bought'
    );
    assert.ok(duplicates[0].boughtAt, 'the surviving row is the bought one');
  });

  test('mode="replace" wipes preserved rows', () => {
    const { repos } = server;
    const wk = '2080-W34';
    fillWeek(repos, wk);

    generateForWeek(repos, wk);
    const list = repos.shoppingLists.getActive(wk);
    const target = list.items.find((it) => it.sourceType === 'meal_ingredient');
    repos.shoppingLists.markItemBought(target.id, target.qty);
    repos.shoppingLists.addItem(list.id, { name: 'Replace-mode-skal-fjerne-meg' });

    generateForWeek(repos, wk, { mode: 'replace' });
    const after = repos.shoppingLists.getActive(wk);

    const manualSurvived = after.items.some(
      (it) => it.ingredientName === 'Replace-mode-skal-fjerne-meg'
    );
    assert.equal(manualSurvived, false, 'replace drops manual rows');

    const stillBought = after.items.some((it) => it.boughtAt);
    assert.equal(stillBought, false, 'replace drops bought-state');
  });
});

describe('Auto-trigger via PUT /api/meals/swap', () => {
  test('regenerates list (merge-mode) when an active list already exists', async () => {
    // Setup: fill a week and generate an initial list. Then mark one
    // ingredient as bought and add a manual row.
    const { repos } = server;
    const wk = '2080-W35';
    fillWeek(repos, wk);
    generateForWeek(repos, wk);
    const list = repos.shoppingLists.getActive(wk);
    const meal = list.items.find((it) => it.sourceType === 'meal_ingredient');
    repos.shoppingLists.markItemBought(meal.id, meal.qty);
    repos.shoppingLists.addItem(list.id, { name: 'Auto-trigger-manual-test' });

    const beforeListId = list.id;
    const refetched = repos.shoppingLists.getActive(wk);
    const beforeManual = refetched.items.find(
      (it) => it.ingredientName === 'Auto-trigger-manual-test'
    );
    assert.ok(beforeManual, 'manual row landed on the active list');

    // Now swap a recipe via the API. Auto-trigger runs because the
    // week is complete. Pre-2026-05-03 the trigger bailed because an
    // active list already existed; this test verifies it now merges.
    const swap = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { weekYear: wk, dayOfWeek: 0, recipeId: 1 },
    });
    assert.equal(swap.status, 200);

    const after = repos.shoppingLists.getActive(wk);
    assert.notEqual(after.id, beforeListId, 'auto-trigger created a new list');

    const manualSurvived = after.items.some(
      (it) => it.ingredientName === 'Auto-trigger-manual-test'
    );
    assert.equal(manualSurvived, true, 'manual row survived auto-trigger');

    const boughtSurvived = after.items.some((it) => it.boughtAt);
    assert.equal(boughtSurvived, true, 'bought row survived auto-trigger');
  });
});

describe('POST /api/shopping/generate body.mode', () => {
  test('accepts mode="merge" and reports preservedCount/addedCount', async () => {
    const { repos } = server;
    const wk = '2080-W36';
    fillWeek(repos, wk);
    generateForWeek(repos, wk);
    const list = repos.shoppingLists.getActive(wk);
    const meal = list.items.find((it) => it.sourceType === 'meal_ingredient');
    repos.shoppingLists.markItemBought(meal.id, meal.qty);

    const res = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk, mode: 'merge' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.preservedCount >= 1, 'preservedCount reflects the bought item');
    assert.equal(typeof res.body.addedCount, 'number');
  });

  test('rejects unknown mode', async () => {
    const wk = '2080-W37';
    fillWeek(server.repos, wk);
    const res = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk, mode: 'wat' },
    });
    assert.equal(res.status, 400);
  });

  test('defaults to merge when mode is omitted', async () => {
    const wk = '2080-W38';
    fillWeek(server.repos, wk);
    generateForWeek(server.repos, wk);
    const res = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk },
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.preservedCount, 'number');
  });
});
