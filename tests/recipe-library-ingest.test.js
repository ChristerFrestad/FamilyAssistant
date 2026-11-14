'use strict';

const fs = require('fs');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { parseLibraryIngredient } = require('../server/services/recipe-library/ingredients');
const { matchCatalogKey } = require('../server/services/recipe-library/catalog-match');
const { libraryRecordFromHtml } = require('../server/services/recipe-library/record');
const {
  ingestRecipeLibrary,
  USER_AGENT,
  DELAY_MS,
} = require('../server/services/recipe-library/ingest');
const { enabledSources, SOURCES } = require('../server/services/recipe-library/sources');
const { recipeSourcesSyncJob } = require('../server/cron');

const FIXTURES = path.join(__dirname, 'fixtures', 'recipe-library');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('ingredient lines parse kg and mixed ss/tbsp without guessing', () => {
  const potatoes = parseLibraryIngredient('1.00 kg poteter');
  assert.equal(potatoes.qty, 1);
  assert.equal(potatoes.unit, 'kg');
  assert.equal(potatoes.name, 'poteter');
  const butter = parseLibraryIngredient('2 ss / tbsp smør');
  assert.equal(butter.unit, 'ss');
  assert.equal(butter.name, 'smør');
  const unknown = parseLibraryIngredient('en neve dill');
  assert.equal(unknown.qty, null);
  assert.equal(unknown.unit, null);
  assert.equal(unknown.name, 'en neve dill');
});

test('catalog match is exact or a unique slug, never a longer key', () => {
  const products = server.repos.products.getAllAsMap();
  assert.equal(matchCatalogKey('poteter', products), 'poteter');
  assert.equal(matchCatalogKey('Poteter', products), 'poteter');
  assert.equal(matchCatalogKey('løk', products), 'løk');
  assert.notEqual(matchCatalogKey('løk', products), 'hvitløk');
  assert.equal(matchCatalogKey('noe-helt-ukjent', products), null);
});

test('library HTML keeps no method text and stores structured ingredients', () => {
  for (const file of ['meny.html', 'altasiatisk.html', 'coop.html', 'rema.html']) {
    const html = fixture(file);
    assert.equal(html.includes('recipeInstructions'), false);
    const record = libraryRecordFromHtml(
      html,
      'https://example.test/' + file,
      file,
      server.repos.products.getAllAsMap()
    );
    assert.ok(record);
    assert.equal(JSON.stringify(record).includes('recipeInstructions'), false);
  }
  const meny = libraryRecordFromHtml(
    fixture('meny.html'),
    'https://meny.no/oppskrifter/fisk/fiskekaker',
    'Meny',
    server.repos.products.getAllAsMap()
  );
  assert.equal(meny.totalTimeMin, 25);
  assert.equal(meny.imageUrl, 'https://meny.no/img/fiskekaker.jpg');
  const potato = meny.ingredients.find((ing) => ing.name === 'poteter');
  assert.equal(potato.productKey, 'poteter');
  const dill = meny.ingredients.find((ing) => ing.rawLine === 'en neve dill');
  assert.equal(dill.productKey, null);
});

test('ingest reads fixture pages, waits per host, and resumes', async () => {
  const recipeUrl = 'https://meny.no/oppskrifter/fisk/fiskekaker';
  const sitemap = `<?xml version="1.0"?><urlset><url><loc>${recipeUrl}</loc></url></urlset>`;
  const calls = [];
  let clock = 0;
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ua: init.headers['User-Agent'], inm: init.headers['If-None-Match'] });
    const body = String(url).endsWith('.xml') ? sitemap : fixture('meny.html');
    return {
      status: 200,
      headers: { get: (name) => (name === 'etag' ? '"meny-1"' : null) },
      text: async () => body,
    };
  };
  const deps = {
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  const first = await ingestRecipeLibrary(server.repos, {
    sourceId: 'meny',
    maxPages: 5,
    ...deps,
  });
  assert.equal(first.stored, 1);
  assert.ok(calls.every((call) => call.ua === USER_AGENT));
  assert.ok(sleeps.every((ms) => ms >= DELAY_MS));
  const row = server.repos.recipeLibrary.getById(
    server.repos._db.prepare('SELECT id FROM recipe_library WHERE canonical_url = ?').get(recipeUrl)
      .id
  );
  assert.equal(row.title, 'Meny fiskekaker');
  const columns = server.repos._db
    .prepare('PRAGMA table_info(recipe_library)')
    .all()
    .map((col) => col.name);
  assert.equal(columns.includes('notes'), false);
  assert.equal(columns.includes('family_id'), false);

  const recipeFetches = () => calls.filter((call) => call.url === recipeUrl).length;
  assert.equal(recipeFetches(), 1);
  await ingestRecipeLibrary(server.repos, { sourceId: 'meny', maxPages: 5, ...deps });
  assert.equal(recipeFetches(), 1);
});

test('disabled publishers stay in the config list', () => {
  const enabled = new Set(enabledSources().map((source) => source.id));
  for (const id of ['meny', 'altasiatisk', 'coop', 'rema']) assert.equal(enabled.has(id), true);
  for (const id of ['matprat', 'aperitif', 'godt', 'tine']) assert.equal(enabled.has(id), false);
  assert.equal(SOURCES.length, 8);
});

test('recipe-sources cron does not crawl while the flag is off', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await recipeSourcesSyncJob(server.repos);
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((line) => line.includes('Recipe-library ingest is off')));
});
