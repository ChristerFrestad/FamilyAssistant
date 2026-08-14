'use strict';

// Isolation tests for GET/POST /api/calendar/events.
// Family A must not see (or mutate) Family B's events.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createFamilyWithOwner(email, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'cal-events-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('family A cannot see family B calendar event', async () => {
  const a = createFamilyWithOwner('cal-a@iso.test', 'Cal Family A');
  const b = createFamilyWithOwner('cal-b@iso.test', 'Cal Family B');

  const createdB = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: b.cookie },
    body: { title: 'B-only event', date: '2026-06-15', startTime: '10:00', location: 'Bergen' },
  });
  assert.equal(createdB.status, 200, `B POST status ${createdB.status}`);
  const bEventId = createdB.body.event.id;
  assert.ok(bEventId);
  assert.equal(createdB.body.event.date, '2026-06-15');
  assert.equal(createdB.body.event.startTime, '10:00');
  assert.equal('startsAt' in createdB.body.event, false);

  const createdA = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: a.cookie },
    body: { title: 'A picnic', date: '2026-06-16' },
  });
  assert.equal(createdA.status, 200, `A POST status ${createdA.status}`);

  const listA = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/events?from=2026-06-01&to=2026-06-30',
    { headers: { Cookie: a.cookie } }
  );
  assert.equal(listA.status, 200);
  assert.ok(Array.isArray(listA.body.events));
  const titlesA = listA.body.events.map((e) => e.title);
  assert.ok(titlesA.includes('A picnic'), 'A sees own event');
  assert.equal(
    listA.body.events.some((e) => e.id === bEventId || e.title === 'B-only event'),
    false,
    'A must not see B event'
  );
  for (const ev of listA.body.events) {
    assert.equal(typeof ev.date, 'string');
    assert.equal('startsAt' in ev, false);
  }

  const listB = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/events?from=2026-06-01&to=2026-06-30',
    { headers: { Cookie: b.cookie } }
  );
  assert.equal(listB.status, 200);
  assert.ok(listB.body.events.some((e) => e.id === bEventId));
  assert.equal(
    listB.body.events.some((e) => e.title === 'A picnic'),
    false,
    'B must not see A event'
  );
});

test('family A cannot delete family B calendar event', async () => {
  const a = createFamilyWithOwner('cal-del-a@iso.test', 'Cal Del A');
  const b = createFamilyWithOwner('cal-del-b@iso.test', 'Cal Del B');

  const createdB = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: b.cookie },
    body: { title: 'B keep me', date: '2026-07-01' },
  });
  assert.equal(createdB.status, 200);
  const bEventId = createdB.body.event.id;

  const del = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${bEventId}`, {
    headers: { Cookie: a.cookie },
  });
  // Scoped DELETE is a no-op for the other tenant; status is secondary.
  assert.ok(del.status >= 200 && del.status < 500, `Unexpected status ${del.status}`);

  const stillThere = server.repos._db
    .prepare('SELECT id FROM calendar_events WHERE id = ?')
    .get(bEventId);
  assert.ok(stillThere, `Family B event was wrongfully deleted (status=${del.status})`);
});
