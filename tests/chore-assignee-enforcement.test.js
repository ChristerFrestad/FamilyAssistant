'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function sessionFor(userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId, ttlDays: 30 });
  return cookieHeader(sid);
}

before(async () => {
  server = await startTestServer({
    authToken: 'chore-assignee-enforcement-token-abcdef0123456789',
  });
});

after(async () => {
  await server.close();
});

test('child cannot complete a sibling assigned chore; own, unassigned, and adult can', async () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Chore Assignee Fam')
      .lastInsertRowid
  );

  const memberA = server.repos.family.addMember(familyId, { name: 'Child A', category: 'child' });
  const memberB = server.repos.family.addMember(familyId, { name: 'Child B', category: 'child' });
  const memberAdult = server.repos.family.addMember(familyId, {
    name: 'Adult',
    category: 'adult',
  });

  const owner = server.repos.auth.createUser({
    email: 'owner-assignee@role.test',
    name: 'Owner',
  });
  server.repos.auth.setFamily(owner.id, familyId, 'owner');
  server.repos.family.setOwner(familyId, owner.id);

  const childA = server.repos.auth.createUser({
    email: 'child-a-assignee@role.test',
    name: 'Child A',
  });
  server.repos.auth.setFamily(childA.id, familyId, 'child', memberA.id);

  const childB = server.repos.auth.createUser({
    email: 'child-b-assignee@role.test',
    name: 'Child B',
  });
  server.repos.auth.setFamily(childB.id, familyId, 'child', memberB.id);

  const adult = server.repos.auth.createUser({
    email: 'adult-assignee@role.test',
    name: 'Adult',
  });
  server.repos.auth.setFamily(adult.id, familyId, 'adult', memberAdult.id);

  const ownerCookie = sessionFor(owner.id);
  const childACookie = sessionFor(childA.id);
  const childBCookie = sessionFor(childB.id);
  const adultCookie = sessionFor(adult.id);

  const assigned = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: ownerCookie },
    body: {
      task: 'G22-Assigned-To-B',
      frequency: 'ukentlig',
      assigneeMemberId: memberB.id,
    },
  });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  const assignedId = assigned.body.chore.id;
  assert.equal(assigned.body.chore.assigneeMemberId, memberB.id);

  const listed = await request(server.baseUrl, 'GET', '/api/chores', {
    headers: { Cookie: childACookie },
  });
  assert.equal(listed.status, 200);
  const listedAssigned = listed.body.chores.find((c) => c.id === assignedId);
  assert.ok(listedAssigned, 'GET /api/chores should include assigned chore');
  assert.equal(listedAssigned.assigneeMemberId, memberB.id);

  const asA = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: childACookie },
    body: { choreId: assignedId },
  });
  assert.equal(asA.status, 403);

  const asB = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: childBCookie },
    body: { choreId: assignedId },
  });
  assert.equal(asB.status, 200);

  const unassigned = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: ownerCookie },
    body: { task: 'G22-Unassigned', frequency: 'ukentlig' },
  });
  assert.equal(unassigned.status, 201, JSON.stringify(unassigned.body));
  assert.equal(unassigned.body.chore.assigneeMemberId, null);

  const unassignedAsA = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: childACookie },
    body: { choreId: unassigned.body.chore.id },
  });
  assert.equal(unassignedAsA.status, 200);

  const assignedAgain = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: ownerCookie },
    body: {
      task: 'G22-Assigned-To-B-Adult',
      frequency: 'ukentlig',
      assigneeMemberId: memberB.id,
    },
  });
  assert.equal(assignedAgain.status, 201, JSON.stringify(assignedAgain.body));

  const asAdult = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: adultCookie },
    body: { choreId: assignedAgain.body.chore.id },
  });
  assert.equal(asAdult.status, 200);

  const todayDow = (new Date().getDay() + 6) % 7;
  const todayChore = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: ownerCookie },
    body: {
      task: 'G22-Today-Assigned-B',
      frequency: 'ukentlig',
      defaultDay: todayDow,
      assigneeMemberId: memberB.id,
    },
  });
  assert.equal(todayChore.status, 201, JSON.stringify(todayChore.body));
  const today = await request(server.baseUrl, 'GET', '/api/today', {
    headers: { Cookie: childACookie },
  });
  assert.equal(today.status, 200);
  const todayMatch = (today.body.chores || []).find((c) => c.task === 'G22-Today-Assigned-B');
  assert.ok(
    todayMatch,
    `GET /api/today missing assigned chore: ${JSON.stringify(today.body.chores)}`
  );
  assert.equal(todayMatch.assigneeMemberId, memberB.id);
});

test('missing chore is 404', async () => {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Chore Missing Fam')
      .lastInsertRowid
  );
  const owner = server.repos.auth.createUser({
    email: 'owner-missing-chore@role.test',
    name: 'Owner',
  });
  server.repos.auth.setFamily(owner.id, familyId, 'owner');
  const r = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: sessionFor(owner.id) },
    body: { choreId: 999999 },
  });
  assert.equal(r.status, 404);
});
