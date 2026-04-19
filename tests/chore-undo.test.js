'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const SEED_FAMILY_ID = 1;

function firstChoreId(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const c = server.repos.chores.getAll()[0];
    return c ? c.id : null;
  });
}

test('PUT /api/chores/undone resets a done chore to pending', async () => {
  const server = await startTestServer();
  try {
    const choreId = firstChoreId(server);
    if (!choreId) return;

    // Complete first so there is something to undo.
    const r1 = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
      body: { choreId },
    });
    assert.strictEqual(r1.status, 200);

    const r2 = await request(server.baseUrl, 'PUT', '/api/chores/undone', {
      body: { choreId },
    });
    assert.strictEqual(r2.status, 200);

    // Verify in DB.
    runWithFamily(SEED_FAMILY_ID, () => {
      const row = server.repos._db
        .prepare('SELECT status, completed_at FROM chore_schedules WHERE chore_id = ? LIMIT 1')
        .get(choreId);
      assert.ok(row, 'schedule row should exist');
      assert.strictEqual(row.status, 'pending');
      assert.strictEqual(row.completed_at, null);
    });
  } finally {
    await server.close();
  }
});

test('PUT /api/chores/undone also resets postponed → pending', async () => {
  const server = await startTestServer();
  try {
    const choreId = firstChoreId(server);
    if (!choreId) return;

    await request(server.baseUrl, 'PUT', '/api/chores/postpone', {
      body: { choreId },
    });
    const r = await request(server.baseUrl, 'PUT', '/api/chores/undone', {
      body: { choreId },
    });
    assert.strictEqual(r.status, 200);

    runWithFamily(SEED_FAMILY_ID, () => {
      const row = server.repos._db
        .prepare('SELECT status, postponed_to FROM chore_schedules WHERE chore_id = ? LIMIT 1')
        .get(choreId);
      assert.strictEqual(row.status, 'pending');
      assert.strictEqual(row.postponed_to, null);
    });
  } finally {
    await server.close();
  }
});
