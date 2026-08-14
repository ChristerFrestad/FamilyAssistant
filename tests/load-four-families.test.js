'use strict';

// G5-2: four families, parallel writes, fail on 5xx / SQLITE_BUSY.
// Requires the script's run() so CI embeds startTestServer (no live server).

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { run, FAMILY_COUNT, BATCHES_PER_FAMILY } = require('../scripts/load-four-families');

describe('G5-2 four-family parallel load', { timeout: 28_000 }, () => {
  test('run() creates four families and reports zero SQLITE_BUSY or 5xx', async () => {
    const summary = await run({ exitOnError: false });

    assert.equal(
      summary.families,
      FAMILY_COUNT,
      `expected ${FAMILY_COUNT} families: ${JSON.stringify(summary)}`
    );
    assert.ok(
      summary.requests >= FAMILY_COUNT * BATCHES_PER_FAMILY * 2,
      `expected at least ${FAMILY_COUNT * BATCHES_PER_FAMILY * 2} requests, got ${summary.requests}`
    );
    assert.equal(summary.errors, 0, `load errors (5xx or SQLITE_BUSY): ${JSON.stringify(summary)}`);
  });
});
