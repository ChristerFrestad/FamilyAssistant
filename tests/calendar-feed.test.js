'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { getWeekYearInTimeZone } = require('../server/services/seed.service');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createOwner(email, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('the feed is a private ICS and does not leak another family', async () => {
  const a = createOwner('ical-a@example.com', 'Ical A');
  const b = createOwner('ical-b@example.com', 'Ical B');
  const week = getWeekYearInTimeZone(new Date());
  runWithFamily(a.familyId, () => {
    const recipeId = server.repos.recipes.insert({
      name: 'Taco',
      category: 'rask',
      servings: 4,
      sourceType: 'manual',
      ingredients: [{ name: 'kjøttdeig', qty: 400, unit: 'g' }],
    });
    server.repos.mealPlans.setRecipe(week, 6, recipeId, 'planned');
  });
  runWithFamily(b.familyId, () => {
    const recipeId = server.repos.recipes.insert({
      name: 'Hemmelig suppe',
      category: 'comfort',
      servings: 2,
      sourceType: 'manual',
      ingredients: [{ name: 'løk', qty: 1, unit: 'stk' }],
    });
    server.repos.mealPlans.setRecipe(week, 6, recipeId, 'planned');
  });

  const issued = await request(server.baseUrl, 'POST', '/api/calendar-feed', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(issued.status, 200);
  const path = issued.body.path;
  const feed = await request(server.baseUrl, 'GET', path);
  assert.equal(feed.status, 200);
  assert.match(String(feed.headers['content-type']), /text\/calendar/);
  assert.match(String(feed.headers['cache-control']), /max-age=900/);
  const ics = feed.raw;
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /BEGIN:VTIMEZONE/);
  assert.match(ics, /TZID:Europe\/Oslo/);
  assert.match(ics, /SUMMARY:Middag: Taco/);
  assert.match(ics, /UID:dinner-/);
  assert.equal(ics.includes('Hemmelig suppe'), false);
  assert.equal(ics.includes('kjøttdeig'), false);

  const other = await request(server.baseUrl, 'POST', '/api/calendar-feed', {
    headers: { Cookie: b.cookie },
  });
  const otherFeed = await request(server.baseUrl, 'GET', other.body.path);
  assert.equal(otherFeed.raw.includes('Taco'), false);
  assert.match(otherFeed.raw, /Hemmelig suppe/);

  const revoked = await request(server.baseUrl, 'DELETE', '/api/calendar-feed', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(revoked.status, 200);
  const gone = await request(server.baseUrl, 'GET', path);
  assert.equal(gone.status, 404);

  const again = await request(server.baseUrl, 'POST', '/api/calendar-feed', {
    headers: { Cookie: a.cookie },
  });
  assert.notEqual(again.body.path, path);
  const oldStillGone = await request(server.baseUrl, 'GET', path);
  assert.equal(oldStillGone.status, 404);
});

test('the feed keeps library dinners, real end times, rules, and escaped titles', async () => {
  const owner = createOwner('ical-lib@example.com', 'Ical Lib');
  const week = getWeekYearInTimeZone(new Date());
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  runWithFamily(owner.familyId, () => {
    const libraryId = server.repos.recipeLibrary.upsert({
      title: 'Bibliotektaco',
      sourceName: 'Meny',
      canonicalUrl: 'https://meny.no/oppskrifter/test/bibliotektaco',
      imageUrl: null,
      servings: 4,
      totalTimeMin: 30,
      category: 'rask',
      fetchedAt: '2026-11-14T00:00:00.000Z',
      ingredients: [],
    });
    server.repos.mealPlans.setLibraryRecipe(week, 6, libraryId, 'planned', 'auto');
    server.repos.calendar.insert({
      title: 'Linje1\nLinje2',
      date: today,
      startTime: '17:00',
      endTime: '18:30',
      allDay: false,
      rrule: 'FREQ=WEEKLY',
    });
  });
  const issued = await request(server.baseUrl, 'POST', '/api/calendar-feed', {
    headers: { Cookie: owner.cookie },
  });
  const feed = await request(server.baseUrl, 'GET', issued.body.path);
  const ics = feed.raw;
  assert.match(ics, /SUMMARY:Middag: Bibliotektaco/);
  assert.match(ics, /DTSTART;TZID=Europe\/Oslo:\d{8}T170000/);
  assert.match(ics, /DTEND;TZID=Europe\/Oslo:\d{8}T183000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY/);
  assert.match(ics, /SUMMARY:Linje1\\nLinje2/);
  assert.equal(/^Linje2/m.test(ics), false);
});
