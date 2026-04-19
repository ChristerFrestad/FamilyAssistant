'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

// Tests pick a seeded recipe-linked product as the pantry subject. The seed
// service creates inventory rows (see seed.service.js), but not every build
// guarantees a shopping list — so we build one directly with the repos.
const SEED_FAMILY_ID = 1;

function createShoppingItemWithProductKey(server, productKey) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    // 1. Ensure a shopping list row exists for the current week.
    const weekYear =
      server.repos._db
        .prepare('SELECT week_year FROM meal_plans WHERE family_id = ? LIMIT 1')
        .get(SEED_FAMILY_ID)?.week_year || '2026-W16';
    let list = server.repos._db
      .prepare('SELECT id FROM shopping_lists WHERE family_id = ? AND week_year = ? LIMIT 1')
      .get(SEED_FAMILY_ID, weekYear);
    if (!list) {
      const ins = server.repos._db
        .prepare(
          `INSERT INTO shopping_lists (family_id, week_year, status, enrichment_status)
           VALUES (?, ?, 'active', 'done')`
        )
        .run(SEED_FAMILY_ID, weekYear);
      list = { id: Number(ins.lastInsertRowid) };
    }
    // 2. Insert a recipe-sourced item pointing at the chosen productKey.
    const ing = server.repos._db
      .prepare(
        `INSERT INTO shopping_list_items
           (family_id, list_id, source_type, source_ref, ingredient_name, product_key,
            qty, unit, pack_size, pack_unit, pack_count, pantry_has, needs_buy)
         VALUES (?, ?, 'recipe', 'test-ref', 'Test ingrediens', ?, 1, 'stk', 1, 'stk', 1, 0, 1)`
      )
      .run(SEED_FAMILY_ID, list.id, productKey);
    return Number(ing.lastInsertRowid);
  });
}

function getPantryQty(server, productKey) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const row = server.repos.inventory.getByKey(productKey);
    return row?.qtyRemaining || 0;
  });
}

function anySeededProductKey(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const row = server.repos._db
      .prepare('SELECT product_key FROM inventory WHERE family_id = ? LIMIT 1')
      .get(SEED_FAMILY_ID);
    return row?.product_key || null;
  });
}

test('PUT /api/shopping/items/:id/has-home updates pantry without marking bought', async () => {
  const server = await startTestServer();
  try {
    const productKey = anySeededProductKey(server);
    if (!productKey) return; // no seeded inventory — skip

    const itemId = createShoppingItemWithProductKey(server, productKey);
    const qtyBefore = getPantryQty(server, productKey);

    const res = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/has-home`, {
      body: { qty: 3 },
    });
    assert.strictEqual(res.status, 200, `status ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.ok, true);

    // Row stays on the list — not marked bought.
    await runWithFamily(SEED_FAMILY_ID, () => {
      const parent = server.repos.shoppingLists.getItemWithList(itemId);
      assert.ok(parent, 'item should still exist');
      assert.strictEqual(parent.item.boughtAt, null, 'must not be marked bought');
    });

    // Pantry qty increased by at least 3.
    const qtyAfter = getPantryQty(server, productKey);
    assert.ok(
      qtyAfter - qtyBefore >= 3 - 0.01,
      `qty did not increase: before=${qtyBefore} after=${qtyAfter}`
    );
  } finally {
    await server.close();
  }
});

test('PUT /api/shopping/items/:id/has-home rejects invalid qty', async () => {
  const server = await startTestServer();
  try {
    const productKey = anySeededProductKey(server);
    if (!productKey) return;
    const itemId = createShoppingItemWithProductKey(server, productKey);
    const res = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/has-home`, {
      body: { qty: 0 },
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx got ${res.status}`);
  } finally {
    await server.close();
  }
});
