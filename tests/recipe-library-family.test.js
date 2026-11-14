'use strict';

const fs = require('fs');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
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
