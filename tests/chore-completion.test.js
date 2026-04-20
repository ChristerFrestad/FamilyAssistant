'use strict';

// Tests for server/repositories/chore-completion.repo.js — the
// gamification history log introduced in uke 2 B5 (migration 019).
//
// Verifies:
//   - Migration created the table with expected columns
//   - insert / removeLatest / count* methods behave correctly
//   - Tenant-isolation: family A and B never see each other's rows
//   - Integration with chore.repo.js's markDone/markUndone (atomic
//     schedule update + history write)

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

let server;

function createFamily(name) {
  return Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
}

function createUser(email, familyId, role = 'owner') {
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, role);
  return user;
}

function seedChoreInFamily(familyId, choreId = 901, task = 'Støvsuge') {
  // INSERT OR IGNORE so the same seed can run across multiple test cases
  // without unique-constraint noise.
  server.repos._db
    .prepare(
      `INSERT OR IGNORE INTO chores (id, family_id, task, frequency, default_day, active)
       VALUES (?, ?, ?, 'weekly', 1, 1)`
    )
    .run(choreId, familyId, task);
  server.repos._db
    .prepare(
      `INSERT OR IGNORE INTO chore_schedules (family_id, chore_id, week_year, scheduled_day, status)
       VALUES (?, ?, '2026-W17', 1, 'pending')`
    )
    .run(familyId, choreId);
  return choreId;
}

before(async () => {
  server = await startTestServer({ authToken: 'chore-completion-test-1234567890abcdef' });
});

after(async () => {
  await server.close();
});

// ============================================================
// Schema
// ============================================================

test('migration 019 created chore_completions table with expected columns', () => {
  const cols = server.repos._db.prepare('PRAGMA table_info(chore_completions)').all();
  const names = cols.map((c) => c.name).sort();
  assert.deepEqual(
    names,
    ['chore_id', 'completed_at', 'family_id', 'id', 'user_id', 'week_year', 'xp_awarded'].sort()
  );
});

test('indexes idx_chore_completions_family_week + _user_week exist', () => {
  const rows = server.repos._db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chore_completions'")
    .all()
    .map((r) => r.name);
  assert.ok(
    rows.includes('idx_chore_completions_family_week'),
    `missing family_week index, got: ${rows.join(', ')}`
  );
  assert.ok(
    rows.includes('idx_chore_completions_user_week'),
    `missing user_week index, got: ${rows.join(', ')}`
  );
});

// ============================================================
// Repo-level behavior
// ============================================================

test('insert returns the new id and stores the row', () => {
  const fid = createFamily('CC Repo insert');
  const choreId = seedChoreInFamily(fid);

  const result = runWithFamily(fid, () =>
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: null })
  );
  assert.ok(Number.isInteger(result.id) && result.id > 0);

  const row = server.repos._db
    .prepare(
      'SELECT family_id, week_year, chore_id, user_id, xp_awarded FROM chore_completions WHERE id = ?'
    )
    .get(result.id);
  assert.deepEqual(row, {
    family_id: fid,
    week_year: '2026-W17',
    chore_id: choreId,
    user_id: null,
    xp_awarded: 0,
  });
});

test('insert accepts a real user_id', () => {
  const fid = createFamily('CC Repo insert with user');
  const user = createUser('cc-repo-user@test.local', fid);
  const choreId = seedChoreInFamily(fid);

  const r = runWithFamily(fid, () =>
    server.repos.choreCompletions.insert({
      weekYear: '2026-W17',
      choreId,
      userId: user.id,
    })
  );
  const row = server.repos._db
    .prepare('SELECT user_id FROM chore_completions WHERE id = ?')
    .get(r.id);
  assert.equal(row.user_id, user.id);
});

test('removeLatest deletes only the newest row for (family, week, chore)', () => {
  const fid = createFamily('CC Repo removeLatest');
  const choreId = seedChoreInFamily(fid);

  runWithFamily(fid, () => {
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: null });
  });
  // Ensure a different completed_at by nudging the clock via an INSERT
  // with explicit timestamp — node:test does not let us freeze time.
  server.repos._db
    .prepare(
      `INSERT INTO chore_completions (family_id, week_year, chore_id, user_id, completed_at)
         VALUES (?, '2026-W17', ?, NULL, datetime('now', '+10 seconds'))`
    )
    .run(fid, choreId);

  const beforeCount = runWithFamily(fid, () =>
    server.repos.choreCompletions.countForFamilyWeek('2026-W17')
  );
  assert.equal(beforeCount, 2);

  const r = runWithFamily(fid, () =>
    server.repos.choreCompletions.removeLatest({ weekYear: '2026-W17', choreId })
  );
  assert.equal(r.removed, 1);

  const afterCount = runWithFamily(fid, () =>
    server.repos.choreCompletions.countForFamilyWeek('2026-W17')
  );
  assert.equal(afterCount, 1);
});

test('removeLatest returns { removed: 0 } when no rows match', () => {
  const fid = createFamily('CC Repo removeLatest-empty');
  const choreId = seedChoreInFamily(fid);

  const r = runWithFamily(fid, () =>
    server.repos.choreCompletions.removeLatest({ weekYear: '2026-W17', choreId })
  );
  assert.equal(r.removed, 0);
});

test('countForUserWeek returns 0 when userId is null', () => {
  const fid = createFamily('CC Repo count-null');
  const choreId = seedChoreInFamily(fid);
  runWithFamily(fid, () => {
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: null });
  });
  const r = runWithFamily(fid, () =>
    server.repos.choreCompletions.countForUserWeek(null, '2026-W17')
  );
  assert.equal(r, 0);
});

test('countForUserWeek counts only the specific user', () => {
  const fid = createFamily('CC Repo count-user');
  const userA = createUser('cc-count-a@test.local', fid);
  const userB = createUser('cc-count-b@test.local', fid);
  const choreId = seedChoreInFamily(fid);

  runWithFamily(fid, () => {
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: userA.id });
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: userA.id });
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: userB.id });
  });

  assert.equal(
    runWithFamily(fid, () => server.repos.choreCompletions.countForUserWeek(userA.id, '2026-W17')),
    2
  );
  assert.equal(
    runWithFamily(fid, () => server.repos.choreCompletions.countForUserWeek(userB.id, '2026-W17')),
    1
  );
});

test('listForFamilyWeek returns rows newest-first', () => {
  const fid = createFamily('CC Repo list');
  const choreId = seedChoreInFamily(fid);

  runWithFamily(fid, () => {
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId, userId: null });
  });
  server.repos._db
    .prepare(
      `INSERT INTO chore_completions (family_id, week_year, chore_id, user_id, completed_at)
         VALUES (?, '2026-W17', ?, NULL, datetime('now', '+1 hour'))`
    )
    .run(fid, choreId);

  const rows = runWithFamily(fid, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  assert.equal(rows.length, 2);
  assert.ok(
    rows[0].completed_at >= rows[1].completed_at,
    `expected DESC order, got ${rows[0].completed_at} then ${rows[1].completed_at}`
  );
});

// ============================================================
// Tenant-isolation
// ============================================================

test('chore_completions is scoped per family (tenant isolation)', () => {
  const famA = createFamily('CC Iso A');
  const famB = createFamily('CC Iso B');
  const choreA = seedChoreInFamily(famA, 911, 'Iso A task');
  const choreB = seedChoreInFamily(famB, 912, 'Iso B task');

  runWithFamily(famA, () => {
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId: choreA, userId: null });
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId: choreA, userId: null });
  });
  runWithFamily(famB, () => {
    server.repos.choreCompletions.insert({ weekYear: '2026-W17', choreId: choreB, userId: null });
  });

  // Each family must see only its own rows.
  const listA = runWithFamily(famA, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  const listB = runWithFamily(famB, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  assert.equal(listA.length, 2);
  assert.equal(listB.length, 1);
  assert.ok(
    listA.every((r) => r.chore_id === choreA),
    'A sees only A rows'
  );
  assert.ok(
    listB.every((r) => r.chore_id === choreB),
    'B sees only B rows'
  );

  // Count parity.
  assert.equal(
    runWithFamily(famA, () => server.repos.choreCompletions.countForFamilyWeek('2026-W17')),
    2
  );
  assert.equal(
    runWithFamily(famB, () => server.repos.choreCompletions.countForFamilyWeek('2026-W17')),
    1
  );

  // Attempting removeLatest from the wrong family must not delete.
  const wrongRemove = runWithFamily(famB, () =>
    server.repos.choreCompletions.removeLatest({ weekYear: '2026-W17', choreId: choreA })
  );
  assert.equal(wrongRemove.removed, 0, 'family B cannot delete A history');
  assert.equal(
    runWithFamily(famA, () => server.repos.choreCompletions.countForFamilyWeek('2026-W17')),
    2,
    'A history untouched after B removeLatest attempt'
  );
});

// ============================================================
// Hook integration: markDone / markUndone write history atomically
// ============================================================

test('markDone inserts a history row atomically', () => {
  const fid = createFamily('CC Hook markDone');
  const user = createUser('cc-hook-user@test.local', fid);
  const choreId = seedChoreInFamily(fid, 921, 'Hook markDone task');

  runWithFamily(fid, () => {
    server.repos.choreSchedules.markDone('2026-W17', choreId, { userId: user.id });
  });

  // chore_schedules should be 'done'
  const sched = server.repos._db
    .prepare(
      `SELECT status, completed_at FROM chore_schedules
         WHERE family_id = ? AND week_year = '2026-W17' AND chore_id = ?`
    )
    .get(fid, choreId);
  assert.equal(sched.status, 'done');
  assert.ok(sched.completed_at);

  // chore_completions should have exactly 1 row with the right user
  const history = runWithFamily(fid, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  const mine = history.filter((h) => h.chore_id === choreId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].user_id, user.id);
});

test('markDone with no userId records NULL (synthetic pilot user)', () => {
  const fid = createFamily('CC Hook markDone null');
  const choreId = seedChoreInFamily(fid, 922, 'Hook markDone null task');
  runWithFamily(fid, () => {
    // Omit userId: synthetic LOCAL_USER path.
    server.repos.choreSchedules.markDone('2026-W17', choreId);
  });
  const history = runWithFamily(fid, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  const row = history.find((h) => h.chore_id === choreId);
  assert.ok(row, 'history row created');
  assert.equal(row.user_id, null);
});

test('markUndone removes the most recent history row atomically', () => {
  const fid = createFamily('CC Hook markUndone');
  const choreId = seedChoreInFamily(fid, 923, 'Hook markUndone task');

  runWithFamily(fid, () => {
    server.repos.choreSchedules.markDone('2026-W17', choreId);
  });
  const beforeCount = runWithFamily(fid, () =>
    server.repos.choreCompletions.countForFamilyWeek('2026-W17')
  );
  assert.ok(beforeCount >= 1);

  runWithFamily(fid, () => {
    server.repos.choreSchedules.markUndone('2026-W17', choreId);
  });

  const sched = server.repos._db
    .prepare(
      `SELECT status, completed_at FROM chore_schedules
         WHERE family_id = ? AND week_year = '2026-W17' AND chore_id = ?`
    )
    .get(fid, choreId);
  assert.equal(sched.status, 'pending');
  assert.equal(sched.completed_at, null);

  const history = runWithFamily(fid, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  const mine = history.filter((h) => h.chore_id === choreId);
  assert.equal(mine.length, 0, 'history row removed');
});

test('markUndone on a chore that was never completed is a harmless no-op', () => {
  const fid = createFamily('CC Hook markUndone-empty');
  const choreId = seedChoreInFamily(fid, 924, 'Hook markUndone-empty task');

  // No markDone first. markUndone should not throw, and history stays empty.
  assert.doesNotThrow(() => {
    runWithFamily(fid, () => {
      server.repos.choreSchedules.markUndone('2026-W17', choreId);
    });
  });

  const history = runWithFamily(fid, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  assert.equal(history.filter((h) => h.chore_id === choreId).length, 0);
});

test('double markDone inserts two history rows (semantic intent for double-completes)', () => {
  const fid = createFamily('CC Hook double-markDone');
  const choreId = seedChoreInFamily(fid, 925, 'Double markDone task');

  runWithFamily(fid, () => {
    server.repos.choreSchedules.markDone('2026-W17', choreId);
    server.repos.choreSchedules.markDone('2026-W17', choreId);
  });

  const history = runWithFamily(fid, () =>
    server.repos.choreCompletions.listForFamilyWeek('2026-W17')
  );
  const mine = history.filter((h) => h.chore_id === choreId);
  assert.equal(mine.length, 2, 'double markDone creates two history rows');
});
