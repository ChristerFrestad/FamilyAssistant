'use strict';

// Integration: GET /api/shopping/list/current orders categories by the
// family's learned store walk once there are at least two earlier trips.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const FAMILY = 1;

function insertList(db, weekYear, status) {
  return Number(
    db
      .prepare(
        `INSERT INTO shopping_lists (family_id, week_year, status, enrichment_status)
         VALUES (?, ?, ?, 'done')`
      )
      .run(FAMILY, weekYear, status).lastInsertRowid
  );
}

function insertItem(db, listId, name, category, sortOrder, boughtAt = null) {
  db.prepare(
    `INSERT INTO shopping_list_items
       (family_id, list_id, source_type, ingredient_name, category, qty, unit,
        needs_buy, sort_order, bought_at)
     VALUES (?, ?, 'manual', ?, ?, 1, 'stk', ?, ?, ?)`
  ).run(FAMILY, listId, name, category, boughtAt ? 0 : 1, sortOrder, boughtAt);
}

function categoriesOf(body) {
  return (body.categories || []).map((c) => c.category);
}

test('categories follow the learned store walk', async () => {
  const server = await startTestServer();
  try {
    const first = await request(server.baseUrl, 'GET', '/api/shopping/list/current');
    assert.equal(first.status, 200);
    const wk = first.body.weekYear;
    const db = server.repos._db;

    runWithFamily(FAMILY, () => {
      // Replace whatever the seed made active this week with a known list.
      db.prepare(
        `UPDATE shopping_lists SET status = 'superseded'
         WHERE family_id = ? AND week_year = ? AND status = 'active'`
      ).run(FAMILY, wk);
      const active = insertList(db, wk, 'active');
      insertItem(db, active, 'Laks', 'Kj\u00f8tt & fisk', 1);
      insertItem(db, active, 'Melk', 'Meieri', 2);
      insertItem(db, active, 'Epler', 'Frukt & gr\u00f8nt', 3);
    });

    const before = await request(server.baseUrl, 'GET', '/api/shopping/list/current');
    assert.deepEqual(categoriesOf(before.body), [
      'Kj\u00f8tt & fisk',
      'Meieri',
      'Frukt & gr\u00f8nt',
    ]);

    runWithFamily(FAMILY, () => {
      for (const [wkPast, day] of [
        ['2026-W38', '2026-09-17'],
        ['2026-W39', '2026-09-24'],
      ]) {
        const id = insertList(db, wkPast, 'done');
        insertItem(db, id, 'Bananer', 'Frukt & gr\u00f8nt', 1, `${day} 15:00:00`);
        insertItem(db, id, 'Yoghurt', 'Meieri', 2, `${day} 15:06:00`);
        insertItem(db, id, 'Kylling', 'Kj\u00f8tt & fisk', 3, `${day} 15:12:00`);
      }
    });

    const after = await request(server.baseUrl, 'GET', '/api/shopping/list/current');
    assert.equal(after.status, 200);
    assert.deepEqual(categoriesOf(after.body), [
      'Frukt & gr\u00f8nt',
      'Meieri',
      'Kj\u00f8tt & fisk',
    ]);
    // Nothing dropped.
    const names = after.body.categories.flatMap((c) => c.items.map((i) => i.name)).sort();
    assert.deepEqual(names, ['Epler', 'Laks', 'Melk']);
  } finally {
    await server.close();
  }
});
