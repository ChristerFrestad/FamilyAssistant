'use strict';

// Family-scoped chore catalog CRUD + label fix for today/current.
// Setup mirrors gdpr-endpoints.test.js: AUTH_TOKEN + session cookies.

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

function addUserToFamily(email, role, familyId) {
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, role);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId, userId: user.id, sid, cookie: cookieHeader(sid), email };
}

function todayDow() {
  return (new Date().getDay() + 6) % 7;
}

before(async () => {
  server = await startTestServer({ authToken: 'chore-crud-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('GET /api/chores is 401 without cookie', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/chores');
  assert.equal(r.status, 401);
});

test('adult POST then GET list contains task', async () => {
  const adult = createUser('chore-adult@crud.test', 'owner', 'Chore CRUD Adult');
  const created = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: adult.cookie },
    body: { task: 'G11-Vacuum-Living-Room', frequency: 'ukentlig', defaultDay: 1, icon: '🧹' },
  });
  assert.equal(
    created.status,
    201,
    `POST status ${created.status} ${JSON.stringify(created.body)}`
  );
  assert.equal(created.body.ok, true);
  assert.equal(created.body.chore.task, 'G11-Vacuum-Living-Room');
  assert.equal(created.body.chore.frequency, 'ukentlig');
  assert.equal(created.body.chore.defaultDay, 1);
  assert.equal(created.body.chore.active, true);
  assert.ok(Number.isInteger(created.body.chore.id) && created.body.chore.id > 0);

  const listed = await request(server.baseUrl, 'GET', '/api/chores', {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body.chores));
  const found = listed.body.chores.find((c) => c.task === 'G11-Vacuum-Living-Room');
  assert.ok(found, 'GET list missing posted task');
  assert.equal(found.id, created.body.chore.id);
  assert.equal(found.defaultDay, 1);
  assert.equal(found.assigneeMemberId, null);
});

test('child POST /api/chores is 403', async () => {
  const owner = createUser('chore-child-owner@crud.test', 'owner', 'Chore Child Fam');
  const child = addUserToFamily('chore-child@crud.test', 'child', owner.familyId);
  const r = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: child.cookie },
    body: { task: 'sneak chore', frequency: 'ukentlig' },
  });
  assert.equal(r.status, 403);
});

test('child GET /api/chores is 200', async () => {
  const owner = createUser('chore-child-get-owner@crud.test', 'owner', 'Chore Child Get');
  const child = addUserToFamily('chore-child-get@crud.test', 'child', owner.familyId);
  await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: owner.cookie },
    body: { task: 'G11-Child-Visible', frequency: 'ukentlig' },
  });
  const r = await request(server.baseUrl, 'GET', '/api/chores', {
    headers: { Cookie: child.cookie },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.chores.some((c) => c.task === 'G11-Child-Visible'));
});

test("family A cannot PATCH B's chore (404) and GET list excludes B task", async () => {
  const a = createUser('chore-iso-a@crud.test', 'owner', 'Chore Iso A');
  const b = createUser('chore-iso-b@crud.test', 'owner', 'Chore Iso B');

  const createdB = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: b.cookie },
    body: { task: 'G11-B-Only-Mop-Floors', frequency: 'ukentlig', defaultDay: 2 },
  });
  assert.equal(createdB.status, 201);
  const bId = createdB.body.chore.id;

  await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: a.cookie },
    body: { task: 'G11-A-Only-Dust', frequency: 'ukentlig' },
  });

  const patched = await request(server.baseUrl, 'PATCH', `/api/chores/${bId}`, {
    headers: { Cookie: a.cookie },
    body: { task: 'hacked' },
  });
  assert.equal(patched.status, 404);

  const listA = await request(server.baseUrl, 'GET', '/api/chores', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(listA.status, 200);
  const tasksA = listA.body.chores.map((c) => c.task);
  assert.ok(tasksA.includes('G11-A-Only-Dust'));
  assert.equal(tasksA.includes('G11-B-Only-Mop-Floors'), false);

  const stillB = await request(server.baseUrl, 'GET', '/api/chores', {
    headers: { Cookie: b.cookie },
  });
  assert.ok(stillB.body.chores.some((c) => c.id === bId && c.task === 'G11-B-Only-Mop-Floors'));
});

test("POST with defaultDay=today appears on GET /api/today with real task (not '?')", async () => {
  const owner = createUser('chore-today@crud.test', 'owner', 'Chore Today Fam');
  const task = 'G11-Today-Real-Task';
  const created = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: owner.cookie },
    body: { task, frequency: 'ukentlig', defaultDay: todayDow(), icon: '✨' },
  });
  assert.equal(created.status, 201);

  const today = await request(server.baseUrl, 'GET', '/api/today', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(today.status, 200);
  const match = (today.body.chores || []).find((c) => c.task === task);
  assert.ok(match, `today chores missing real task, got ${JSON.stringify(today.body.chores)}`);
  assert.notEqual(match.task, '?');
});

test('GET /api/chores/current labels come from DB after family upsertMany', async () => {
  const owner = createUser('chore-seed-labels@crud.test', 'owner', 'Chore Seed Labels');
  const uniqueTask = 'G11-DB-Label-Vacuum';
  runWithFamily(owner.familyId, () => {
    server.repos.chores.upsertMany([
      {
        task: uniqueTask,
        details: 'from db not seed ids',
        frequency: 'ukentlig',
        defaultDay: 0,
        icon: '🧹',
        active: true,
      },
    ]);
  });

  const current = await request(server.baseUrl, 'GET', '/api/chores/current', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(current.status, 200);
  const chores = current.body.chores || [];
  assert.ok(
    chores.some((c) => c.task === uniqueTask),
    `current missing DB task, got ${JSON.stringify(chores.map((c) => c.task))}`
  );
  assert.equal(
    chores.some((c) => c.task === '?'),
    false,
    `current still has '?' labels: ${JSON.stringify(chores)}`
  );
});

test('deactivate hides from default GET; includeInactive=1 as adult shows it', async () => {
  const owner = createUser('chore-deact@crud.test', 'owner', 'Chore Deact Fam');
  const created = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: owner.cookie },
    body: { task: 'G11-Deactivate-Me', frequency: 'etter_behov' },
  });
  assert.equal(created.status, 201);
  const id = created.body.chore.id;

  const deact = await request(server.baseUrl, 'PATCH', `/api/chores/${id}`, {
    headers: { Cookie: owner.cookie },
    body: { active: false },
  });
  assert.equal(deact.status, 200);
  assert.equal(deact.body.chore.active, false);

  const listed = await request(server.baseUrl, 'GET', '/api/chores', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(
    listed.body.chores.some((c) => c.id === id),
    false,
    'inactive chore should be hidden from default list'
  );

  const withInactive = await request(server.baseUrl, 'GET', '/api/chores?includeInactive=1', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(withInactive.status, 200);
  const hidden = withInactive.body.chores.find((c) => c.id === id);
  assert.ok(hidden, 'adult includeInactive=1 should show deactivated chore');
  assert.equal(hidden.active, false);
});

test('invalid assigneeMemberId from other family is 400', async () => {
  const a = createUser('chore-assignee-a@crud.test', 'owner', 'Chore Assignee A');
  const b = createUser('chore-assignee-b@crud.test', 'owner', 'Chore Assignee B');
  const foreign = server.repos.family.addMember(b.familyId, {
    name: 'Other Fam Member',
    category: 'adult',
  });

  const r = await request(server.baseUrl, 'POST', '/api/chores', {
    headers: { Cookie: a.cookie },
    body: {
      task: 'G11-Bad-Assignee',
      frequency: 'ukentlig',
      assigneeMemberId: foreign.id,
    },
  });
  assert.equal(r.status, 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
});
