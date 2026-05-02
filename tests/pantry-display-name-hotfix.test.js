// Hotfix regression-test for pantry display-name bug.
//
// SYMPTOM: User adds "Økologisk rømme" via Quick-Add on the Shopping
// screen, toggles bought, switches to Pantry-view. The item shows up
// as the slug "okologisk-romme" instead of the original Norwegian
// text with æøå. Compare with seed-products like "Smør" which display
// correctly because they have a products-row with product_name.
//
// ROOT CAUSE: pantryResolver.resolveOrCreate slugifies user input to
// produce a stable productKey, but never persists the original text
// anywhere the pantry view (GET /api/pantry) can read. The pantry
// view falls back to the slug when productsMap[productKey] is missing,
// which is exactly the case for any manually added item.
//
// FIX: resolveOrCreate now upserts a minimal products-row using the
// original input as product_name whenever the catalog does not already
// know the resolved key. Existing seed/Kassal entries are never
// overwritten — getByKey gates the upsert.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

describe('Hotfix: pantry display-name preservation', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('resolveOrCreate inserts products row with original text for new key', () => {
    const pantryResolver = require('../server/services/pantry-resolver.service');
    const result = pantryResolver.resolveOrCreate(ctx.repos, 'Økologisk rømme');
    assert.equal(result.source, 'ny');
    assert.equal(result.productKey, 'okologisk-romme');

    const product = ctx.repos.products.getByKey('okologisk-romme');
    assert.ok(product, 'products row should be inserted');
    assert.equal(product.product_name, 'Økologisk rømme');
  });

  test('resolveOrCreate does not overwrite existing product_name on slug collision', () => {
    const pantryResolver = require('../server/services/pantry-resolver.service');
    // Pre-seed a curated row with a deliberate display name and a key
    // that the slugifier would also produce from a sloppy variant.
    ctx.repos.products.upsert({
      key: 'curated-test-item',
      productName: 'Curated Display Name',
      category: 'Tørrvarer & annet',
      packSize: 1,
      unit: 'stk',
    });

    pantryResolver.resolveOrCreate(ctx.repos, 'curated test item');
    const after = ctx.repos.products.getByKey('curated-test-item');
    assert.equal(
      after.product_name,
      'Curated Display Name',
      'pre-existing product_name must not be overwritten'
    );
  });

  test('resolveOrCreate is idempotent — second call does not change product_name', () => {
    const pantryResolver = require('../server/services/pantry-resolver.service');
    pantryResolver.resolveOrCreate(ctx.repos, 'Brød hjemmebakt');
    const first = ctx.repos.products.getByKey('brod-hjemmebakt');
    assert.ok(first);
    assert.equal(first.product_name, 'Brød hjemmebakt');

    // Second call with lowercase variant — slug collides, products row stays.
    pantryResolver.resolveOrCreate(ctx.repos, 'brod hjemmebakt');
    const second = ctx.repos.products.getByKey('brod-hjemmebakt');
    assert.equal(second.product_name, 'Brød hjemmebakt');
  });

  test('end-to-end: Quick-Add → bought → GET /api/pantry preserves æøå', async () => {
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    const addRes = await request(ctx.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Økologisk rømme' },
    });
    assert.equal(addRes.status, 201);
    const itemId = addRes.body.item.id;
    const productKey = addRes.body.item.productKey;
    assert.equal(productKey, 'okologisk-romme');

    const boughtRes = await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: {},
    });
    assert.equal(boughtRes.status, 200);

    const pantryRes = await request(ctx.baseUrl, 'GET', '/api/pantry');
    const pantryItem = pantryRes.body.items.find((i) => i.productKey === productKey);
    assert.ok(pantryItem, 'pantry should contain the new item');
    assert.equal(pantryItem.name, 'Økologisk rømme', 'name should preserve æøå');
    assert.equal(
      pantryItem.ingredientNameNo,
      'Økologisk rømme',
      'ingredientNameNo should preserve æøå'
    );
  });

  test('end-to-end: multiple æøå items round-trip correctly', async () => {
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    const inputs = ['Hjemmelaget yoghurt', 'Lønnesirup'];
    const ids = [];
    for (const name of inputs) {
      const addRes = await request(ctx.baseUrl, 'POST', '/api/shopping/items', {
        body: { name },
      });
      assert.equal(addRes.status, 201);
      ids.push({ id: addRes.body.item.id, name, productKey: addRes.body.item.productKey });
    }

    for (const { id } of ids) {
      const r = await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${id}/bought`, {
        body: {},
      });
      assert.equal(r.status, 200);
    }

    const pantryRes = await request(ctx.baseUrl, 'GET', '/api/pantry');
    for (const { name, productKey } of ids) {
      const item = pantryRes.body.items.find((i) => i.productKey === productKey);
      assert.ok(item, `pantry should contain ${productKey}`);
      assert.equal(item.name, name, `display name for ${productKey} should be ${name}`);
    }
  });

  test('uppercase input is preserved verbatim in product_name', async () => {
    await request(ctx.baseUrl, 'POST', '/api/shopping/generate', { body: {} });

    const addRes = await request(ctx.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'BLÅBÆRSYLTETØY' },
    });
    assert.equal(addRes.status, 201);
    const itemId = addRes.body.item.id;
    const productKey = addRes.body.item.productKey;
    // æ → e, ø → o, å → a per slugifyProductKey rules
    assert.equal(productKey, 'blabersyltetoy');

    await request(ctx.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: {},
    });

    const pantryRes = await request(ctx.baseUrl, 'GET', '/api/pantry');
    const pantryItem = pantryRes.body.items.find((i) => i.productKey === productKey);
    assert.ok(pantryItem);
    assert.equal(pantryItem.name, 'BLÅBÆRSYLTETØY');
  });
});
