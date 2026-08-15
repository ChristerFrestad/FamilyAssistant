'use strict';

// Friday postpone must land the chore on next Monday (scheduled_day=0)
// and drop it from "today" even when this week's row still has
// scheduled_day === Friday (UNIQUE + INSERT OR IGNORE used to leave
// next week on default_day, and /api/today treated postponed_to=-1 as
// scheduledDay).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { getWeekYear } = require('../server/seed');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function todayDow() {
  return (new Date().getDay() + 6) % 7;
}

function createOwner(email, familyName) {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, 'owner');
  server.repos.family.setOwner(familyId, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId, userId: user.id, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({
    authToken: 'chore-postpone-friday-token-abcdef0123456789',
  });
});

after(async () => {
  await server.close();
});

test('Friday postpone moves next week to Monday and drops chore from today', async () => {
  const owner = createOwner('postpone-friday@chores.test', 'Postpone Friday Fam');
  const thisWk = getWeekYear();
  const nextWk = getWeekYear(new Date(Date.now() + 7 * 86400000));

  const created = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: owner.cookie },
    body: { task: 'U41-Friday-Bins', frequency: 'ukentlig', defaultDay: 4, icon: '🗑️' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const choreId = created.body.chore.id;

  runWithFamily(owner.familyId, () => {
    server.repos.choreSchedules.add(thisWk, choreId, 4);
    server.repos.choreSchedules.add(nextWk, choreId, 4);
  });

  const beforeNext = server.repos._db
    .prepare(
      `SELECT scheduled_day FROM chore_schedules
       WHERE family_id = ? AND chore_id = ? AND week_year = ?`
    )
    .get(owner.familyId, choreId, nextWk);
  assert.ok(beforeNext, 'next-week row must exist before postpone');
  assert.equal(beforeNext.scheduled_day, 4);

  const postponed = await request(server.baseUrl, 'PUT', '/api/chores/postpone', {
    headers: { Cookie: owner.cookie },
    body: { weekYear: thisWk, choreId },
  });
  assert.equal(postponed.status, 200, JSON.stringify(postponed.body));

  const nextRow = server.repos._db
    .prepare(
      `SELECT scheduled_day, status FROM chore_schedules
       WHERE family_id = ? AND chore_id = ? AND week_year = ?`
    )
    .get(owner.familyId, choreId, nextWk);
  assert.ok(nextRow, 'next-week row missing after postpone');
  assert.equal(nextRow.scheduled_day, 0);

  const thisRow = server.repos._db
    .prepare(
      `SELECT postponed_to, scheduled_day, status FROM chore_schedules
       WHERE family_id = ? AND chore_id = ? AND week_year = ?`
    )
    .get(owner.familyId, choreId, thisWk);
  assert.ok(thisRow);
  assert.equal(thisRow.postponed_to, -1);
  assert.equal(thisRow.status, 'postponed');

  // Point this week's scheduled_day at "today" so a buggy filter that
  // falls back from postponed_to=-1 to scheduled_day would still show it.
  const dow = todayDow();
  server.repos._db
    .prepare(
      `UPDATE chore_schedules SET scheduled_day = ?
       WHERE family_id = ? AND chore_id = ? AND week_year = ?`
    )
    .run(dow, owner.familyId, choreId, thisWk);

  const today = await request(server.baseUrl, 'GET', '/api/today', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(today.status, 200);
  const todayIds = (today.body.chores || []).map((c) => c.choreId);
  assert.equal(
    todayIds.includes(choreId),
    false,
    `GET /api/today still lists Friday-postponed chore: ${JSON.stringify(today.body.chores)}`
  );

  const current = await request(server.baseUrl, 'GET', '/api/chores/current', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(current.status, 200);
  const currentItem = (current.body.chores || []).find((c) => c.choreId === choreId);
  if (currentItem) {
    assert.notEqual(
      currentItem.effectiveDay,
      dow,
      'GET /api/chores/current must not treat postponed_to=-1 as today'
    );
    assert.ok(currentItem.effectiveDay < 0 || currentItem.postponedTo < 0);
  }
});
