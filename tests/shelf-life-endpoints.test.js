'use strict';

// PR A.2 — integration tests for the expiry endpoints and the
// learn-over-time loop: each fresh observation updates
// products.shelf_days_learned and, once the sample count crosses the
// trust threshold, effectiveShelfDays starts returning the learned value.

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

function createBoughtShoppingItem(server, productKey) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const weekYearRow = server.repos._db
      .prepare('SELECT week_year FROM meal_plans WHERE family_id = ? LIMIT 1')
      .get(SEED_FAMILY_ID);
    const weekYear = weekYearRow?.week_year || '2026-W16';
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
    const today = new Date().toISOString().slice(0, 10);
    const res = server.repos._db
      .prepare(
        `INSERT INTO shopping_list_items
           (family_id, list_id, source_type, source_ref, ingredient_name, product_key,
            qty, unit, pack_size, pack_unit, pack_count, pantry_has, needs_buy,
            bought_at, bought_qty)
         VALUES (?, ?, 'recipe', 'test', 'Test', ?, 1, 'stk', 1, 'stk', 1, 0, 0, ?, 1)`
      )
      .run(SEED_FAMILY_ID, list.id, productKey, `${today} 12:00:00`);
    return { itemId: Number(res.lastInsertRowid), today };
  });
}

test('POST /api/shopping/items/:id/expiry rejects pre-purchase dates', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const { itemId } = createBoughtShoppingItem(server, pk);
    const r = await request(server.baseUrl, 'POST', `/api/shopping/items/${itemId}/expiry`, {
      body: { expiresAt: '2020-01-01' },
    });
    assert.ok(r.status >= 400 && r.status < 500);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items/:id/expiry rejects items that are not bought yet', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const itemId = runWithFamily(SEED_FAMILY_ID, () => {
      const weekYearRow = server.repos._db
        .prepare('SELECT week_year FROM meal_plans WHERE family_id = ? LIMIT 1')
        .get(SEED_FAMILY_ID);
      const weekYear = weekYearRow?.week_year || '2026-W16';
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
           VALUES (?, ?, 'recipe', 'test', 'Test', ?, 1, 'stk', 1, 'stk', 1, 0, 1)`
        )
        .run(SEED_FAMILY_ID, list.id, pk);
      return Number(res.lastInsertRowid);
    });
    const r = await request(server.baseUrl, 'POST', `/api/shopping/items/${itemId}/expiry`, {
      body: { expiresAt: '2030-01-01' },
    });
    assert.ok(r.status >= 400 && r.status < 500);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items/:id/expiry stores an observation and updates products once trust threshold passes', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;

    // Three consecutive observations — hits the MIN_SAMPLES_TO_TRUST=3
    // threshold on the third insert.
    for (let i = 1; i <= 3; i++) {
      const { itemId, today } = createBoughtShoppingItem(server, pk);
      const expiresAt = new Date(Date.now() + (5 + i) * 86_400_000).toISOString().slice(0, 10);
      const r = await request(server.baseUrl, 'POST', `/api/shopping/items/${itemId}/expiry`, {
        body: { expiresAt },
      });
      assert.strictEqual(r.status, 200, `iteration ${i}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.ok);
      assert.strictEqual(r.body.sampleCount, i);
      // today is only used to document the capture in test output.
      void today;
    }

    const summary = await request(
      server.baseUrl,
      'GET',
      `/api/products/${encodeURIComponent(pk)}/shelf-life`
    );
    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.body.sampleCount, 3);
    assert.ok(
      Number.isFinite(Number(summary.body.learnedDays)),
      `learnedDays should be set after 3 samples: ${JSON.stringify(summary.body)}`
    );
    assert.strictEqual(summary.body.effectiveDays, summary.body.learnedDays);
  } finally {
    await server.close();
  }
});

test('PUT /api/pantry/expiry records an observation and updates inventory.expires_est', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const expiresAt = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

    const r = await request(server.baseUrl, 'PUT', '/api/pantry/expiry', {
      body: { productKey: pk, expiresAt },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.daysLasted, 10);

    runWithFamily(SEED_FAMILY_ID, () => {
      const inv = server.repos.inventory.getByKey(pk);
      assert.ok(inv);
      assert.strictEqual(inv.expiresEst, expiresAt);
    });
  } finally {
    await server.close();
  }
});

test('GET /api/products/:productKey/shelf-life returns null learnedDays below threshold', async () => {
  const server = await startTestServer();
  try {
    const pk = anySeededProductKey(server);
    if (!pk) return;
    const summary = await request(
      server.baseUrl,
      'GET',
      `/api/products/${encodeURIComponent(pk)}/shelf-life`
    );
    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.body.sampleCount, 0);
    assert.strictEqual(summary.body.learnedDays, null);
    // effectiveDays should still be populated from seeded shelf_days.
    assert.ok(summary.body.seedDays !== undefined);
  } finally {
    await server.close();
  }
});
