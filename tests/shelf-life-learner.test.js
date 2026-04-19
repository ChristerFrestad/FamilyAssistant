'use strict';

// PR A.2 — unit tests for the pure trimmed-mean helper and the
// effectiveShelfDays fallback. The full observation → DB path lives in
// a separate integration test.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  trimmedMean,
  MIN_SAMPLES_TO_TRUST,
} = require('../server/services/shelf-life-learner.service');

test('trimmedMean returns null on empty / invalid input', () => {
  assert.strictEqual(trimmedMean([]), null);
  assert.strictEqual(trimmedMean(null), null);
  assert.strictEqual(trimmedMean(['bogus']), null);
});

test('trimmedMean averages all samples when fewer than 5', () => {
  assert.strictEqual(trimmedMean([3, 4, 5]), 4);
  assert.strictEqual(trimmedMean([2, 8]), 5);
});

test('trimmedMean drops min and max once N >= 5', () => {
  // Samples: [1, 4, 5, 6, 40] — trim removes 1 and 40, mean of (4+5+6)=5.
  assert.strictEqual(trimmedMean([1, 4, 5, 6, 40]), 5);
});

test('trimmedMean handles NaN-ish inputs by filtering them out', () => {
  assert.strictEqual(trimmedMean([4, 'x', 6, null, undefined]), 5);
});

test('MIN_SAMPLES_TO_TRUST is exported for the service and tests to share', () => {
  assert.strictEqual(typeof MIN_SAMPLES_TO_TRUST, 'number');
  assert.ok(MIN_SAMPLES_TO_TRUST >= 1);
});
