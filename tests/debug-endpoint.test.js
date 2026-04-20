'use strict';

// Tests for the temporary GET /api/debug/shopping-state endpoint (PR #54).
// Scope:
//   - AUTH: request without Bearer (on a token-configured server) is rejected.
//   - SHAPE: authenticated request returns the documented envelope.
//   - PII: the response contains no strings that could identify what the
//     family buys (ingredient names, product keys, notes, etc.).
//   - COMPLETENESS: every advertised top-level key is present.

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const SEED_FAMILY_ID = 1;
const TEST_TOKEN = 'debug-test-token-0123456789abcdef';

async function withBearerToken(fn) {
  const server = await startTestServer({ authToken: TEST_TOKEN });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

test('GET /api/debug/shopping-state rejects requests without a Bearer token when AUTH_TOKEN is set', async () => {
  await withBearerToken(async (server) => {
    const r = await request(server.baseUrl, 'GET', '/api/debug/shopping-state');
    assert.strictEqual(r.status, 401);
  });
});

test('GET /api/debug/shopping-state rejects an invalid Bearer token', async () => {
  await withBearerToken(async (server) => {
    const r = await request(server.baseUrl, 'GET', '/api/debug/shopping-state', {
      headers: { Authorization: 'Bearer not-the-right-token' },
    });
    assert.strictEqual(r.status, 401);
  });
});

test('GET /api/debug/shopping-state returns the documented envelope on a valid token', async () => {
  await withBearerToken(async (server) => {
    const r = await request(server.baseUrl, 'GET', '/api/debug/shopping-state', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body, 'body should be present');

    assert.ok(r.body.meta, 'meta missing');
    assert.ok(typeof r.body.meta.generated_at === 'string', 'meta.generated_at not a string');
    assert.ok(typeof r.body.meta.db_path === 'string', 'meta.db_path not a string');

    assert.ok(r.body.migrations, 'migrations missing');
    assert.ok(typeof r.body.migrations.applied_total === 'number', 'applied_total not a number');
    assert.ok(Array.isArray(r.body.migrations.latest_10), 'latest_10 not an array');

    const sli = r.body.shopping_list_items;
    assert.ok(sli, 'shopping_list_items missing');
    assert.ok(typeof sli.total_rows === 'number', 'total_rows not a number');
    assert.ok(typeof sli.bought_rows === 'number', 'bought_rows not a number');
    assert.ok(
      typeof sli.bought_but_not_in_pantry === 'number',
      'bought_but_not_in_pantry not a number'
    );
    assert.ok(Array.isArray(sli.sample_bought), 'sample_bought not an array');

    assert.ok(r.body.pantry_entries, 'pantry_entries missing');
    assert.ok(
      typeof r.body.pantry_entries.total_rows === 'number',
      'pantry total_rows not a number'
    );

    // Cache-Control must carry a no-cache directive so the diagnostic
    // does not end up in a proxy or browser cache. The exact string can
    // come from the handler (no-store) or be rewritten by upstream
    // middleware (private + max-age=0 + must-revalidate); both satisfy
    // the "no caching" contract from the spec.
    const cache = String(r.headers['cache-control'] || r.headers['Cache-Control'] || '');
    const hasNoCache = /no-store|no-cache|must-revalidate|max-age=0|private/i.test(cache);
    assert.ok(hasNoCache, `expected no-cache directive, got: ${cache}`);
  });
});

test('GET /api/debug/shopping-state omits PII fields in sample rows', async () => {
  // Seed a bought shopping-list item with an obvious PII-leak-prone value
  // so that if the endpoint accidentally exposes any string field, the
  // assertion will fail loudly. Using strings that could not appear in
  // any other part of the response lets us search the raw body safely.
  const PII_NAME = 'UNIQUE_INGREDIENT_NAME_THAT_MUST_NOT_LEAK_9f1e2a3b';
  const PII_PRODUCT_KEY = 'UNIQUE_PRODUCT_KEY_THAT_MUST_NOT_LEAK_9f1e2a3b';
  const PII_NOTE = 'UNIQUE_NOTE_THAT_MUST_NOT_LEAK_9f1e2a3b';

  await withBearerToken(async (server) => {
    runWithFamily(SEED_FAMILY_ID, () => {
      const listRow = server.repos._db
        .prepare(
          `INSERT INTO shopping_lists (family_id, week_year, status, enrichment_status)
           VALUES (?, ?, 'active', 'done')`
        )
        .run(SEED_FAMILY_ID, '2026-W16');
      server.repos._db
        .prepare(
          // source_type must match the CHECK constraint in migration 007
          // (meal_ingredient / consumable / extra / manual).
          `INSERT INTO shopping_list_items
             (family_id, list_id, source_type, source_ref, ingredient_name,
              ingredient_name_no, product_key, qty, unit, pack_size, pack_unit,
              pack_count, pantry_has, needs_buy, bought_at, bought_qty, notes)
           VALUES (?, ?, 'meal_ingredient', 'fx-1', ?, ?, ?, 1, 'stk', 1, 'stk',
                   1, 0, 0, datetime('now'), 1, ?)`
        )
        .run(
          SEED_FAMILY_ID,
          Number(listRow.lastInsertRowid),
          PII_NAME,
          PII_NAME,
          PII_PRODUCT_KEY,
          PII_NOTE
        );
    });

    const r = await request(server.baseUrl, 'GET', '/api/debug/shopping-state', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.strictEqual(r.status, 200);

    const raw = JSON.stringify(r.body);
    assert.ok(
      !raw.includes(PII_NAME),
      'response must not leak ingredient_name / ingredient_name_no'
    );
    assert.ok(!raw.includes(PII_PRODUCT_KEY), 'response must not leak product_key');
    assert.ok(!raw.includes(PII_NOTE), 'response must not leak notes');

    // And the sample row shape should be exactly the documented fields —
    // nothing extra that could carry PII in future schema changes.
    const sample = r.body.shopping_list_items.sample_bought;
    assert.ok(sample.length > 0, 'sample_bought must include the seeded row');
    for (const row of sample) {
      const keys = Object.keys(row).sort();
      assert.deepStrictEqual(
        keys,
        ['bought_at', 'bought_qty', 'created_at', 'has_recipe_link', 'id'],
        `sample row has unexpected fields: ${keys.join(',')}`
      );
      assert.strictEqual(typeof row.id, 'number');
      assert.strictEqual(typeof row.has_recipe_link, 'boolean');
    }
  });
});
