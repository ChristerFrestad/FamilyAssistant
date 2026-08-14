'use strict';

// Calendar integrations + sync isolation. No live Google / Apple calls.

const crypto = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { syncIntegration } = require('../server/services/calendar/sync.service');
const { parseVEvent, serializeVEvent } = require('../server/services/calendar/ics');
const { expandRecurring } = require('../server/services/calendar/rrule-expand');

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
  server = await startTestServer({ authToken: 'cal-sync-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('family A cannot GET family B integrations or events', async () => {
  const a = createFamilyWithOwner('sync-iso-a@iso.test', 'Sync Iso A');
  const b = createFamilyWithOwner('sync-iso-b@iso.test', 'Sync Iso B');

  const connectB = await request(server.baseUrl, 'POST', '/api/integrations/calendar/icloud', {
    headers: { Cookie: b.cookie },
    body: { email: 'b-icloud@icloud.com', appPassword: 'bbbb-bbbb-bbbb-bbbb' },
  });
  assert.equal(connectB.status, 200, `B iCloud connect ${connectB.status}`);

  const createdB = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: b.cookie },
    body: { title: 'B private event', date: '2026-08-18' },
  });
  assert.equal(createdB.status, 200);
  const bEventId = createdB.body.event.id;

  const listA = await request(server.baseUrl, 'GET', '/api/integrations/calendar', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(listA.status, 200);
  assert.ok(Array.isArray(listA.body.integrations));
  assert.equal(
    listA.body.integrations.some((i) => i.accountEmail === 'b-icloud@icloud.com'),
    false,
    'A must not see B integrations'
  );

  const eventsA = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/events?from=2026-08-01&to=2026-08-31',
    { headers: { Cookie: a.cookie } }
  );
  assert.equal(eventsA.status, 200);
  assert.equal(
    eventsA.body.events.some((e) => e.id === bEventId || e.title === 'B private event'),
    false,
    'A must not see B events'
  );
});

test('PATCH and DELETE of a foreign event id return 404', async () => {
  const a = createFamilyWithOwner('sync-foreign-a@iso.test', 'Sync Foreign A');
  const b = createFamilyWithOwner('sync-foreign-b@iso.test', 'Sync Foreign B');

  const createdB = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: b.cookie },
    body: { title: 'B keep', date: '2026-08-19' },
  });
  assert.equal(createdB.status, 200);
  const bEventId = createdB.body.event.id;

  const patched = await request(server.baseUrl, 'PATCH', `/api/calendar/events/${bEventId}`, {
    headers: { Cookie: a.cookie },
    body: { title: 'hacked' },
  });
  assert.equal(patched.status, 404);

  const del = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${bEventId}`, {
    headers: { Cookie: a.cookie },
  });
  assert.equal(del.status, 404);

  const still = server.repos._db
    .prepare('SELECT title FROM calendar_events WHERE id = ?')
    .get(bEventId);
  assert.ok(still);
  assert.equal(still.title, 'B keep');
});

test('iCloud connect stores encrypted password and GET omits secrets', async () => {
  const a = createFamilyWithOwner('sync-icloud-a@iso.test', 'Sync iCloud A');
  const rawPassword = 'abcd-efgh-ijkl-mnop';

  const connect = await request(server.baseUrl, 'POST', '/api/integrations/calendar/icloud', {
    headers: { Cookie: a.cookie },
    body: { email: 'family-a@icloud.com', appPassword: rawPassword },
  });
  assert.equal(
    connect.status,
    200,
    `iCloud connect ${connect.status} ${JSON.stringify(connect.body)}`
  );
  assert.equal(connect.body.integration.provider, 'icloud');
  assert.equal(connect.body.integration.accountEmail, 'family-a@icloud.com');
  assert.equal('appPassword' in connect.body.integration, false);
  assert.equal('appPasswordEnc' in connect.body.integration, false);

  const listed = await request(server.baseUrl, 'GET', '/api/integrations/calendar', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(listed.status, 200);
  const blob = JSON.stringify(listed.body);
  assert.equal(blob.includes(rawPassword), false, 'raw app password leaked in GET');
  assert.ok(listed.body.integrations.some((i) => i.accountEmail === 'family-a@icloud.com'));
  for (const item of listed.body.integrations) {
    assert.equal('appPassword' in item, false);
    assert.equal('appPasswordEnc' in item, false);
    assert.equal('refreshTokenEnc' in item, false);
    assert.equal('accessTokenEnc' in item, false);
  }

  const row = server.repos._db
    .prepare(
      `SELECT app_password_enc FROM calendar_integrations
        WHERE family_id = ? AND provider = 'icloud'`
    )
    .get(a.familyId);
  assert.ok(row && row.app_password_enc);
  assert.notEqual(row.app_password_enc, rawPassword);
});

test('iCloud sync with injected CalDAV lands only in family A', async () => {
  const a = createFamilyWithOwner('sync-pull-a@iso.test', 'Sync Pull A');
  const b = createFamilyWithOwner('sync-pull-b@iso.test', 'Sync Pull B');

  const connect = await request(server.baseUrl, 'POST', '/api/integrations/calendar/icloud', {
    headers: { Cookie: a.cookie },
    body: { email: 'pull-a@icloud.com', appPassword: 'pull-pass-aaaa' },
  });
  assert.equal(connect.status, 200);

  const ics = serializeVEvent({
    uid: 'icloud-evt-a-1',
    title: 'A soccer',
    date: '2026-08-20',
    startTime: '18:00',
    endTime: '19:00',
    location: 'Field',
  });
  const mockCalDav = {
    async discover() {
      return { href: 'https://caldav.test/calendars/a/' };
    },
    async report() {
      return [{ href: 'https://caldav.test/calendars/a/evt1.ics', etag: '"abc"', ics }];
    },
    async put() {
      return { status: 201 };
    },
    async delete() {
      return { status: 204 };
    },
  };

  await runWithFamily(a.familyId, async () => {
    const [integration] = server.repos.calendarIntegrations.listRaw();
    assert.ok(integration, 'A should have an iCloud integration');
    await syncIntegration(server.repos, integration, { caldavClient: mockCalDav });
  });

  const listA = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/events?from=2026-08-01&to=2026-08-31',
    { headers: { Cookie: a.cookie } }
  );
  assert.equal(listA.status, 200);
  const soccer = listA.body.events.find((e) => e.title === 'A soccer');
  assert.ok(soccer, 'A should see synced iCloud event');
  assert.equal(soccer.source, 'icloud');
  assert.equal(soccer.externalId, 'icloud-evt-a-1');

  const listB = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/events?from=2026-08-01&to=2026-08-31',
    { headers: { Cookie: b.cookie } }
  );
  assert.equal(listB.status, 200);
  assert.equal(
    listB.body.events.some((e) => e.title === 'A soccer' || e.externalId === 'icloud-evt-a-1'),
    false,
    'B must not see A iCloud events'
  );
});

test('Google calendar start without GOOGLE_CLIENT_ID returns 503', async () => {
  const a = createFamilyWithOwner('sync-gcal-a@iso.test', 'Sync GCal A');
  const start = await request(server.baseUrl, 'POST', '/api/integrations/google-calendar/start', {
    headers: { Cookie: a.cookie },
    body: {},
  });
  assert.equal(start.status, 503);
  assert.ok(start.body && start.body.reason);
  assert.match(String(start.body.reason), /GOOGLE_CLIENT_ID/);
});

test('DELETE event that exists is 200; missing is 404', async () => {
  const a = createFamilyWithOwner('sync-del-a@iso.test', 'Sync Del A');
  const created = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: a.cookie },
    body: { title: 'Temp', date: '2026-08-21', rrule: 'FREQ=WEEKLY;COUNT=2' },
  });
  assert.equal(created.status, 200);
  const id = created.body.event.id;
  assert.ok(id);
  assert.equal(created.body.event.rrule, 'FREQ=WEEKLY;COUNT=2');

  const del = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${id}`, {
    headers: { Cookie: a.cookie },
  });
  assert.equal(del.status, 200);

  const missing = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${id}`, {
    headers: { Cookie: a.cookie },
  });
  assert.equal(missing.status, 404);

  const gone = await request(server.baseUrl, 'DELETE', '/api/calendar/events/999999', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(gone.status, 404);
});

test('GET hides hidden=1 events and expands rrule in range', async () => {
  const a = createFamilyWithOwner('sync-rrule-a@iso.test', 'Sync Rrule A');
  const hidden = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: a.cookie },
    body: { title: 'Secret', date: '2026-08-22', hidden: true },
  });
  assert.equal(hidden.status, 200);

  const weekly = await request(server.baseUrl, 'POST', '/api/calendar/events', {
    headers: { Cookie: a.cookie },
    body: { title: 'Piano', date: '2026-08-03', rrule: 'FREQ=WEEKLY;COUNT=4' },
  });
  assert.equal(weekly.status, 200);

  const list = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/events?from=2026-08-01&to=2026-08-31',
    { headers: { Cookie: a.cookie } }
  );
  assert.equal(list.status, 200);
  assert.equal(
    list.body.events.some((e) => e.title === 'Secret'),
    false,
    'hidden events must not appear'
  );
  const piano = list.body.events.filter((e) => e.title === 'Piano');
  assert.ok(piano.length >= 4, `expected expanded piano occurrences, got ${piano.length}`);
});

test('ics parse/serialize and rrule expand without rrule are identity', () => {
  const ics = serializeVEvent({
    uid: 'unit-1',
    title: 'Dentist',
    date: '2026-09-01',
    startTime: '09:30',
    endTime: '10:00',
    location: 'Bergen',
    notes: 'Bring card',
  });
  const parsed = parseVEvent(ics);
  assert.equal(parsed.uid, 'unit-1');
  assert.equal(parsed.title, 'Dentist');
  assert.equal(parsed.date, '2026-09-01');
  assert.equal(parsed.startTime, '09:30');
  assert.equal(parsed.location, 'Bergen');

  const plain = [{ id: 1, title: 'Once', date: '2026-09-02' }];
  const expanded = expandRecurring(plain, '2026-09-01', '2026-09-30');
  assert.deepEqual(expanded, plain);
});
