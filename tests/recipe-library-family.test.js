'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { seedFamilyDefaults } = require('../server/services/seed.service');
const { getSwapSuggestions } = require('../server/services/meal-planning.service');
const { recipes: seedRecipes } = require('../server/seed');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

function libraryId() {
  return server.repos.recipeLibrary.upsert({
    title: 'Testwok med kylling',
    sourceName: 'Meny',
    canonicalUrl: 'https://meny.no/oppskrifter/kylling/testwok',
    imageUrl: 'https://meny.no/img/testwok.jpg',
    servings: 2,
    totalTimeMin: 20,
    category: 'rask',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    ingredients: [
      {
        rawLine: '400 g kyllingfilet',
        qty: 400,
        unit: 'g',
        name: 'kyllingfilet',
        productKey: 'kyllingfilet',
      },
    ],
  });
}

test('search filters title, ingredient, source and time', () => {
  libraryId();
  server.repos.recipeLibrary.upsert({
    title: 'Lang gryte',
    sourceName: 'Coop',
    canonicalUrl: 'https://www.coop.no/oppskrifter/lang-gryte',
    imageUrl: null,
    servings: 4,
    totalTimeMin: 90,
    category: 'comfort',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    ingredients: [{ rawLine: '1 løk', qty: 1, unit: 'stk', name: 'løk', productKey: 'løk' }],
  });
  const rows = server.repos.recipeLibrary.search({
    q: 'wok',
    ingredient: 'kylling',
    source: 'Meny',
    maxMinutes: 30,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Testwok med kylling');
  assert.equal(rows[0].imageUrl, 'https://meny.no/img/testwok.jpg');
});

test('copy keeps url, source and product key, and a second copy does not duplicate', async () => {
  const id = libraryId();
  const first = await request(server.baseUrl, 'POST', `/api/recipe-library/${id}/copy`, {
    body: {},
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.alreadyAdded, false);
  const recipe = server.repos.recipes.getById(first.body.recipeId);
  assert.equal(recipe.source_type, 'imported');
  assert.equal(recipe.source, 'Meny');
  assert.equal(recipe.url, 'https://meny.no/oppskrifter/kylling/testwok');
  assert.equal(recipe.ingredients[0].productKey, 'kyllingfilet');

  const second = await request(server.baseUrl, 'POST', `/api/recipe-library/${id}/copy`, {
    body: {},
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyAdded, true);
  assert.equal(second.body.recipeId, first.body.recipeId);
  const copies = server.repos._db
    .prepare('SELECT COUNT(*) AS n FROM recipes WHERE url = ?')
    .get('https://meny.no/oppskrifter/kylling/testwok');
  assert.equal(copies.n, 1);
});

test('later families match seed suggestions by name and fill from the library', () => {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Later').lastInsertRowid
  );
  seedFamilyDefaults(server.repos, fid);
  const seedWok = seedRecipes.find((recipe) => recipe.id === 8);
  const suggestions = runWithFamily(fid, () => getSwapSuggestions(server.repos, 0, '2026-W46'));
  const wok = suggestions.find((item) => item.name === seedWok.name);
  assert.ok(wok);
  assert.notEqual(wok.recipeId, 8);

  runWithFamily(fid, () => {
    server.repos._db.prepare('UPDATE recipes SET active = 0 WHERE family_id = ?').run(fid);
  });
  libraryId();
  const filled = runWithFamily(fid, () => getSwapSuggestions(server.repos, 0, '2026-W46'));
  const fromLibrary = filled.find(
    (item) => item.fromLibrary === true && item.sourceName === 'Meny'
  );
  assert.ok(fromLibrary);
  assert.match(fromLibrary.sourceLabel, /^Fra /);
});

test('seed copies lose the shared salmon url and keep other listing urls', () => {
  const salmon = server.repos._db
    .prepare('SELECT url FROM recipes WHERE name = ?')
    .get('Bakt laks med honning og soya i airfryer');
  assert.equal(salmon.url, null);
  const other = server.repos._db
    .prepare('SELECT url FROM recipes WHERE name = ?')
    .get('Laks i airfryer med potetbåter og brokkolini');
  assert.equal(other.url, 'https://www.matprat.no/oppskrifter/rask/laks-i-airfryer/');

  const familyId = 1;
  server.repos._db
    .prepare(
      `INSERT INTO recipes (family_id, name, category, url, servings, source_type)
       VALUES (?, 'Bakt laks med honning og soya i airfryer', 'rask', ?, 2, 'manual')`
    )
    .run(familyId, 'https://www.matprat.no/oppskrifter/rask/laks-i-airfryer/');
  server.repos._db
    .prepare(
      `INSERT INTO recipes (family_id, name, category, url, servings, source_type)
       VALUES (?, 'Pasta med scampi, hvitløk og chili', 'rask', ?, 2, 'manual')`
    )
    .run(familyId, 'https://www.matprat.no/oppskrifter/');

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'migrations', '037_seed_recipe_source_urls.sql'),
    'utf8'
  );
  server.repos._db.exec(sql);

  const fixed = server.repos._db
    .prepare(
      `SELECT url FROM recipes
        WHERE name = 'Bakt laks med honning og soya i airfryer'
          AND url IS NOT NULL`
    )
    .all();
  assert.equal(fixed.length, 0);
  const listing = server.repos._db
    .prepare('SELECT url FROM recipes WHERE name = ? AND url = ?')
    .get('Pasta med scampi, hvitløk og chili', 'https://www.matprat.no/oppskrifter/');
  assert.ok(listing);
});

function cookieFor(email, role) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(email).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  const cookie = serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
  return { familyId: fid, cookie };
}

test('search text over 200 characters is rejected', async () => {
  const res = await request(server.baseUrl, 'GET', '/api/recipe-library?q=' + 'a'.repeat(201));
  assert.equal(res.status, 400);
});

test('a non-https source is refused and a trailing slash is the same recipe', async () => {
  const httpId = Number(
    server.repos._db
      .prepare(
        `INSERT INTO recipe_library (title, source_name, canonical_url, fetched_at, active)
         VALUES ('Http rett', 'Meny', 'http://meny.no/oppskrifter/fisk/http', '2026-11-14T00:00:00.000Z', 1)`
      )
      .run().lastInsertRowid
  );
  const refused = await request(server.baseUrl, 'POST', `/api/recipe-library/${httpId}/copy`, {
    body: {},
  });
  assert.equal(refused.status, 400);

  const slashId = server.repos.recipeLibrary.upsert({
    title: 'Slash wok',
    sourceName: 'Meny',
    canonicalUrl: 'https://meny.no/oppskrifter/kylling/slash-wok',
    imageUrl: null,
    servings: 2,
    totalTimeMin: 20,
    category: 'rask',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    ingredients: [],
  });
  server.repos._db
    .prepare(
      `INSERT INTO recipes (family_id, name, category, url, servings, source_type)
       VALUES (1, 'Allerede', 'rask', ?, 2, 'imported')`
    )
    .run('https://meny.no/oppskrifter/kylling/slash-wok/');
  const again = await request(server.baseUrl, 'POST', `/api/recipe-library/${slashId}/copy`, {
    body: {},
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyAdded, true);
});

test('a missing quantity is not stored as 1 stk', () => {
  const id = server.repos.recipeLibrary.upsert({
    title: 'Uten mengde',
    sourceName: 'Meny',
    canonicalUrl: 'https://meny.no/oppskrifter/fisk/uten-mengde',
    imageUrl: null,
    servings: 2,
    totalTimeMin: 10,
    category: 'rask',
    fetchedAt: '2026-11-14T00:00:00.000Z',
    ingredients: [
      {
        rawLine: 'salt og pepper',
        qty: null,
        unit: null,
        name: 'salt og pepper',
        productKey: null,
      },
      { rawLine: '400 g laks', qty: 400, unit: 'g', name: 'laks', productKey: null },
    ],
  });
  const { copyLibraryRecipe } = require('../server/services/recipe-library/copy');
  const copied = runWithFamily(1, () => copyLibraryRecipe(server.repos, id));
  assert.equal(copied.rejected, undefined);
  const salt = copied.recipe.ingredients.find((ing) => ing.name === 'salt og pepper');
  const laks = copied.recipe.ingredients.find((ing) => ing.name === 'laks');
  assert.ok(salt);
  assert.equal(salt.qty, null);
  assert.equal(salt.unit, null);
  assert.ok(laks);
  assert.equal(laks.qty, 400);
  assert.equal(laks.unit, 'g');
});

test('planning the last open day builds the shopping list', async () => {
  const id = libraryId();
  const wk = '2080-W30';
  for (let day = 0; day < 6; day += 1) {
    server.repos.mealPlans.setRecipe(wk, day, 1, 'planned');
  }
  server.repos.mealPlans.setRecipe(wk, 6, null, 'planned');
  assert.equal(server.repos.mealPlans.isWeekComplete(wk), false);

  const res = await request(server.baseUrl, 'POST', `/api/recipe-library/${id}/plan`, {
    body: { weekYear: wk, dayOfWeek: 6 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.autogeneratedShoppingList.created, true);
  assert.ok(server.repos.shoppingLists.getActive(wk));
});

test('a child cannot copy or plan, and each family keeps its own copy', async () => {
  const id = libraryId();
  const child = cookieFor('child-library@example.com', 'child');
  const denied = await request(server.baseUrl, 'POST', `/api/recipe-library/${id}/copy`, {
    headers: { Cookie: child.cookie },
    body: {},
  });
  assert.equal(denied.status, 403);
  const deniedPlan = await request(server.baseUrl, 'POST', `/api/recipe-library/${id}/plan`, {
    headers: { Cookie: child.cookie },
    body: { dayOfWeek: 0 },
  });
  assert.equal(deniedPlan.status, 403);

  const a = cookieFor('family-a-library@example.com', 'owner');
  const b = cookieFor('family-b-library@example.com', 'owner');
  const { copyLibraryRecipe } = require('../server/services/recipe-library/copy');
  const copyA = runWithFamily(a.familyId, () => copyLibraryRecipe(server.repos, id));
  const copyB = runWithFamily(b.familyId, () => copyLibraryRecipe(server.repos, id));
  assert.equal(copyA.alreadyAdded, false);
  assert.equal(copyB.alreadyAdded, false);
  assert.notEqual(copyA.recipeId, copyB.recipeId);
  const seenByA = runWithFamily(a.familyId, () => server.repos.recipes.getAll());
  const seenByB = runWithFamily(b.familyId, () => server.repos.recipes.getAll());
  assert.equal(
    seenByA.some((recipe) => recipe.id === copyB.recipeId),
    false
  );
  assert.equal(
    seenByB.some((recipe) => recipe.id === copyA.recipeId),
    false
  );
});
