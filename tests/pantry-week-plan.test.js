'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { serializeCookie } = require('../server/auth/cookies');
const {
  regenerateUnlockedDays,
  resolveMode,
  suggestionReason,
} = require('../server/services/meal-planning.service');
const { rankRecipes } = require('../server/services/pantry-coverage.service');
const { getWeekYearInTimeZone } = require('../server/services/seed.service');
const { sundayPushJob } = require('../server/cron');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('a family with no mode ranks by pantry and expiry', () => {
  assert.equal(resolveMode(server.repos), 'balansert');
  assert.equal(suggestionReason(3, 0), 'Bruker 3 ting du har');
  assert.equal(suggestionReason(1, 2), 'Går ut snart');
});

test('pantry ranking puts the stocked dinner first', () => {
  const ranked = rankRecipes(
    [
      {
        id: 1,
        category: 'rask',
        ingredients: [{ productKey: 'poteter', qty: 200, unit: 'g' }],
      },
      {
        id: 2,
        category: 'rask',
        ingredients: [{ productKey: 'ris', qty: 200, unit: 'g' }],
      },
    ],
    { poteter: { qtyRemaining: 1, unit: 'kg' } },
    'balansert'
  );
  assert.equal(ranked[0].recipe.id, 1);
  assert.ok(ranked[0].score > ranked[1].score);
});

function recipeCount(familyId) {
  return server.repos._db
    .prepare('SELECT COUNT(*) AS c FROM recipes WHERE family_id = ?')
    .get(familyId).c;
}

function ownerCookie(email) {
  const familyId = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(email).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, 'owner');
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  const cookie = serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
  return { familyId, cookie };
}

function libraryRecipe(title, category) {
  return server.repos.recipeLibrary.upsert({
    title,
    sourceName: 'Meny',
    canonicalUrl: `https://meny.no/oppskrifter/test/${title.toLowerCase().replace(/\s+/g, '-')}`,
    imageUrl: null,
    servings: 4,
    totalTimeMin: 30,
    category,
    fetchedAt: '2026-11-14T00:00:00.000Z',
    ingredients: [{ rawLine: 'potet', qty: 2, unit: 'stk', name: 'potet', productKey: 'potet' }],
  });
}

test('suggest again requires confirmation and keeps a cooked day and a manual choice', async () => {
  const week = '2091-W20';
  const recipes = runWithFamily(1, () => server.repos.recipes.getAll());
  const first = recipes[0];
  const chosen = recipes.find((recipe) => recipe.category === 'comfort') || recipes[2];
  const auto = recipes[1];
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 0, first.id, 'cooked', 'manual');
    server.repos.mealPlans.setRecipe(week, 2, chosen.id, 'planned', 'manual');
    server.repos.mealPlans.setRecipe(week, 1, auto.id, 'planned', 'auto');
  });
  const refused = await request(server.baseUrl, 'POST', `/api/meals/week/${week}/suggest-again`);
  assert.equal(refused.status, 400);
  const untouched = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  assert.equal(untouched.find((slot) => slot.dayOfWeek === 1).recipeId, auto.id);

  const res = await request(server.baseUrl, 'POST', `/api/meals/week/${week}/suggest-again`, {
    body: { confirm: true },
  });
  assert.equal(res.status, 200);
  const plan = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  const cooked = plan.find((slot) => slot.dayOfWeek === 0);
  const manual = plan.find((slot) => slot.dayOfWeek === 2);
  assert.equal(cooked.recipeId, first.id);
  assert.equal(cooked.status, 'cooked');
  assert.equal(manual.recipeId, chosen.id);
  assert.equal(manual.planOrigin, 'manual');
});

test('sunday job keeps an opened week and names the dinners it stored', () => {
  const week = getWeekYearInTimeZone(new Date(Date.now() + 7 * 86400000));
  const recipe = runWithFamily(1, () => server.repos.recipes.getAll()[0]);
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 0, recipe.id, 'planned', 'auto');
    server.repos.mealPlans.setRecipe(week, 1, null, 'planned', 'auto');
  });
  sundayPushJob(server.repos);
  const after = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  const monday = after.find((slot) => slot.dayOfWeek === 0);
  assert.equal(monday.recipeId, recipe.id);
  assert.equal(monday.planOrigin, 'auto');
  const note = server.repos._db
    .prepare(
      `SELECT message FROM notifications
        WHERE family_id = 1 AND type = 'sunday_push'
        ORDER BY id DESC LIMIT 1`
    )
    .get();
  assert.equal(note.message.includes(recipe.name), true);
  assert.equal(note.message.includes('er klart'), true);
});

test('regenerate leaves a manual planned dinner when only automatic days move', () => {
  const week = '2093-W03';
  const recipes = runWithFamily(1, () => server.repos.recipes.getAll());
  runWithFamily(1, () => {
    server.repos.mealPlans.setRecipe(week, 2, recipes[2].id, 'planned', 'manual');
    regenerateUnlockedDays(server.repos, week, { onlyAuto: true });
  });
  const plan = runWithFamily(1, () => server.repos.mealPlans.getWeek(week));
  const kept = plan.find((slot) => slot.dayOfWeek === 2);
  assert.equal(kept.recipeId, recipes[2].id);
  assert.equal(kept.planOrigin, 'manual');
});

test('opening, regenerating and the Sunday job do not copy a library recipe', async () => {
  const owner = ownerCookie('library-plan@example.com');
  const before = recipeCount(owner.familyId);
  libraryRecipe('Bibliotek taco', 'rask');
  libraryRecipe('Bibliotek fredag', 'comfort');
  libraryRecipe('Bibliotek helg', 'helg');
  const week = '2092-W33';
  const opened = await request(server.baseUrl, 'GET', `/api/meals/week/${week}`, {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(opened.status, 200);
  assert.equal(recipeCount(owner.familyId), before);
  const referenced = opened.body.meals.some(
    (slot) => slot.libraryRecipeId && slot.recipe && slot.recipe.fromLibrary === true
  );
  assert.equal(referenced, true);

  await request(server.baseUrl, 'POST', `/api/meals/week/${week}/suggest-again`, {
    headers: { Cookie: owner.cookie },
    body: { confirm: true },
  });
  assert.equal(recipeCount(owner.familyId), before);

  runWithFamily(owner.familyId, () => {
    for (let day = 0; day < 7; day += 1) {
      server.repos.mealPlans.setRecipe(week, day, null, 'away', 'manual');
    }
    const snapshot = server.repos.mealPlans.getWeek(week);
    regenerateUnlockedDays(server.repos, week);
    assert.deepEqual(server.repos.mealPlans.getWeek(week), snapshot);
  });
  assert.equal(recipeCount(owner.familyId), before);
});

test('a locked Monday does not move its pick onto Friday', () => {
  const week = '2096-W11';
  runWithFamily(1, () => {
    const recipes = server.repos.recipes.getAll();
    const monday = recipes.find((recipe) => recipe.category === 'rask');
    const fridayLock = recipes.find((recipe) => recipe.category === 'rask');
    server.repos.mealPlans.setRecipe(week, 0, monday.id, 'cooked', 'manual');
    regenerateUnlockedDays(server.repos, week);
    const friday = server.repos.mealPlans.getWeek(week).find((slot) => slot.dayOfWeek === 4);
    const fridayRecipe = friday.recipeId
      ? server.repos.recipes.getById(friday.recipeId)
      : server.repos.recipeLibrary.getById(friday.libraryRecipeId);
    assert.equal(fridayRecipe.category, 'comfort');
    assert.equal(
      server.repos.mealPlans.getWeek(week).find((slot) => slot.dayOfWeek === 0).recipeId,
      monday.id
    );

    server.repos.mealPlans.setRecipe('2096-W12', 4, fridayLock.id, 'cooked', 'manual');
    regenerateUnlockedDays(server.repos, '2096-W12');
    const sunday = server.repos.mealPlans.getWeek('2096-W12').find((slot) => slot.dayOfWeek === 6);
    const sundayRecipe = sunday.recipeId
      ? server.repos.recipes.getById(sunday.recipeId)
      : server.repos.recipeLibrary.getById(sunday.libraryRecipeId);
    assert.equal(sundayRecipe.category, 'helg');
    assert.equal(
      server.repos.mealPlans.getWeek('2096-W12').find((slot) => slot.dayOfWeek === 4).recipeId,
      fridayLock.id
    );
  });
});

test('regenerate picks a different dinner when another one exists', () => {
  const week = '2097-W08';
  runWithFamily(1, () => {
    const recipes = server.repos.recipes.getAll().filter((recipe) => recipe.category === 'rask');
    server.repos.mealPlans.setRecipe(week, 1, recipes[0].id, 'planned', 'auto');
    regenerateUnlockedDays(server.repos, week);
    const first = server.repos.mealPlans.getWeek(week).find((slot) => slot.dayOfWeek === 1);
    regenerateUnlockedDays(server.repos, week);
    const second = server.repos.mealPlans.getWeek(week).find((slot) => slot.dayOfWeek === 1);
    assert.notEqual(first.recipeId, second.recipeId);
  });
});

test('a failed regenerate writes nothing', () => {
  const week = '2098-W04';
  const original = server.repos.mealPlans.setRecipe;
  runWithFamily(1, () => {
    const recipeId = server.repos.recipes.getAll()[0].id;
    server.repos.mealPlans.setRecipe(week, 1, recipeId, 'planned', 'auto');
    server.repos.mealPlans.setRecipe(week, 3, recipeId, 'planned', 'auto');
    const before = server.repos.mealPlans.getWeek(week);
    let calls = 0;
    server.repos.mealPlans.setRecipe = (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('stop');
      return original.apply(server.repos.mealPlans, args);
    };
    assert.throws(() => regenerateUnlockedDays(server.repos, week), /stop/);
    server.repos.mealPlans.setRecipe = original;
    assert.deepEqual(server.repos.mealPlans.getWeek(week), before);
  });
});
