// Sprint 6 — meal-cooked smart-coupling. Backend integration tests
// covering the three new endpoints (mark-eaten / apply-deduction /
// unmark-eaten) plus the pantry-deduction service unit behaviour and
// the low-stock auto-add fix in pantry.service.checkAndTriggerLowStock.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Sprint 6 — pantry-deduction service', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('buildSuggestions returns empty array when meal has no recipe', () => {
    const svc = require('../server/services/pantry-deduction.service');
    const result = svc.buildSuggestions(ctx.repos, { recipeId: null });
    assert.deepEqual(result, []);
  });

  test('buildSuggestions hydrates pantryRemaining from inventory', () => {
    const svc = require('../server/services/pantry-deduction.service');

    // Pick the first seed recipe and seed pantry with one of its
    // ingredients. We write to inventory directly via the repo so the
    // POST /api/pantry/add slugify step does not normalise æ/ø/å keys
    // — recipe ingredients reference the raw seed keys, and we want
    // the test to verify the matching path, not the slugifier.
    const recipes = ctx.repos.recipes.getAll();
    const recipe = recipes.find((r) => Array.isArray(r.ingredients) && r.ingredients.length > 0);
    assert.ok(recipe, 'seed should contain at least one recipe with ingredients');
    const firstIng = recipe.ingredients.find((i) => i.productKey);
    assert.ok(firstIng, 'recipe should have at least one ingredient with productKey');

    ctx.repos.inventory.upsertManual(firstIng.productKey, {
      qtyAdded: 500,
      unit: firstIng.unit || 'stk',
      incrementPurchaseCount: false,
    });

    const slot = { recipeId: recipe.id };
    const suggestions = svc.buildSuggestions(ctx.repos, slot);
    assert.ok(suggestions.length > 0);
    const matchedSuggestion = suggestions.find((s) => s.productKey === firstIng.productKey);
    assert.ok(matchedSuggestion, 'suggestion for seeded productKey should exist');
    assert.equal(matchedSuggestion.matched, true);
    assert.ok(matchedSuggestion.pantryRemaining > 0);
    assert.ok(matchedSuggestion.suggestedDeduction > 0);
    assert.ok(
      matchedSuggestion.suggestedDeduction <= matchedSuggestion.pantryRemaining,
      'suggested amount should be clamped to pantry remaining'
    );
  });

  test('applyDeduction reduces pantry quantity and writes inventory_log row', async () => {
    const svc = require('../server/services/pantry-deduction.service');

    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: 'sprint6-test-flour', qty: 1000, unit: 'g' },
    });

    const result = svc.applyDeduction(ctx.repos, 999, [
      { productKey: 'sprint6-test-flour', amountToDeduct: 200 },
    ]);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].productKey, 'sprint6-test-flour');
    assert.equal(result.applied[0].prevQty, 1000);
    assert.equal(result.applied[0].newQty, 800);

    const inv = ctx.repos.inventory.getByKey('sprint6-test-flour');
    assert.equal(inv.qtyRemaining, 800);

    const logRows = ctx.repos.inventoryLog.getByKey('sprint6-test-flour');
    const dedRow = logRows.find((r) => r.notes === 'meal_deduction:999');
    assert.ok(dedRow, 'inventory_log should contain the meal-deduction row');
    assert.equal(dedRow.reason, 'correction');
    assert.equal(dedRow.qtyDelta, -200);
  });

  test('applyDeduction skips items not in pantry', () => {
    const svc = require('../server/services/pantry-deduction.service');
    const result = svc.applyDeduction(ctx.repos, 1, [
      { productKey: 'sprint6-not-here', amountToDeduct: 50 },
    ]);
    assert.equal(result.applied.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'not-in-pantry');
  });

  test('applyDeduction skips zero or negative amounts', () => {
    const svc = require('../server/services/pantry-deduction.service');
    const result = svc.applyDeduction(ctx.repos, 1, [
      { productKey: 'whatever', amountToDeduct: 0 },
      { productKey: 'whatever', amountToDeduct: -5 },
    ]);
    assert.equal(result.applied.length, 0);
    assert.equal(result.skipped.length, 2);
  });

  test('applyDeduction clamps amount to pantry remaining', async () => {
    const svc = require('../server/services/pantry-deduction.service');
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: 'sprint6-clamp-test', qty: 100, unit: 'g' },
    });
    const result = svc.applyDeduction(ctx.repos, 2, [
      { productKey: 'sprint6-clamp-test', amountToDeduct: 500 },
    ]);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].newQty, 0);
  });
});

describe('Sprint 6 — POST /api/meals/:id/mark-eaten', () => {
  let ctx;
  let mealId;
  let recipeWithIngs;

  before(async () => {
    ctx = await startTestServer();
    // Pick the first slot with a recipe
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals.find((m) => m.recipeId !== null);
    assert.ok(slot, 'seed should leave at least one slot with a recipe');
    mealId = slot.id;
    recipeWithIngs = ctx.repos.recipes.getById(slot.recipeId);
  });

  after(async () => {
    await ctx.close();
  });

  test('mark-eaten flips status to cooked and returns suggestions', async () => {
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/mark-eaten`, {
      body: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.alreadyCooked, false);
    assert.equal(r.body.recipeId, recipeWithIngs.id);
    assert.ok(Array.isArray(r.body.suggestions));

    // DB sanity check
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals.find((m) => m.id === mealId);
    assert.equal(slot.status, 'cooked');
  });

  test('second call returns alreadyCooked=true without re-flipping', async () => {
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/mark-eaten`, {
      body: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.alreadyCooked, true);
  });

  test('rejects non-existent meal id', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/meals/99999/mark-eaten', { body: {} });
    assert.equal(r.status, 404);
  });

  test('rejects slot with no recipe', async () => {
    // Find a slot, mark recipe NULL via repo
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals[0];
    ctx.repos._db.prepare('UPDATE meal_plans SET recipe_id = NULL WHERE id = ?').run(slot.id);
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${slot.id}/mark-eaten`, {
      body: {},
    });
    assert.equal(r.status, 400);
  });
});

describe('Sprint 6 — POST /api/meals/:id/apply-deduction', () => {
  let ctx;
  let mealId;
  let firstIng;

  before(async () => {
    ctx = await startTestServer();
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals.find((m) => m.recipeId !== null);
    mealId = slot.id;
    const recipe = ctx.repos.recipes.getById(slot.recipeId);
    firstIng = recipe.ingredients.find((i) => i.productKey);
    // Stock pantry for the first ingredient so we have something to deduct
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: firstIng.productKey, qty: 1000, unit: firstIng.unit || 'stk' },
    });
    // Mark cooked first (apply-deduction requires status=cooked)
    await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/mark-eaten`, { body: {} });
  });

  after(async () => {
    await ctx.close();
  });

  test('applies the user-confirmed deductions', async () => {
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/apply-deduction`, {
      body: { items: [{ productKey: firstIng.productKey, amountToDeduct: 50 }] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.applied.length, 1);
    assert.equal(r.body.applied[0].newQty, 950);
  });

  test('rejects when slot is not yet cooked', async () => {
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const otherSlot = cur.body.meals.find((m) => m.id !== mealId && m.status === 'planned');
    if (!otherSlot) return; // seed-state-dependent; skip silently
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${otherSlot.id}/apply-deduction`, {
      body: { items: [] },
    });
    assert.equal(r.status, 400);
  });

  test('empty items array succeeds with zero-effect result', async () => {
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/apply-deduction`, {
      body: { items: [] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.applied.length, 0);
  });

  test('rejects malformed body via Zod', async () => {
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/apply-deduction`, {
      body: { items: [{ productKey: 'x', amountToDeduct: 'not-a-number' }] },
    });
    assert.equal(r.status, 400);
  });
});

describe('Sprint 6 — POST /api/meals/:id/unmark-eaten', () => {
  let ctx;
  let mealId;

  before(async () => {
    ctx = await startTestServer();
    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals.find((m) => m.recipeId !== null);
    mealId = slot.id;
  });

  after(async () => {
    await ctx.close();
  });

  test('flips cooked back to planned', async () => {
    await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/mark-eaten`, { body: {} });
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/unmark-eaten`, {
      body: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);

    const cur = await request(ctx.baseUrl, 'GET', '/api/meals/current');
    const slot = cur.body.meals.find((m) => m.id === mealId);
    assert.equal(slot.status, 'planned');
  });

  test('returns alreadyPlanned when slot is not cooked', async () => {
    const r = await request(ctx.baseUrl, 'POST', `/api/meals/${mealId}/unmark-eaten`, {
      body: {},
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.alreadyPlanned, true);
  });
});

describe('Sprint 6 — low-stock auto-add fix', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
    // Make sure we have an active shopping list — the trigger only
    // fires when one exists. /generate creates the active list for
    // the current week from the seed plan.
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });
  });

  after(async () => {
    await ctx.close();
  });

  test('correctQty under threshold adds the item to active shopping list', async () => {
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: 'sprint6-low-stock', qty: 1000, total: 1000, unit: 'g' },
    });
    const r = await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'sprint6-low-stock', newQty: 50 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.lowStock.triggered, true, 'low-stock auto-add should fire');

    const list = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const items = (list.body.categories || []).flatMap((c) => c.items || []);
    const added = items.find((i) => i.productKey === 'sprint6-low-stock');
    assert.ok(added, 'item should appear on active shopping list');
    assert.equal(added.notes, 'auto:low-stock', 'notes marker should be set for UI badge');
  });

  test('does not double-add when item is already on the list', async () => {
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: 'sprint6-already-listed', qty: 1000, total: 1000, unit: 'g' },
    });
    // Trigger once — adds row
    await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'sprint6-already-listed', newQty: 30 },
    });
    // Trigger a second time — should not duplicate
    const r = await request(ctx.baseUrl, 'PUT', '/api/pantry/correct', {
      body: { productKey: 'sprint6-already-listed', newQty: 10 },
    });
    assert.equal(r.body.lowStock.triggered, false);
    assert.equal(r.body.lowStock.reason, 'already-on-list');
  });
});
