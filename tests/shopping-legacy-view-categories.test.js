// Regression: the legacy shopping view (GET /api/shopping/current and the
// Sunday push) used CATEGORY_ORDER as a whitelist, so items whose category
// was not in that list were silently dropped. Seed products use 'Kjøkken'
// (11 products) and manual items default to the 'other' enum-key.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  legacyViewFromActiveList,
  orderCategories,
  CATEGORY_ORDER,
} = require('../server/services/shopping-list.service');

function item(id, name, category, extra = {}) {
  return {
    id,
    ingredientName: name,
    category,
    productKey: null,
    qty: 1,
    unit: 'stk',
    pantryHas: false,
    needsBuy: true,
    estPrice: 10,
    sourceType: 'manual',
    mealsJson: [],
    boughtAt: null,
    ...extra,
  };
}

describe('legacyViewFromActiveList keeps every category', () => {
  test('items in categories outside CATEGORY_ORDER are not dropped', () => {
    const list = {
      id: 1,
      enrichmentStatus: 'done',
      items: [
        item(1, 'Aluminiumsfolie', 'Kj\u00f8kken'),
        item(2, 'Melk', 'Meieri'),
        item(3, 'Majones', 'other'),
        item(4, 'Ukjent', null),
      ],
    };
    const view = legacyViewFromActiveList(list);
    const names = view.categories.flatMap((c) => c.items.map((i) => i.name)).sort();
    assert.deepEqual(names, ['Aluminiumsfolie', 'Majones', 'Melk', 'Ukjent']);
  });

  test('known categories keep CATEGORY_ORDER, unknown ones follow in first-seen order', () => {
    const list = {
      id: 1,
      enrichmentStatus: 'done',
      items: [
        item(1, 'Folie', 'Kj\u00f8kken'),
        item(2, 'Majones', 'other'),
        item(3, 'Melk', 'Meieri'),
        item(4, 'Laks', 'Kj\u00f8tt & fisk'),
      ],
    };
    const cats = legacyViewFromActiveList(list).categories.map((c) => c.category);
    assert.deepEqual(cats, ['Kj\u00f8tt & fisk', 'Meieri', 'Kj\u00f8kken', 'other']);
  });

  test('items hidden because pantry covers them are still hidden', () => {
    const list = {
      id: 1,
      enrichmentStatus: 'done',
      items: [item(1, 'Salt', 'Kj\u00f8kken', { pantryHas: true, needsBuy: false })],
    };
    assert.deepEqual(legacyViewFromActiveList(list).categories, []);
  });
});

describe('orderCategories', () => {
  test('empty map gives empty array', () => {
    assert.deepEqual(orderCategories({}), []);
  });

  test('empty buckets are skipped', () => {
    assert.deepEqual(orderCategories({ Meieri: [], other: [{ name: 'x' }] }), [
      { category: 'other', items: [{ name: 'x' }] },
    ]);
  });

  test('only known categories gives the same result as the old whitelist', () => {
    const catMap = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, [{ name: c }]]));
    assert.deepEqual(
      orderCategories(catMap).map((c) => c.category),
      CATEGORY_ORDER
    );
  });
});
