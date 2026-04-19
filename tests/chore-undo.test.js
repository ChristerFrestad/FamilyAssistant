'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const SEED_FAMILY_ID = 1;

function setupChoreSchedule(server) {
  return runWithFamily(SEED_FAMILY_ID, () => {
    // Pick the first seeded chore if it exists; otherwise insert a
    // synthetic chore for the test. Either way we insert a schedule
    // row directly so markDone/markUndone have a target to UPDATE.
    let chore = server.repos.chores.getAll()[0];
    if (!chore) {
      const res = server.repos._db
        .prepare(
          `INSERT INTO chores (family_id, task, frequency, default_day, icon, active)
           VALUES (?, 'Test-oppgave', 'ukentlig', 0, '🧪', 1)`
        )
        .run(SEED_FAMILY_ID);
      chore = { id: Number(res.lastInsertRowid) };
    }
    const weekYearRow = server.repos._db
      .prepare('SELECT week_year FROM meal_plans WHERE family_id = ? LIMIT 1')
      .get(SEED_FAMILY_ID);
    const weekYear = weekYearRow?.week_year || '2026-W16';
    server.repos._db
      .prepare(
        `INSERT OR REPLACE INTO chore_schedules
           (family_id, chore_id, week_year, scheduled_day, status, completed_at, postponed_to)
         VALUES (?, ?, ?, 0, 'pending', NULL, NULL)`
      )
      .run(SEED_FAMILY_ID, chore.id, weekYear);
    // Sanity check — the row really is in the DB before we start.
    const sanity = server.repos._db
      .prepare(
        'SELECT status FROM chore_schedules WHERE family_id = ? AND chore_id = ? AND week_year = ?'
      )
      .get(SEED_FAMILY_ID, chore.id, weekYear);
    assert.ok(sanity, 'fixture insert failed');
    return { choreId: chore.id, weekYear };
  });
}

test('PUT /api/chores/undone resets a done chore to pending', async () => {
  const server = await startTestServer();
  try {
    const { choreId, weekYear } = setupChoreSchedule(server);

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
          `SELECT status, completed_at FROM chore_schedules
           WHERE family_id = ? AND chore_id = ? AND week_year = ?`
        )
        .get(SEED_FAMILY_ID, choreId, weekYear);
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
    const { choreId, weekYear } = setupChoreSchedule(server);

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
          `SELECT status, postponed_to FROM chore_schedules
           WHERE family_id = ? AND chore_id = ? AND week_year = ?`
        )
        .get(SEED_FAMILY_ID, choreId, weekYear);
      assert.ok(row);
      assert.strictEqual(row.status, 'pending');
      assert.strictEqual(row.postponed_to, null);
    });
  } finally {
    await server.close();
  }
});
