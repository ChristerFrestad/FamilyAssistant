'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const SEED_FAMILY_ID = 1;

function seedScheduleForFirstChore(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    const chore = server.repos.chores.getAll()[0];
    if (!chore) return { choreId: null, weekYear: null };
    // Ensure a chore_schedules row exists for the current week so
    // markDone/markUndone have something to UPDATE.
    const weekYearRow = server.repos._db
      .prepare('SELECT week_year FROM meal_plans WHERE family_id = ? LIMIT 1')
      .get(SEED_FAMILY_ID);
    const weekYear = weekYearRow?.week_year || '2026-W16';
    server.repos.choreSchedules.seedDefault(weekYear);
    return { choreId: chore.id, weekYear };
  });
}

test('PUT /api/chores/undone resets a done chore to pending', async () => {
  const server = await startTestServer();
  try {
    const { choreId, weekYear } = seedScheduleForFirstChore(server);
    if (!choreId) return;

    const complete = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
      body: { weekYear, choreId },
    });
    assert.strictEqual(complete.status, 200);

    const undo = await request(server.baseUrl, 'PUT', '/api/chores/undone', {
      body: { weekYear, choreId },
    });
    assert.strictEqual(undo.status, 200);

    runWithFamily(SEED_FAMILY_ID, () => {
      const row = server.repos._db
        .prepare(
          'SELECT status, completed_at FROM chore_schedules WHERE family_id = ? AND chore_id = ? LIMIT 1'
        )
        .get(SEED_FAMILY_ID, choreId);
      assert.ok(row, 'schedule row should exist');
      assert.strictEqual(row.status, 'pending');
      assert.strictEqual(row.completed_at, null);
    });
  } finally {
    await server.close();
  }
});

test('PUT /api/chores/undone also resets postponed to pending', async () => {
  const server = await startTestServer();
  try {
    const { choreId, weekYear } = seedScheduleForFirstChore(server);
    if (!choreId) return;

    await request(server.baseUrl, 'PUT', '/api/chores/postpone', {
      body: { weekYear, choreId },
    });
    const undo = await request(server.baseUrl, 'PUT', '/api/chores/undone', {
      body: { weekYear, choreId },
    });
    assert.strictEqual(undo.status, 200);

    runWithFamily(SEED_FAMILY_ID, () => {
      const row = server.repos._db
        .prepare(
          'SELECT status, postponed_to FROM chore_schedules WHERE family_id = ? AND chore_id = ? LIMIT 1'
        )
        .get(SEED_FAMILY_ID, choreId);
      assert.strictEqual(row.status, 'pending');
      assert.strictEqual(row.postponed_to, null);
    });
  } finally {
    await server.close();
  }
});
