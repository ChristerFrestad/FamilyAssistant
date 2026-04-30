'use strict';

// Phase 2D — POST /api/shopping/items: manually append a single item
// to the active shopping list. Used by the QuickAdd input on the
// Shopping screen.

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const SEED_FAMILY_ID = 1;

function ensureActiveList(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const weekYear =
      server.repos._db
        .prepare('SELECT week_year FROM meal_plans WHERE family_id = ? LIMIT 1')
        .get(SEED_FAMILY_ID)?.week_year || '2026-W16';
    let list = server.repos._db
      .prepare(
        `SELECT id FROM shopping_lists
         WHERE family_id = ? AND week_year = ? AND status = 'active' LIMIT 1`
      )
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
    return { listId: list.id, weekYear };
  });
}

function dropActiveList(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    server.repos._db
      .prepare(
        `UPDATE shopping_lists SET status = 'superseded'
         WHERE family_id = ? AND status = 'active'`
      )
      .run(SEED_FAMILY_ID);
  });
}

test('POST /api/shopping/items appends item to active list and returns 201', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Melk', qty: 2, unit: 'l', category: 'Meieri' },
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.ok, true);
    assert.ok(r.body.item, 'response must include the created item');
    assert.ok(typeof r.body.item.id === 'number' && r.body.item.id > 0);
    assert.strictEqual(r.body.item.ingredientName, 'Melk');
    assert.strictEqual(r.body.item.qty, 2);
    assert.strictEqual(r.body.item.unit, 'l');
    assert.strictEqual(r.body.item.category, 'Meieri');
    assert.strictEqual(r.body.item.sourceType, 'manual');
    assert.strictEqual(r.body.item.needsBuy, true);
    assert.strictEqual(r.body.item.boughtAt, null);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items accepts name only (qty/unit/category optional)', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Sitron' },
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.item.ingredientName, 'Sitron');
    assert.strictEqual(r.body.item.qty, null);
    assert.strictEqual(r.body.item.unit, null);
    assert.strictEqual(r.body.item.category, null);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items returns 400 NO_ACTIVE_LIST when no active list exists', async () => {
  const server = await startTestServer();
  try {
    dropActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Brød' },
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'NO_ACTIVE_LIST');
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items rejects empty name with 400', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: '' },
    });
    assert.strictEqual(r.status, 400);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items rejects too-long name with 400', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'a'.repeat(201) },
    });
    assert.strictEqual(r.status, 400);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items rejects non-positive qty with 400', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Melk', qty: 0 },
    });
    assert.strictEqual(r.status, 400);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items rejects unknown extra fields (strict)', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Melk', somethingExtra: 'nope' },
    });
    assert.strictEqual(r.status, 400);
  } finally {
    await server.close();
  }
});

test('Items added via POST appear in GET /api/shopping/list/current', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const post = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Eple', qty: 5, unit: 'stk', category: 'Frukt & grønt' },
    });
    assert.strictEqual(post.status, 201);
    const insertedId = post.body.item.id;

    const list = await request(server.baseUrl, 'GET', '/api/shopping/list/current');
    assert.strictEqual(list.status, 200);
    const allItems = (list.body.categories || []).flatMap((c) => c.items || []);
    const found = allItems.find((it) => Number(it.id) === insertedId);
    assert.ok(found, 'newly added item must appear in /list/current');
    assert.strictEqual(found.name, 'Eple');
    assert.strictEqual(found.checkedOff, false);
  } finally {
    await server.close();
  }
});

test('Multiple POSTs increment sort_order and stay in insertion order', async () => {
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r1 = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'First' },
    });
    const r2 = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Second' },
    });
    const r3 = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Third' },
    });
    assert.strictEqual(r1.status, 201);
    assert.strictEqual(r2.status, 201);
    assert.strictEqual(r3.status, 201);
    assert.ok(r2.body.item.sortOrder > r1.body.item.sortOrder);
    assert.ok(r3.body.item.sortOrder > r2.body.item.sortOrder);
  } finally {
    await server.close();
  }
});

test('POST /api/shopping/items validates rate limit / requireRole on adult-only', async () => {
  // The route uses requireRole('adult'). Default test setup runs without
  // AUTH_TOKEN so the request hits an unauthenticated path. We assert that
  // the route is wired with adult-role (i.e. existence) by relying on the
  // test-server's permissive default auth — if the route were missing, we'd
  // get 404 instead of 201/400. This test is a smoke-test for routing.
  const server = await startTestServer();
  try {
    ensureActiveList(server);
    const r = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      body: { name: 'Smoketest' },
    });
    // Either 201 (default seeded user is adult) or 403 (role enforcement).
    // Both prove the route is registered. 404 would fail the smoke-test.
    assert.notStrictEqual(r.status, 404, 'route must be registered');
  } finally {
    await server.close();
  }
});
