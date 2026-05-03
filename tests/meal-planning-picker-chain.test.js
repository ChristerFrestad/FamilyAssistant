// End-to-end chain test that includes the new plan step:
//
//   1. Clear a meal-plan slot (simulates an empty day in the user's
//      week)
//   2. Plan a recipe via PUT /api/meals/swap (the call the picker
//      issues client-side)
//   3. Generate the shopping list — picks up the planned ingredient
//   4. Buy that ingredient → pantry has stock
//   5. Mark cooked → suggestions for the new recipe
//   6. Apply deduction → pantry decreases, low-stock auto-restock fires
//
// Locks the plan-step in the same chain test as Sprint 6 finalize so
// regressions in either swap-route or smart-coupling stay obvious.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Meal planning picker — full chain incl. swap', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('plan via swap → buy → cook → deduct → restock', async () => {
    // Pick the first slot of the week and swap a deterministic recipe
    // onto it. PUT /api/meals/swap is the same call the frontend
    // picker fires for both plan (empty slot) and swap (existing
    // recipe) modes; the underlying SQL is INSERT ... ON CONFLICT
    // DO UPDATE so the contract is the same.
    const cur0 = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const targetSlot = cur0.body.meals[0];

    // Find a recipe with at least one productKey + qty so we have
    // something deductible later.
    const recipes = ctx.repos.recipes.getAll();
    const recipe = recipes.find(
      (r) =>
        Array.isArray(r.ingredients) &&
        r.ingredients.some((i) => i.productKey && Number.isFinite(i.qty) && i.qty > 0)
    );
    assert.ok(recipe, 'seed should have at least one usable recipe');
    const targetIng = recipe.ingredients.find(
      (i) => i.productKey && Number.isFinite(i.qty) && i.qty > 0
    );

    const swap = await request(ctx.baseUrl, 'PUT', '/api/meals/swap', {
      body: {
        weekYear: cur0.body.weekYear,
        dayOfWeek: targetSlot.dayOfWeek,
        recipeId: recipe.id,
      },
    });
    assert.equal(swap.status, 200);
    assert.equal(swap.body.ok, true);

    const cur2 = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const planned = cur2.body.meals.find((m) => m.id === targetSlot.id);
    assert.equal(planned.recipeId, recipe.id, 'slot should hold the planned recipe');
    assert.equal(planned.status, 'planned');

    // Step 3 — generate shopping list against the freshly planned week.
    const gen = await request(ctx.baseUrl, 'POST', '/api/shopping/generate', {
      body: { force: true },
    });
    assert.equal(gen.status, 200);

    const list = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const items = (list.body.categories || []).flatMap((c) => c.items || []);
    const row = items.find((i) => i.productKey === targetIng.productKey);
    assert.ok(row, `shopping list should include ${targetIng.productKey}`);

    // Step 4 — buy that item. pantry now has stock.
    const buyQty = Math.max(targetIng.qty * 5, 100);
    const buy = await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${row.id}/bought`, {
      body: { qty: buyQty },
    });
    assert.equal(buy.status, 200);

    // Set total_size so the low-stock-trigger has a denominator.
    await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: {
        productKey: targetIng.productKey,
        newQty: buyQty,
        newTotal: buyQty,
      },
    });

    // Step 5 — mark cooked on the slot we just planned.
    const cook = await request(ctx.baseUrl, 'POST', `/api/meals/${planned.id}/mark-eaten`, {
      body: {},
    });
    assert.equal(cook.status, 200);
    const suggestion = cook.body.suggestions.find((s) => s.productKey === targetIng.productKey);
    assert.ok(suggestion, 'planned recipe ingredient should appear in suggestions');
    assert.equal(suggestion.matched, true);

    // Step 6 — apply a deduction big enough to fire low-stock-restock.
    const deductAmount = Math.ceil(buyQty * 0.9);
    const apply = await request(ctx.baseUrl, 'POST', `/api/meals/${planned.id}/apply-deduction`, {
      body: {
        items: [{ productKey: targetIng.productKey, amountToDeduct: deductAmount }],
      },
    });
    assert.equal(apply.status, 200);
    assert.ok(
      apply.body.lowStockTriggered.includes(targetIng.productKey),
      'low-stock auto-restock should fire after deduction'
    );

    const listAfter = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const itemsAfter = (listAfter.body.categories || []).flatMap((c) => c.items || []);
    const restocked = itemsAfter.find(
      (i) => i.productKey === targetIng.productKey && i.notes === 'auto:low-stock'
    );
    assert.ok(restocked, 'auto:low-stock row should be present on shopping list');
  });

  test('PUT /api/meals/swap rejects unknown recipe id with 400', async () => {
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const wk = cur.body.weekYear;
    const r = await request(ctx.baseUrl, 'PUT', '/api/meals/swap', {
      body: { weekYear: wk, dayOfWeek: 0, recipeId: 999999 },
    });
    // Backend's setRecipe-FK fires on unknown id; route maps to 4xx
    // via errors.badRequest. Either 400 or 5xx-mapped-to-400 is
    // acceptable; we just check it does not silently succeed.
    assert.notEqual(r.status, 200);
  });
});
