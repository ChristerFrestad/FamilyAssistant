'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  splitIntoTrips,
  learnCategoryOrder,
  applyLearnedOrder,
} = require('../server/services/store-order.service');

function row(listId, category, boughtAt) {
  return { listId, category, boughtAt };
}

describe('splitIntoTrips', () => {
  test('one list ticked off in one go is one trip, categories in first-seen order', () => {
    const trips = splitIntoTrips([
      row(1, 'Frukt & gr\u00f8nt', '2026-10-08 15:00:00'),
      row(1, 'Meieri', '2026-10-08 15:05:00'),
      row(1, 'Frukt & gr\u00f8nt', '2026-10-08 15:06:00'),
      row(1, 'Kj\u00f8tt & fisk', '2026-10-08 15:10:00'),
    ]);
    assert.deepEqual(trips, [['Frukt & gr\u00f8nt', 'Meieri', 'Kj\u00f8tt & fisk']]);
  });

  test('a long gap on the same list starts a new trip', () => {
    const trips = splitIntoTrips([
      row(1, 'Meieri', '2026-10-08 15:00:00'),
      row(1, 'Barn', '2026-10-08 15:02:00'),
      row(1, 'Husholdning', '2026-10-10 11:00:00'),
    ]);
    assert.equal(trips.length, 2);
  });

  test('null category becomes other and bad timestamps are ignored', () => {
    const trips = splitIntoTrips([
      row(1, null, '2026-10-08 15:00:00'),
      row(1, 'Meieri', 'not-a-date'),
    ]);
    assert.deepEqual(trips, [['other']]);
  });

  test('empty input gives no trips', () => {
    assert.deepEqual(splitIntoTrips([]), []);
    assert.deepEqual(splitIntoTrips(undefined), []);
  });
});

describe('learnCategoryOrder', () => {
  test('needs at least two usable trips', () => {
    assert.deepEqual(learnCategoryOrder([['A', 'B']]), []);
    assert.deepEqual(learnCategoryOrder([['A'], ['B']]), []);
  });

  test('consistent store walk is learned', () => {
    const order = learnCategoryOrder([
      ['Frukt', 'Meieri', 'Kj\u00f8tt'],
      ['Frukt', 'Meieri', 'Kj\u00f8tt'],
    ]);
    assert.deepEqual(order, ['Frukt', 'Meieri', 'Kj\u00f8tt']);
  });

  test('one odd trip does not flip a stable pattern', () => {
    const order = learnCategoryOrder([
      ['Frukt', 'Meieri', 'Kj\u00f8tt'],
      ['Frukt', 'Meieri', 'Kj\u00f8tt'],
      ['Frukt', 'Meieri', 'Kj\u00f8tt'],
      ['Kj\u00f8tt', 'Meieri', 'Frukt'],
    ]);
    assert.deepEqual(order, ['Frukt', 'Meieri', 'Kj\u00f8tt']);
  });

  test('categories seen only once are left out', () => {
    const order = learnCategoryOrder([
      ['Frukt', 'Barn', 'Meieri'],
      ['Frukt', 'Meieri'],
    ]);
    assert.deepEqual(order, ['Frukt', 'Meieri']);
  });
});

describe('applyLearnedOrder', () => {
  const entries = [
    ['Kj\u00f8tt', [1]],
    ['other', [2]],
    ['Meieri', [3]],
    ['Frukt', [4]],
  ];

  test('learned categories first in learned order, rest keep original order', () => {
    const out = applyLearnedOrder(entries, ['Frukt', 'Meieri']);
    assert.deepEqual(
      out.map((e) => e[0]),
      ['Frukt', 'Meieri', 'Kj\u00f8tt', 'other']
    );
  });

  test('no learned order returns input unchanged', () => {
    assert.equal(applyLearnedOrder(entries, []), entries);
  });

  test('never drops or duplicates entries', () => {
    const out = applyLearnedOrder(entries, ['X', 'Meieri', 'Meieri']);
    assert.equal(out.length, entries.length);
    assert.deepEqual(new Set(out.map((e) => e[0])), new Set(entries.map((e) => e[0])));
  });
});
