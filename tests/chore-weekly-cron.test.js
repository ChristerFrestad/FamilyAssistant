'use strict';

// weeklyChoresJob must seed chore_schedules for EVERY family, not only
// the LEGACY_FAMILY_ID=1 fallback that getFamilyId() uses outside ALS.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { getWeekYear } = require('../server/seed');
const { weeklyChoresJob } = require('../server/cron');

let server;

function createFamily(name) {
  return Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
}

function insertChore(familyId, task, defaultDay) {
  return runWithFamily(familyId, () =>
    server.repos.chores.insert({
      task,
      frequency: 'ukentlig',
      defaultDay,
      icon: '🧹',
    })
  );
}

before(async () => {
  server = await startTestServer({ authToken: 'chore-weekly-cron-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('weeklyChoresJob seeds schedule rows for two families', () => {
  const familyA = createFamily('Cron Fam A');
  const familyB = createFamily('Cron Fam B');
  const choreA = insertChore(familyA, 'G21-A-Vacuum', 1);
  const choreB = insertChore(familyB, 'G21-B-Mop', 2);
  const wk = getWeekYear();

  assert.equal(runWithFamily(familyA, () => server.repos.choreSchedules.getWeek(wk)).length, 0);
  assert.equal(runWithFamily(familyB, () => server.repos.choreSchedules.getWeek(wk)).length, 0);

  weeklyChoresJob(server.repos);

  const rowsA = runWithFamily(familyA, () => server.repos.choreSchedules.getWeek(wk));
  const rowsB = runWithFamily(familyB, () => server.repos.choreSchedules.getWeek(wk));

  assert.ok(rowsA.length > 0, `family A should have schedule rows, got ${rowsA.length}`);
  assert.ok(rowsB.length > 0, `family B should have schedule rows, got ${rowsB.length}`);
  assert.ok(
    rowsA.some((r) => r.choreId === choreA.id && r.weekYear === wk),
    `family A missing chore ${choreA.id}: ${JSON.stringify(rowsA)}`
  );
  assert.ok(
    rowsB.some((r) => r.choreId === choreB.id && r.weekYear === wk),
    `family B missing chore ${choreB.id}: ${JSON.stringify(rowsB)}`
  );
  assert.equal(
    rowsA.some((r) => r.choreId === choreB.id),
    false
  );
  assert.equal(
    rowsB.some((r) => r.choreId === choreA.id),
    false
  );
});

test('weeklyChoresJob does not duplicate when a family already has a plan', () => {
  const familyId = createFamily('Cron Fam Idem');
  insertChore(familyId, 'G21-Idem-Dust', 0);
  const wk = getWeekYear();

  weeklyChoresJob(server.repos);
  const first = runWithFamily(familyId, () => server.repos.choreSchedules.getWeek(wk));
  assert.ok(first.length > 0);

  weeklyChoresJob(server.repos);
  const second = runWithFamily(familyId, () => server.repos.choreSchedules.getWeek(wk));
  assert.equal(second.length, first.length);
});
