'use strict';

// PR A — shopping kjøpt-toggle + slett + bought-items remain on list.

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const SEED_FAMILY_ID = 1;

function anySeededProductKey(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const row = server.repos._db
      .prepare('SELECT product_key FROM inventory WHERE family_id = ? LIMIT 1')
      .get(SEED_FAMILY_ID);
    return row?.product_key || null;
  });
}

function createShoppingItem(server, productKey) {
  return runWithFamily(SEED_FAMILY_ID, () => {
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
    const res = server.repos._db
      .prepare(
        `INSERT INTO shopping_list_items
           (family_id, list_id, source_type, source_ref, ingredient_name, product_key,
            qty, unit, pack_size, pack_unit, pack_count, pantry_has, needs_buy)
         VALUES (?, ?, 'recipe', 'test-ref', 'Test ingrediens', ?, 1, 'stk', 1, 'stk', 1, 0, 1)`
      )
      .run(SEED_FAMILY_ID, list.id, productKey);
    return Number(res.lastInsertRowid);
  });
}

test('bought items remain on the list (no server-side filter)', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const itemId = createShoppingItem(server, pk);

    // Mark bought.
    const r1 = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: { qty: 1 },
    });
    assert.strictEqual(r1.status, 200);

    // Fetch current list — item should still be there with checkedOff=true.
    const list = await request(server.baseUrl, 'GET', '/api/shopping/list/current');
    assert.strictEqual(list.status, 200);
    const found = (list.body.categories || [])
      .flatMap((c) => c.items || [])
      .find((it) => Number(it.id) === itemId);
    assert.ok(found, 'bought item must not be filtered out of categories');
    assert.strictEqual(found.checkedOff, true);
  } finally {
    await server.close();
  }
});

test('PUT /api/shopping/items/:id/unbought reverses the bought flag', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const itemId = createShoppingItem(server, pk);

    await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: { qty: 1 },
    });
    const r = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/unbought`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);

    runWithFamily(SEED_FAMILY_ID, () => {
      const parent = server.repos.shoppingLists.getItemWithList(itemId);
      assert.ok(parent);
      assert.strictEqual(parent.item.boughtAt, null);
      assert.strictEqual(parent.item.needsBuy, true);
    });
  } finally {
    await server.close();
  }
});

test('DELETE /api/shopping/items/:id removes the row permanently', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const itemId = createShoppingItem(server, pk);

    const r = await request(server.baseUrl, 'DELETE', `/api/shopping/items/${itemId}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);

    runWithFamily(SEED_FAMILY_ID, () => {
      const parent = server.repos.shoppingLists.getItemWithList(itemId);
      assert.strictEqual(parent, null, 'row should be gone after DELETE');
    });
  } finally {
    await server.close();
  }
});

test('DELETE on non-existent item returns 404', async () => {
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'DELETE', '/api/shopping/items/9999999');
    assert.strictEqual(r.status, 404);
  } finally {
    await server.close();
  }
});
