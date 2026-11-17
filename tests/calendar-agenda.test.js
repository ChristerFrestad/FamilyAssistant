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

test('the calendar agenda is read-only data for one family', async () => {
  const a = createOwner('agenda-a@example.com', 'Agenda A');
  const b = createOwner('agenda-b@example.com', 'Agenda B');
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
  const from = '2020-01-01';
  const to = '2099-12-31';
  const mine = await request(server.baseUrl, 'GET', `/api/calendar/agenda?from=${from}&to=${to}`, {
    headers: { Cookie: a.cookie },
  });
  assert.equal(mine.status, 200);
  const dinner = mine.body.items.find((item) => item.title === 'Middag: Taco');
  assert.ok(dinner);
  assert.equal(dinner.readOnly, true);
  assert.equal(dinner.kind, 'dinner');
  const theirs = await request(
    server.baseUrl,
    'GET',
    `/api/calendar/agenda?from=${from}&to=${to}`,
    { headers: { Cookie: b.cookie } }
  );
  assert.equal(
    theirs.body.items.some((item) => item.title === 'Middag: Taco'),
    false
  );
});

test('a library dinner is on the agenda and a disabled source is not', async () => {
  const owner = createOwner('agenda-lib@example.com', 'Agenda Lib');
  const week = getWeekYearInTimeZone(new Date());
  runWithFamily(owner.familyId, () => {
    const shown = server.repos.recipeLibrary.upsert({
      title: 'Bibliotektaco',
      sourceName: 'Meny',
      canonicalUrl: 'https://meny.no/oppskrifter/test/agenda-taco',
      imageUrl: null,
      servings: 4,
      totalTimeMin: 20,
      category: 'rask',
      fetchedAt: '2026-11-14T00:00:00.000Z',
      ingredients: [],
    });
    const hidden = server.repos.recipeLibrary.upsert({
      title: 'Skjult rett',
      sourceName: 'Matprat',
      canonicalUrl: 'https://www.matprat.no/oppskrifter/skjult',
      imageUrl: null,
      servings: 2,
      totalTimeMin: 20,
      category: 'comfort',
      fetchedAt: '2026-11-14T00:00:00.000Z',
      ingredients: [],
    });
    server.repos.mealPlans.setLibraryRecipe(week, 6, shown, 'planned', 'auto');
    server.repos.mealPlans.setLibraryRecipe(week, 5, hidden, 'planned', 'auto');
  });
  const res = await request(
    server.baseUrl,
    'GET',
    '/api/calendar/agenda?from=2020-01-01&to=2099-12-31',
    { headers: { Cookie: owner.cookie } }
  );
  assert.equal(res.status, 200);
  assert.equal(
    res.body.items.some((item) => item.title === 'Middag: Bibliotektaco'),
    true
  );
  assert.equal(
    res.body.items.some((item) => item.title === 'Middag: Skjult rett'),
    false
  );
});
