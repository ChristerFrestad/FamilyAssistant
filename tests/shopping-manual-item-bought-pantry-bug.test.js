// Regression-test for the bug Christer reported on Phase 2E pantry sub-view.
//
// SYMPTOM: Manuelt-addede shopping-items (via QuickAddInput) som ble
// toggled "kjøpt" dukket aldri opp i Pantry-view. DB-state viste:
//   - shopping_list_items.product_key = NULL for manuelle items
//   - shopping_list_items.bought_at satt korrekt
//   - shopping_list_items.bought_qty = 0
//   - inventory tom
//   - inventory_log tom
//
// ROT-ÅRSAK:
//   1. POST /api/shopping/items lagde ikke productKey for manuelle items
//      (addItem i shopping.repo.js INSERT'et uten product_key).
//   2. PUT /api/shopping/items/:id/bought hoppet over inventory.addPurchase
//      når item.productKey var null (linje 959: `if (item.productKey && ...)`).
//   3. Default qty-fallback kollapset til 0 når både body.qty og item.qty
//      var null, så selv items med productKey men uten qty hoppet over
//      pantry-update via `qtyPurchased > 0`-vakten.
//
// FIX:
//   1. POST /api/shopping/items kjører pantryResolver.resolveOrCreate på
//      item-name og setter productKey ved INSERT.
//   2. PUT /bought lazy-resolver productKey for legacy-items (uten
//      productKey) og persisterer den via setProductKey, slik at
//      eksisterende rader fra før fix også fungerer.
//   3. qtyPurchased defaulter til 1 når ingen kvantitet er kjent.
//
// Disse tre testene låser fast den nye oppførselen.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Bug: manuelle shopping-items toggled bought → pantry-update', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('POST /api/shopping/items lagrer productKey via pantryResolver', async () => {
    // Generate active list first so add-item has a target.
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    const addRes = await request(ctx.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Tine Helmelk' },
    });
    assert.equal(addRes.status, 201);
    assert.equal(addRes.body.ok, true);

    // Hent items for å finne den vi nettopp la til
    const listRes = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const items = (listRes.body.categories || []).flatMap((c) => c.items || []);
    const added = items.find((i) => i.ingredientName === 'Tine Helmelk');
    assert.ok(added, 'newly added item should be on the list');
    assert.ok(
      added.productKey,
      `manual item should have productKey set after fix; got ${added.productKey}`
    );
  });

  test('PUT /bought på manuelt item legger til pantry og inventory_log', async () => {
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    const addRes = await request(ctx.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'TestVare1', qty: 2, unit: 'stk' },
    });
    assert.equal(addRes.status, 201);
    const itemId = addRes.body.item.id;
    const productKey = addRes.body.item.productKey;
    assert.ok(productKey, 'productKey should be assigned on add');

    // Toggle bought.
    const boughtRes = await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: { qty: 2 },
    });
    assert.equal(boughtRes.status, 200);
    assert.equal(boughtRes.body.ok, true);

    // Verify pantry now contains the item.
    const pantryRes = await request(ctx.baseUrl, 'GET', '/api/pantry');
    const pantryItem = pantryRes.body.items.find((i) => i.productKey === productKey);
    assert.ok(pantryItem, `pantry should contain ${productKey} after bought-toggle`);
    assert.equal(pantryItem.quantity, 2);
  });

  test('PUT /bought med qty=null defaulter til 1 og oppdaterer pantry', async () => {
    // Reproduserer Christer's eksakte symptom: addItem uten qty +
    // bought-toggle uten body.qty → tidligere bought_qty=0, inventory tom.
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    const addRes = await request(ctx.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Saft' },
    });
    assert.equal(addRes.status, 201);
    const itemId = addRes.body.item.id;
    const productKey = addRes.body.item.productKey;
    assert.ok(productKey);

    // Bought without body.qty — matches Christer's manual flow.
    const boughtRes = await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: {},
    });
    assert.equal(boughtRes.status, 200);

    const pantryRes = await request(ctx.baseUrl, 'GET', '/api/pantry');
    const pantryItem = pantryRes.body.items.find((i) => i.productKey === productKey);
    assert.ok(pantryItem, `pantry should contain ${productKey} (default qty=1)`);
    assert.equal(pantryItem.quantity, 1);
  });

  test('PUT /bought på legacy item uten productKey backfiller via resolveOrCreate', async () => {
    // Simulerer eksisterende DB-state fra før POST-fixen: item ble lagt
    // til via det gamle addItem-paret uten productKey. Backfill-logikken
    // i PUT /bought skal resolve og persistere productKey, slik at
    // pantry-flyten fungerer for eldre rader.
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    // Hent active list-id direkte
    const listRes = await request(ctx.baseUrl, 'GET', '/api/shopping/list/current');
    const listId = listRes.body.id;
    assert.ok(listId);

    // Direct repo write for å simulere legacy-rad uten productKey.
    // Dette matcher Christer's faktiske DB-state (id=16, 17 i diagnose-data).
    const itemRow = ctx.repos._db
      .prepare(
        `INSERT INTO shopping_list_items (
           family_id, list_id, source_type, ingredient_name, qty, unit,
           category, needs_buy, sort_order
         ) VALUES (?, ?, 'manual', ?, NULL, NULL, 'other', 1, 999)
         RETURNING id`
      )
      .get(1, listId, 'butter');
    assert.ok(itemRow.id);

    const boughtRes = await request(
      ctx.baseUrl,
      'PUT',
      `/api/shopping/items/${itemRow.id}/bought`,
      { body: {} }
    );
    assert.equal(boughtRes.status, 200);

    // Pantry should now contain a row whose productKey was backfilled.
    const pantryRes = await request(ctx.baseUrl, 'GET', '/api/pantry');
    const pantryItem = pantryRes.body.items.find(
      (i) => i.productKey.includes('butter') || i.name.toLowerCase().includes('butter')
    );
    assert.ok(
      pantryItem,
      `legacy item should resolve to pantry — got ${JSON.stringify(pantryRes.body.items.map((i) => i.productKey))}`
    );

    // Verify the row was persisted with the backfilled productKey
    const refreshed = ctx.repos._db
      .prepare(`SELECT product_key FROM shopping_list_items WHERE id = ?`)
      .get(itemRow.id);
    assert.ok(
      refreshed.product_key,
      `legacy row should have product_key persisted after bought-toggle; got ${refreshed.product_key}`
    );
  });
});
