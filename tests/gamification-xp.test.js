'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createUser(email, role, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  if (role === 'owner') server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid), email };
}

function seedScheduledChore(familyId, task, weekYear = '2026-W17') {
  return runWithFamily(familyId, () => {
    const row = server.repos.chores.insert({
      task,
      frequency: 'ukentlig',
      defaultDay: 1,
    });
    server.repos._db
      .prepare(
        `INSERT OR IGNORE INTO chore_schedules (family_id, chore_id, week_year, scheduled_day, status)
         VALUES (?, ?, ?, 1, 'pending')`
      )
      .run(familyId, row.id, weekYear);
    return row.id;
  });
}

before(async () => {
  server = await startTestServer({ authToken: 'g4-xp-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('marking a chore done awards 10 XP on the completion row', async () => {
  const owner = createUser('xp-award@g4.test', 'owner', 'XP Award Fam');
  const choreId = seedScheduledChore(owner.familyId, 'XP award task');

  const r = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: owner.cookie },
    body: { weekYear: '2026-W17', choreId },
  });
  assert.equal(r.status, 200);

  const row = server.repos._db
    .prepare(
      `SELECT xp_awarded, user_id FROM chore_completions
        WHERE family_id = ? AND chore_id = ? AND week_year = '2026-W17'`
    )
    .get(owner.familyId, choreId);
  assert.ok(row);
  assert.equal(row.xp_awarded, 10);
  assert.equal(row.user_id, owner.userId);
});

test('undo removes the completion and its XP', async () => {
  const owner = createUser('xp-undo@g4.test', 'owner', 'XP Undo Fam');
  const choreId = seedScheduledChore(owner.familyId, 'XP undo task');

  const done = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: owner.cookie },
    body: { weekYear: '2026-W17', choreId },
  });
  assert.equal(done.status, 200);

  const undone = await request(server.baseUrl, 'PUT', '/api/chores/undone', {
    headers: { Cookie: owner.cookie },
    body: { weekYear: '2026-W17', choreId },
  });
  assert.equal(undone.status, 200);

  const row = server.repos._db
    .prepare(
      `SELECT id FROM chore_completions
        WHERE family_id = ? AND chore_id = ? AND week_year = '2026-W17'`
    )
    .get(owner.familyId, choreId);
  assert.equal(row, undefined);
});

test('GET /api/chores/stats isolates two families', async () => {
  const a = createUser('xp-stats-a@g4.test', 'owner', 'XP Stats Fam A');
  const b = createUser('xp-stats-b@g4.test', 'owner', 'XP Stats Fam B');
  const choreA = seedScheduledChore(a.familyId, 'Stats A task');
  const choreB = seedScheduledChore(b.familyId, 'Stats B task');

  const raDone = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: a.cookie },
    body: { weekYear: '2026-W17', choreId: choreA },
  });
  assert.equal(raDone.status, 200);
  const rbDone = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: b.cookie },
    body: { weekYear: '2026-W17', choreId: choreB },
  });
  assert.equal(rbDone.status, 200);

  const ra = await request(server.baseUrl, 'GET', '/api/chores/stats?week=2026-W17', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(ra.status, 200);
  assert.equal(ra.body.enabled, true);
  assert.equal(ra.body.goal, 5);
  assert.ok(Array.isArray(ra.body.byUser));
  const aSelf = ra.body.byUser.find((u) => u.userId === a.userId);
  assert.ok(aSelf);
  assert.equal(aSelf.xp, 10);
  assert.equal(aSelf.completions, 1);
  assert.ok(!ra.body.byUser.some((u) => u.userId === b.userId));

  const rb = await request(server.baseUrl, 'GET', '/api/chores/stats?week=2026-W17', {
    headers: { Cookie: b.cookie },
  });
  assert.equal(rb.status, 200);
  const bSelf = rb.body.byUser.find((u) => u.userId === b.userId);
  assert.ok(bSelf);
  assert.equal(bSelf.xp, 10);
  assert.ok(!rb.body.byUser.some((u) => u.userId === a.userId));
});

test('PATCH /api/family/gamification is owner-only and updates stats flags', async () => {
  const owner = createUser('xp-settings@g4.test', 'owner', 'XP Settings Fam');
  const adult = createUser('xp-settings-adult@g4.test', 'adult', 'XP Settings Adult Fam');

  const denied = await request(server.baseUrl, 'PATCH', '/api/family/gamification', {
    headers: { Cookie: adult.cookie },
    body: { enabled: false, weekGoal: 8 },
  });
  assert.equal(denied.status, 403);

  const ok = await request(server.baseUrl, 'PATCH', '/api/family/gamification', {
    headers: { Cookie: owner.cookie },
    body: { enabled: false, weekGoal: 8 },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.enabled, false);
  assert.equal(ok.body.weekGoal, 8);

  const stats = await request(server.baseUrl, 'GET', '/api/chores/stats?week=2026-W17', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.enabled, false);
  assert.equal(stats.body.goal, 8);
});
