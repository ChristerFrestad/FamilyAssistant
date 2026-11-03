// User-reported household fixes:
//   - delete a chore the family added, and a seeded standard chore
//   - mark a day as having no dinner
//   - a newly opened week is not a copy of the previous one
//   - the swap response already contains the new dinner

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { getWeekYear } = require('../server/seed');
const { chooseWeekRecipes } = require('../server/services/meal-planning.service');

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

describe('chooseWeekRecipes', () => {
  const recipes = [];
  for (let i = 1; i <= 12; i++) recipes.push({ id: i, category: 'rask' });
  for (let i = 13; i <= 18; i++) recipes.push({ id: i, category: 'comfort' });
  for (let i = 19; i <= 24; i++) recipes.push({ id: i, category: 'helg' });

  test('two consecutive weeks do not share the same seven dinners', () => {
    const a = chooseWeekRecipes(recipes, '2026-W45', []);
    const b = chooseWeekRecipes(
      recipes,
      '2026-W46',
      a.map((s) => s.recipeId)
    );
    assert.equal(a.length, 7);
    assert.equal(b.length, 7);
    assert.notDeepEqual(
      a.map((s) => s.recipeId),
      b.map((s) => s.recipeId)
    );
    const overlap = b.filter((s) => a.some((prev) => prev.recipeId === s.recipeId));
    assert.equal(overlap.length, 0);
  });

  test('does not repeat a recipe inside one week', () => {
    const plan = chooseWeekRecipes(recipes, '2026-W10', []);
    const ids = plan.map((s) => s.recipeId);
    assert.equal(new Set(ids).size, 7);
  });

  test('leaves days empty when the catalog is smaller than a week', () => {
    const plan = chooseWeekRecipes(
      [
        { id: 1, category: 'rask' },
        { id: 2, category: 'comfort' },
      ],
      '2026-W10',
      []
    );
    assert.equal(plan.length, 7);
    const filled = plan.filter((s) => s.recipeId != null);
    assert.equal(filled.length, 2);
  });
});

describe('chore delete, clear dinner, varied week', () => {
  let server;

  function createUser(email, role, familyName) {
    const fid = Number(
      server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName)
        .lastInsertRowid
    );
    const user = server.repos.auth.createUser({ email, name: email });
    server.repos.auth.setFamily(user.id, fid, role);
    if (role === 'owner') server.repos.family.setOwner(fid, user.id);
    const sid = crypto.randomBytes(32).toString('hex');
    server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
    return { familyId: fid, sid, cookie: cookieHeader(sid) };
  }

  before(async () => {
    server = await startTestServer({ authToken: 'household-fixes-token-abcdef0123456789' });
  });

  after(async () => {
    await server.close();
  });

  test('adult can delete a chore they added, and it stays off a later week', async () => {
    const adult = createUser('added@fixes.test', 'owner', 'Added Chores');
    const headers = { Cookie: adult.cookie };
    await request(server.baseUrl, 'GET', '/api/chores/current', { headers });
    const created = await request(server.baseUrl, 'POST', '/api/chores', {
      headers,
      body: { task: 'User-added task', frequency: 'ukentlig', defaultDay: 1 },
    });
    assert.equal(created.status, 201);
    const id = created.body.chore.id;

    const del = await request(server.baseUrl, 'DELETE', `/api/chores/${id}`, { headers });
    assert.equal(del.status, 200);
    assert.equal(del.body.chore.active, false);

    const current = await request(server.baseUrl, 'GET', '/api/chores/current', { headers });
    assert.equal(
      current.body.chores.some((c) => c.choreId === id),
      false
    );

    const later = getWeekYear(new Date(Date.now() + 21 * 86400000));
    runWithFamily(adult.familyId, () => {
      const { ensureWeek } = require('../server/services/seed.service');
      ensureWeek(server.repos, later);
      const rows = server.repos.choreSchedules.getWeek(later);
      assert.equal(
        rows.some((r) => r.choreId === id),
        false
      );
    });
  });

  test('adult can delete a seeded standard chore', async () => {
    const adult = createUser('seeded@fixes.test', 'owner', 'Seeded Chores');
    const headers = { Cookie: adult.cookie };
    runWithFamily(adult.familyId, () => {
      server.repos.chores.upsertMany([
        {
          task: 'Støvsuge hus + hagestue',
          frequency: 'ukentlig',
          defaultDay: 0,
          icon: '🧹',
          active: true,
        },
      ]);
    });
    const current = await request(server.baseUrl, 'GET', '/api/chores/current', { headers });
    const row = current.body.chores.find((c) => c.task === 'Støvsuge hus + hagestue');
    assert.ok(row, 'seeded chore should be on the board');

    const del = await request(server.baseUrl, 'DELETE', `/api/chores/${row.choreId}`, { headers });
    assert.equal(del.status, 200);

    const after = await request(server.baseUrl, 'GET', '/api/chores/current', { headers });
    assert.equal(
      after.body.chores.some((c) => c.choreId === row.choreId),
      false
    );
  });

  test('another family cannot delete the chore', async () => {
    const a = createUser('iso-a@fixes.test', 'owner', 'Iso A');
    const b = createUser('iso-b@fixes.test', 'owner', 'Iso B');
    const created = await request(server.baseUrl, 'POST', '/api/chores', {
      headers: { Cookie: a.cookie },
      body: { task: 'Only A', frequency: 'ukentlig', defaultDay: 0 },
    });
    const id = created.body.chore.id;
    const del = await request(server.baseUrl, 'DELETE', `/api/chores/${id}`, {
      headers: { Cookie: b.cookie },
    });
    assert.equal(del.status, 404);
    const still = await request(server.baseUrl, 'GET', '/api/chores', {
      headers: { Cookie: a.cookie },
    });
    assert.equal(
      still.body.chores.some((c) => c.id === id && c.active === true),
      true
    );
  });

  test('child cannot delete a chore', async () => {
    const owner = createUser('child-owner@fixes.test', 'owner', 'Child Delete Fam');
    const childUser = server.repos.auth.createUser({
      email: 'child@fixes.test',
      name: 'Child',
    });
    server.repos.auth.setFamily(childUser.id, owner.familyId, 'child');
    const sid = crypto.randomBytes(32).toString('hex');
    server.repos.auth.createSession({ id: sid, userId: childUser.id, ttlDays: 30 });
    const created = await request(server.baseUrl, 'POST', '/api/chores', {
      headers: { Cookie: owner.cookie },
      body: { task: 'Not for child', frequency: 'ukentlig', defaultDay: 2 },
    });
    const del = await request(server.baseUrl, 'DELETE', `/api/chores/${created.body.chore.id}`, {
      headers: { Cookie: cookieHeader(sid) },
    });
    assert.equal(del.status, 403);
  });

  test('clear dinner removes the recipe and the swap body already has the new one', async () => {
    const adult = createUser('meals@fixes.test', 'owner', 'Meals Fixes');
    const headers = { Cookie: adult.cookie };
    runWithFamily(adult.familyId, () => {
      const { seedFamilyDefaults } = require('../server/services/seed.service');
      seedFamilyDefaults(server.repos, adult.familyId);
    });
    const later = getWeekYear(new Date(Date.now() + 28 * 86400000));
    const week = await request(server.baseUrl, 'GET', `/api/meals/week/${later}`, { headers });
    assert.equal(week.status, 200);
    const monday = week.body.meals.find((m) => m.dayOfWeek === 0);
    assert.ok(monday.recipeId, 'new week should suggest a dinner');

    const cleared = await request(server.baseUrl, 'PUT', '/api/meals/clear', {
      headers,
      body: { weekYear: later, dayOfWeek: 0 },
    });
    assert.equal(cleared.status, 200);
    const clearedMonday = cleared.body.week.meals.find((m) => m.dayOfWeek === 0);
    assert.equal(clearedMonday.recipeId, null);
    assert.equal(clearedMonday.recipe, null);
    assert.equal(clearedMonday.status, 'removed');

    const again = await request(server.baseUrl, 'GET', `/api/meals/week/${later}`, { headers });
    const persisted = again.body.meals.find((m) => m.dayOfWeek === 0);
    assert.equal(persisted.status, 'removed');
    assert.equal(persisted.recipe, null);

    const recipes = await request(server.baseUrl, 'GET', '/api/recipes', { headers });
    const other = recipes.body.recipes.find((r) => r.id !== monday.recipeId);
    assert.ok(other);
    const swap = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      headers,
      body: { weekYear: later, dayOfWeek: 1, recipeId: other.id },
    });
    assert.equal(swap.status, 200);
    const swapped = swap.body.week.meals.find((m) => m.dayOfWeek === 1);
    assert.equal(swapped.recipeId, other.id);
    assert.equal(swapped.recipe.name, other.name);
  });

  test('two newly opened weeks are not the same menu', async () => {
    const adult = createUser('weeks@fixes.test', 'owner', 'Week Variety');
    const headers = { Cookie: adult.cookie };
    runWithFamily(adult.familyId, () => {
      const { seedFamilyDefaults } = require('../server/services/seed.service');
      seedFamilyDefaults(server.repos, adult.familyId);
    });
    const weekA = getWeekYear(new Date(Date.now() + 35 * 86400000));
    const weekB = getWeekYear(new Date(Date.now() + 42 * 86400000));
    assert.notEqual(weekA, weekB);
    const a = await request(server.baseUrl, 'GET', `/api/meals/week/${weekA}`, { headers });
    const b = await request(server.baseUrl, 'GET', `/api/meals/week/${weekB}`, { headers });
    const idsA = a.body.meals.map((m) => m.recipeId);
    const idsB = b.body.meals.map((m) => m.recipeId);
    assert.equal(idsA.filter(Boolean).length, 7);
    assert.equal(idsB.filter(Boolean).length, 7);
    assert.notDeepEqual(idsA, idsB);
    const classic = [
      'Kylling red curry med jasminris',
      'Laks i airfryer med potetbåter og brokkolini',
      'Pasta med scampi, hvitløk og chili',
      'Mongolian beef med ris og wokede grønnsaker',
      'Smashburger i brioche med løkringer og coleslaw',
      'Hjemmelaget pizza på pizzastein',
      'Langtidsstekt nakkekoteletter med rotgrønnsaker',
    ];
    const namesB = b.body.meals.map((m) => m.recipe && m.recipe.name);
    assert.notDeepEqual(namesB, classic);
  });

  test('family B cannot clear family A dinner', async () => {
    const a = createUser('clear-a@fixes.test', 'owner', 'Clear A');
    const b = createUser('clear-b@fixes.test', 'owner', 'Clear B');
    runWithFamily(a.familyId, () => {
      const { seedFamilyDefaults } = require('../server/services/seed.service');
      seedFamilyDefaults(server.repos, a.familyId);
    });
    const later = getWeekYear(new Date(Date.now() + 49 * 86400000));
    const week = await request(server.baseUrl, 'GET', `/api/meals/week/${later}`, {
      headers: { Cookie: a.cookie },
    });
    const before = week.body.meals.find((m) => m.dayOfWeek === 3).recipeId;
    assert.ok(before);
    const cleared = await request(server.baseUrl, 'PUT', '/api/meals/clear', {
      headers: { Cookie: b.cookie },
      body: { weekYear: later, dayOfWeek: 3 },
    });
    assert.equal(cleared.status, 200);
    const after = await request(server.baseUrl, 'GET', `/api/meals/week/${later}`, {
      headers: { Cookie: a.cookie },
    });
    assert.equal(after.body.meals.find((m) => m.dayOfWeek === 3).recipeId, before);
  });
});
