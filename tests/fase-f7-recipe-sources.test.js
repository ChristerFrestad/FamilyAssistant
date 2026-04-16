// Fase F7 — Recipe sources + connector-interface
//
// Tester:
//   1. detectType — type-detektering
//   2. Stub-connectors returnerer tomme arrays med note
//   3. CRUD på /api/sources
//   4. POST /api/sources/:id/sync
//   5. GET /api/recipes?source=mine|ai|all

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const recipeSources = require('../server/services/recipe-sources.service');
const { startTestServer, request } = require('./helpers');

describe('Fase F7 — detectType', () => {
  test('Pinterest', () => {
    assert.equal(recipeSources.detectType('https://pinterest.com/user/board'), 'pinterest');
    assert.equal(recipeSources.detectType('https://www.pinterest.no/bruker'), 'pinterest');
  });

  test('Godt.no', () => {
    assert.equal(recipeSources.detectType('https://godt.no/oppskrift/123'), 'godt');
  });

  test('RSS', () => {
    assert.equal(recipeSources.detectType('https://example.com/feed'), 'rss');
    assert.equal(recipeSources.detectType('https://example.com/blog.rss'), 'rss');
    assert.equal(recipeSources.detectType('https://example.com/feed.xml'), 'rss');
  });

  test('generisk HTML', () => {
    assert.equal(recipeSources.detectType('https://some-blog.com/recipe'), 'html');
  });

  test('ikke-URL', () => {
    assert.equal(recipeSources.detectType('not a url'), 'unknown');
    assert.equal(recipeSources.detectType(''), 'unknown');
    assert.equal(recipeSources.detectType(null), 'unknown');
  });
});

describe('Fase F7 — connector stubs', () => {
  test('pinterest stub returnerer tom array med note', async () => {
    const r = await recipeSources.connectors.pinterest.sync('https://pinterest.com/test');
    assert.deepEqual(r.recipes, []);
    assert.ok(r.note);
  });

  test('godt stub returnerer tom array', async () => {
    const r = await recipeSources.connectors.godt.sync('https://godt.no/test');
    assert.deepEqual(r.recipes, []);
  });

  test('rss stub returnerer tom array', async () => {
    const r = await recipeSources.connectors.rss.sync('https://example.com/feed');
    assert.deepEqual(r.recipes, []);
  });

  test('html fallback stub returnerer tom array', async () => {
    const r = await recipeSources.connectors.html.sync('https://blog.com/recipe');
    assert.deepEqual(r.recipes, []);
  });
});

describe('Fase F7 — CRUD /api/sources', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('GET /api/sources tom ved oppstart', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/sources');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.sources));
    assert.equal(r.body.sources.length, 0);
  });

  test('POST /api/sources med gyldig URL', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: { url: 'https://pinterest.com/example-recipes' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.type, 'pinterest');
    assert.ok(r.body.id > 0);
  });

  test('POST /api/sources med duplikat URL → 400', async () => {
    await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: { url: 'https://godt.no/dup-test' },
    });
    const r = await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: { url: 'https://godt.no/dup-test' },
    });
    assert.equal(r.status, 400);
  });

  test('POST /api/sources uten url → 400', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: {},
    });
    assert.equal(r.status, 400);
  });

  test('POST /api/sources med ugyldig url → 400', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: { url: 'not a url' },
    });
    assert.equal(r.status, 400);
  });

  test('GET /api/sources etter insert', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/sources');
    assert.equal(r.status, 200);
    assert.ok(r.body.sources.length > 0);
    for (const s of r.body.sources) {
      assert.ok(s.id);
      assert.ok(s.url);
      assert.ok(s.type);
      assert.equal(typeof s.enabled, 'boolean');
    }
  });

  test('DELETE /api/sources/:id', async () => {
    const addR = await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: { url: 'https://delete-me.com/feed' },
    });
    const id = addR.body.id;
    const delR = await request(ctx.baseUrl, 'DELETE', `/api/sources/${id}`);
    assert.equal(delR.status, 200);

    // Sjekk at den er borte
    const listR = await request(ctx.baseUrl, 'GET', '/api/sources');
    assert.ok(!listR.body.sources.find((s) => s.id === id));
  });

  test('POST /api/sources/:id/sync kaller connector (stub)', async () => {
    const addR = await request(ctx.baseUrl, 'POST', '/api/sources', {
      body: { url: 'https://pinterest.com/sync-test-unique' },
    });
    const id = addR.body.id;
    const syncR = await request(ctx.baseUrl, 'POST', `/api/sources/${id}/sync`);
    assert.equal(syncR.status, 200);
    assert.equal(syncR.body.ok, true);
    assert.equal(syncR.body.count, 0); // stub returnerer 0
  });
});

describe('Fase F7 — recipes ?source filter', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('GET /api/recipes returnerer alle uten filter', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/recipes');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.recipes));
    assert.ok(r.body.recipes.length > 0);
  });

  test('GET /api/recipes?source=mine returnerer seed-oppskrifter', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/recipes?source=mine');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.recipes));
    // Seed-oppskrifter har source='manual' (default)
    assert.ok(r.body.recipes.length > 0);
  });

  test('GET /api/recipes?source=ai returnerer tom (ingen ai-seed)', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/recipes?source=ai');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.recipes));
    assert.equal(r.body.recipes.length, 0);
  });
});
