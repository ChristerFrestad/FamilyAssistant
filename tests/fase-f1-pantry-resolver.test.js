// Fase F1 — Pantry normalisering + katalog-match
//
// Tester:
//   1. slugifyProductKey — canonical slug fra fritekst
//   2. pantry-resolver — katalog-søk + historikk-vekting + kilde-badge
//   3. GET /api/pantry/suggest — endpoint-roundtrip
//   4. POST /api/pantry/add med query — resolver server-side

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { slugifyProductKey } = require('../server/services/slugify');
const { startTestServer, request } = require('./helpers');

describe('Fase F1 — slugifyProductKey', () => {
  test('lowercase + bindestrek fra mellomrom', () => {
    assert.equal(slugifyProductKey('Tine Helmelk 1L'), 'tine-helmelk-1l');
  });

  test('norske tegn → ascii', () => {
    assert.equal(slugifyProductKey('Brød'), 'brod');
    assert.equal(slugifyProductKey('Kjøttdeig'), 'kjottdeig');
    assert.equal(slugifyProductKey('Ål'), 'al');
  });

  test('fjerner spesial-tegn', () => {
    assert.equal(slugifyProductKey('Melk!@#%&'), 'melk');
    assert.equal(slugifyProductKey('First Price kjøttdeig 14% 400g'), 'first-price-kjottdeig-14-400g');
  });

  test('tom input → tom streng', () => {
    assert.equal(slugifyProductKey(''), '');
    assert.equal(slugifyProductKey(null), '');
    assert.equal(slugifyProductKey(undefined), '');
  });

  test('collapse gjentagende bindestreker', () => {
    assert.equal(slugifyProductKey('a  --  b'), 'a-b');
  });

  test('maks lengde 64', () => {
    const long = 'a'.repeat(100);
    assert.equal(slugifyProductKey(long).length, 64);
  });

  test('trimmer leading/trailing bindestrek', () => {
    assert.equal(slugifyProductKey('  melk  '), 'melk');
    assert.equal(slugifyProductKey('--melk--'), 'melk');
  });
});

describe('Fase F1 — pantry-resolver', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('GET /api/pantry/suggest tom query → tom array', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/pantry/suggest?q=');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.suggestions, []);
  });

  test('GET /api/pantry/suggest matcher seed-produkter', async () => {
    // seed.js legger til 84 produkter — søk på noe fra kategorien
    const r = await request(ctx.baseUrl, 'GET', '/api/pantry/suggest?q=melk');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.suggestions), 'suggestions er array');
    assert.ok(r.body.suggestions.length > 0, 'fant minst ett treff');
    // Minst ett treff skal være fra kassal/seed-katalog
    const kassalHits = r.body.suggestions.filter(s => s.source === 'kassal');
    assert.ok(kassalHits.length > 0, 'har minst ett kassal-treff for "melk"');
  });

  test('GET /api/pantry/suggest uten treff → "ny"-rad tilbudt', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/pantry/suggest?q=unzzzxxxvare');
    assert.equal(r.status, 200);
    // Skal ha en "ny"-rad nederst
    const newRows = r.body.suggestions.filter(s => s.source === 'ny');
    assert.ok(newRows.length >= 1, 'tilbyr å opprette ny vare');
    assert.equal(newRows[0].productKey, 'unzzzxxxvare');
  });

  test('suggest returnerer source-badge for hvert treff', async () => {
    const r = await request(ctx.baseUrl, 'GET', '/api/pantry/suggest?q=melk');
    assert.equal(r.status, 200);
    for (const s of r.body.suggestions) {
      assert.ok(['kassal', 'lokal', 'ny'].includes(s.source), `ugyldig source: ${s.source}`);
      assert.ok(typeof s.productKey === 'string', 'productKey er streng');
      assert.ok(typeof s.name === 'string', 'name er streng');
      assert.ok(typeof s.confidence === 'number', 'confidence er tall');
    }
  });
});

describe('Fase F1 — POST /api/pantry/add med query', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.close();
  });

  test('add med query (uten productKey) resolver server-side', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Helt ny testvare F1', qty: 2 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.resolved, 'har resolved-objekt');
    assert.equal(r.body.resolved.source, 'ny');
    assert.equal(r.body.resolved.productKey, 'helt-ny-testvare-f1');
  });

  test('add med productKey direkte slugifies for trygghet', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { productKey: 'Rar Nøkkel Med Space', qty: 1 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    // item skal ha normalisert productKey
    assert.equal(r.body.item.productKey, 'rar-nokkel-med-space');
  });

  test('add uten productKey OG query → 400', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { qty: 1 },
    });
    assert.equal(r.status, 400);
  });

  test('add og deretter suggest finner den lokalt', async () => {
    // Først legg til
    await request(ctx.baseUrl, 'POST', '/api/pantry/add', {
      body: { query: 'Unik F1 Vare Test', qty: 1 },
    });
    // Deretter søk på prefiks
    const r = await request(ctx.baseUrl, 'GET', '/api/pantry/suggest?q=unik-f1');
    assert.equal(r.status, 200);
    const found = r.body.suggestions.find(s => s.productKey === 'unik-f1-vare-test');
    assert.ok(found, 'fant nyopprettet vare i suggest-resultatet');
    assert.ok(['lokal', 'kassal'].includes(found.source), 'source er lokal eller kassal');
  });
});
