// Sprint 6 — End-to-end smart-coupling chain test.
//
// Walks the full reisen Pantry-Måltider-Handleliste in a single test
// to lock in the cross-feature contract:
//
//   1. Plan dinner             — set a recipe on a meal-plan slot
//   2. Generate shopping list  — POST /api/shopping/generate
//   3. Buy an ingredient       — PUT /api/shopping/items/:id/bought
//   4. Verify pantry has qty   — GET /api/pantry
//   5. Mark cooked             — POST /api/meals/:id/mark-eaten
//   6. Apply deduction         — POST /api/meals/:id/apply-deduction
//   7. Verify pantry decreased — GET /api/pantry
//   8. Verify low-stock add    — when remaining drops below 15% of total
//
// This is intentionally one giant test instead of one-per-step so the
// chain integrity is asserted end-to-end. Smaller per-endpoint tests
// already live in sprint-6-meal-deduction.test.js.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Sprint 6 — full smart-coupling chain', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('plan → generate → buy → cook → deduct → restock', async () => {
    // Step 1 — pick a slot that already has a recipe (seed-default
    // populates 7 days). Find one whose first ingredient has a
    // productKey we can deduct against.
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals.find((m) => m.recipeId !== null);
    assert.ok(slot, 'seed should populate at least one cooked-day');
    const recipe = ctx.repos.recipes.getById(slot.recipeId);
    const targetIng = recipe.ingredients.find(
      (i) => i.productKey && Number.isFinite(i.qty) && i.qty > 0
    );
    assert.ok(targetIng, 'recipe should have at least one ingredient with qty + productKey');

    // Step 2 — generate the shopping list. This puts every recipe
    // ingredient missing from pantry onto the active list.
    const gen = await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });
    assert.equal(gen.status, 200);

    // Step 3 — find the row for our target ingredient on the list,
    // then mark it bought with a generous qty so pantry has plenty
    // of headroom for the cook-deduction below.
    const list = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const items = (list.body.categories || []).flatMap((c) => c.items || []);
    const row = items.find((i) => i.productKey === targetIng.productKey);
    assert.ok(row, `shopping list should include ${targetIng.productKey}`);

    const buyQty = Math.max(targetIng.qty * 5, 100);
    const buy = await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${row.id}/bought`, {
      body: { qty: buyQty },
    });
    assert.equal(buy.status, 200);

    // Step 4 — pantry should now contain the bought qty.
    let pantry = await request(ctx.baseUrl, 'GET', '/api/pantry');
    let pantryRow = pantry.body.items.find((i) => i.productKey === targetIng.productKey);
    assert.ok(pantryRow, 'pantry should contain the bought item');
    assert.equal(pantryRow.quantity, buyQty);

    // Set total_size so the low-stock trigger has a denominator. We
    // pick total = buyQty so that any deduction trims directly into
    // the low-stock band.
    await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: targetIng.productKey, newQty: buyQty, newTotal: buyQty },
    });

    // Step 5 — mark the meal cooked. Suggestions come back so the
    // dialog can render.
    const cook = await request(ctx.baseUrl, 'POST', `/api/meals/${slot.id}/mark-eaten`, {
      body: {},
    });
    assert.equal(cook.status, 200);
    assert.equal(cook.body.alreadyCooked, false);
    const suggestion = cook.body.suggestions.find((s) => s.productKey === targetIng.productKey);
    assert.ok(suggestion, 'suggestion list should include the target ingredient');
    assert.equal(suggestion.matched, true);

    // Step 6 — apply a deduction that drops pantry below the 15%
    // threshold so the auto-restock path fires.
    const deductAmount = Math.ceil(buyQty * 0.9);
    const apply = await request(ctx.baseUrl, 'POST', `/api/meals/${slot.id}/apply-deduction`, {
      body: {
        items: [{ productKey: targetIng.productKey, amountToDeduct: deductAmount }],
      },
    });
    assert.equal(apply.status, 200);
    assert.equal(apply.body.applied.length, 1);
    assert.ok(
      apply.body.lowStockTriggered.includes(targetIng.productKey),
      'apply response should list the target as low-stock-triggered'
    );

    // Step 7 — pantry quantity should reflect the deduction.
    pantry = await request(ctx.baseUrl, 'GET', '/api/pantry');
    pantryRow = pantry.body.items.find((i) => i.productKey === targetIng.productKey);
    assert.ok(pantryRow);
    assert.equal(pantryRow.quantity, buyQty - deductAmount);

    // Step 8 — the low-stock trigger should have re-added the item
    // to the active shopping list with the auto-marker so the UI
    // can show "Suggested from pantry".
    const listAfter = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const itemsAfter = (listAfter.body.categories || []).flatMap((c) => c.items || []);
    const restocked = itemsAfter.find(
      (i) => i.productKey === targetIng.productKey && i.notes === 'auto:low-stock'
    );
    assert.ok(
      restocked,
      `expected an auto:low-stock row for ${targetIng.productKey} after deduction`
    );
    assert.equal(restocked.checkedOff, false, 'auto-added row should not be marked bought');
  });
});
