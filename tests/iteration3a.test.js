// Integrasjon- og unit-tester for iterasjon 3a (Kassal-resolver grunnmur).
//
// Dekker:
//   - kassalProducts, productResolutions, kassalCache repositories
//   - kassal-client.service (token bucket, circuit breaker, cache,
//     null-fallback, stale-if-error) — Kassal mockes via global fetch
//   - product-resolver.service (EAN-path, catalog-hit, search+scoring,
//     memo via times_confirmed, svake treff returnerer candidates)
//
// Alle tester kjører uten reell nettverkstilgang. `fetch` mockes
// per-test og gjenopprettes etter.

const { test, before, after, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer } = require('./helpers');

let server;
const originalFetch = global.fetch;
const originalApiKey = process.env.KASSAL_API_KEY;

before(async () => {
  process.env.KASSAL_API_KEY = 'test-key-xxx';
  server = await startTestServer();
});

after(async () => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.KASSAL_API_KEY;
  else process.env.KASSAL_API_KEY = originalApiKey;
  if (server) await server.close();
});

// ============================================================
// Mock-hjelpere
// ============================================================

function mockFetch(handler) {
  global.fetch = async (url, init) => handler(url, init);
}

function okResponse(bodyJson) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => bodyJson,
  };
}

function errResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: `http ${status}` }),
  };
}

// Sample Kassal-respons — speiler felt-navn fra deres doc
function sampleProduct({ id = '12345', name = 'First Price Kjøttdeig 14% 400g',
  brand = 'First Price', ean = '7038010099991', price = 49.9, weight = 400,
  weightUnit = 'g', store = 'Kiwi' } = {}) {
  return {
    id, name, brand, ean,
    current_price: price,
    weight, weight_unit: weightUnit,
    store: { name: store },
    category: { name: 'Kjøtt & fisk' },
    image: 'https://kassal.app/img/12345.jpg',
  };
}

// ============================================================
// Repositories
// ============================================================

describe('kassalProducts repository', () => {
  test('upsert ny rad returnerer id og lagrer alle felt', () => {
    const { repos } = server;
    const id = repos.kassalProducts.upsert({
      kassalId: 'k-1',
      ean: '7038010000001',
      name: 'Tine Lettmelk 1L',
      brand: 'Tine',
      vendor: 'Tine SA',
      category: 'Meieri',
      packSize: 1,
      packUnit: 'l',
      imageUrl: 'https://x/1.jpg',
      lastSeenPrice: 24.9,
      lastSeenStore: 'Kiwi',
      rawJson: '{}',
      captureSource: 'lookup',
    });
    assert.ok(id > 0);
    const got = repos.kassalProducts.getById(id);
    assert.equal(got.kassal_id, 'k-1');
    assert.equal(got.brand, 'Tine');
    assert.equal(got.last_seen_price, 24.9);
    assert.ok(got.last_seen_at);
  });

  test('upsert samme kassal_id oppdaterer eksisterende rad', () => {
    const { repos } = server;
    const id1 = repos.kassalProducts.upsert({
      kassalId: 'k-2', name: 'Test vare', captureSource: 'lookup',
    });
    const id2 = repos.kassalProducts.upsert({
      kassalId: 'k-2', name: 'Test vare oppdatert',
      lastSeenPrice: 50, lastSeenStore: 'Rema',
    });
    assert.equal(id1, id2);
    const got = repos.kassalProducts.getById(id1);
    assert.equal(got.name, 'Test vare oppdatert');
    assert.equal(got.last_seen_price, 50);
  });

  test('getByEan finner rad via EAN-indeks', () => {
    const { repos } = server;
    repos.kassalProducts.upsert({
      kassalId: 'k-3', ean: '7038010000003', name: 'EAN-vare', captureSource: 'lookup',
    });
    const got = repos.kassalProducts.getByEan('7038010000003');
    assert.ok(got);
    assert.equal(got.kassal_id, 'k-3');
  });

  test('getByEan(null) returnerer null uten å krasje', () => {
    const { repos } = server;
    assert.equal(repos.kassalProducts.getByEan(null), null);
    assert.equal(repos.kassalProducts.getByEan(''), null);
  });
});

describe('productResolutions repository', () => {
  test('upsertSeen er idempotent og øker times_seen', () => {
    const { repos } = server;
    const kpId = repos.kassalProducts.upsert({
      kassalId: 'k-res-1', name: 'Res test', captureSource: 'lookup',
    });
    const id1 = repos.productResolutions.upsertSeen({
      productKey: 'res-test', kassalProductId: kpId,
      resolvedVia: 'llm_name', confidence: 0.6,
    });
    const id2 = repos.productResolutions.upsertSeen({
      productKey: 'res-test', kassalProductId: kpId,
      resolvedVia: 'llm_name', confidence: 0.7,
    });
    assert.equal(id1, id2);
    const got = repos.productResolutions.getById(id1);
    assert.equal(got.times_seen, 2);
    assert.ok(got.confidence >= 0.7);
  });

  test('incrementConfirmed øker times_confirmed og setter last_confirmed_at', () => {
    const { repos } = server;
    const kpId = repos.kassalProducts.upsert({
      kassalId: 'k-res-2', name: 'Confirm test', captureSource: 'lookup',
    });
    const id = repos.productResolutions.upsertSeen({
      productKey: 'confirm-test', kassalProductId: kpId,
      resolvedVia: 'ean', confidence: 1.0,
    });
    repos.productResolutions.incrementConfirmed(id);
    repos.productResolutions.incrementConfirmed(id);
    const got = repos.productResolutions.getById(id);
    assert.equal(got.times_confirmed, 2);
    assert.ok(got.last_confirmed_at);
  });

  test('bestForProductKey prioriterer user_locked > times_confirmed > confidence', () => {
    const { repos } = server;
    const kpA = repos.kassalProducts.upsert({ kassalId: 'k-a', name: 'A', captureSource: 'lookup' });
    const kpB = repos.kassalProducts.upsert({ kassalId: 'k-b', name: 'B', captureSource: 'lookup' });
    const kpC = repos.kassalProducts.upsert({ kassalId: 'k-c', name: 'C', captureSource: 'lookup' });

    const idA = repos.productResolutions.upsertSeen({
      productKey: 'priority-test', kassalProductId: kpA,
      resolvedVia: 'llm_name', confidence: 0.5,
    });
    repos.productResolutions.incrementConfirmed(idA);
    repos.productResolutions.incrementConfirmed(idA);  // 2 confirms

    const idB = repos.productResolutions.upsertSeen({
      productKey: 'priority-test', kassalProductId: kpB,
      resolvedVia: 'llm_name', confidence: 0.9,
    });  // 0 confirms, høy confidence

    const idC = repos.productResolutions.upsertSeen({
      productKey: 'priority-test', kassalProductId: kpC,
      resolvedVia: 'user_pick', confidence: 0.4,
    });
    repos.productResolutions.setUserLocked(idC, true);  // user_locked

    const best = repos.productResolutions.bestForProductKey('priority-test');
    assert.equal(best.kassal_product_id, kpC);  // locked vinner

    // Fjern lock — skal da velge A (2 confirms > B sin 0 confirms)
    repos.productResolutions.setUserLocked(idC, false);
    const best2 = repos.productResolutions.bestForProductKey('priority-test');
    assert.equal(best2.kassal_product_id, kpA);
  });

  test('allForProductKey returnerer topp-N sortert', () => {
    const { repos } = server;
    const kp1 = repos.kassalProducts.upsert({ kassalId: 'k-list-1', name: 'L1', captureSource: 'lookup' });
    const kp2 = repos.kassalProducts.upsert({ kassalId: 'k-list-2', name: 'L2', captureSource: 'lookup' });
    repos.productResolutions.upsertSeen({
      productKey: 'list-test', kassalProductId: kp1, resolvedVia: 'llm_name', confidence: 0.5,
    });
    repos.productResolutions.upsertSeen({
      productKey: 'list-test', kassalProductId: kp2, resolvedVia: 'llm_name', confidence: 0.8,
    });
    const list = repos.productResolutions.allForProductKey('list-test', 5);
    assert.equal(list.length, 2);
    // Høyest confidence først når ingen confirms
    assert.equal(list[0].kassalProductId, kp2);
  });
});

describe('kassalCache repository', () => {
  test('put + get returnerer fersk rad', () => {
    const { repos } = server;
    repos.kassalCache.put({
      cacheKey: 'search:melk',
      endpoint: 'search',
      responseJson: '{"data":[]}',
      ttlHours: 1,
    });
    const row = repos.kassalCache.get('search:melk');
    assert.ok(row);
    assert.equal(row.responseJson, '{"data":[]}');
    assert.ok(new Date(row.expiresAt) > new Date());
  });

  test('put med samme key oppdaterer rad (ON CONFLICT)', () => {
    const { repos } = server;
    repos.kassalCache.put({ cacheKey: 'search:ost', endpoint: 'search', responseJson: '{"a":1}', ttlHours: 1 });
    repos.kassalCache.put({ cacheKey: 'search:ost', endpoint: 'search', responseJson: '{"a":2}', ttlHours: 1 });
    const row = repos.kassalCache.get('search:ost');
    assert.equal(row.responseJson, '{"a":2}');
  });

  test('purgeExpired fjerner utløpte rader', () => {
    const { repos } = server;
    // Lag en direkte "utløpt" rad
    repos.kassalCache.put({ cacheKey: 'search:expired-x', endpoint: 'search', responseJson: '{}', ttlHours: 1 });
    // Manuelt sett expires til fortiden
    repos._db.prepare(
      `UPDATE kassal_cache SET expires_at = datetime('now','-1 hour') WHERE cache_key = ?`
    ).run('search:expired-x');
    const removed = repos.kassalCache.purgeExpired();
    assert.ok(removed >= 1);
    assert.equal(repos.kassalCache.get('search:expired-x'), null);
  });
});

// ============================================================
// kassal-client.service
// ============================================================

describe('kassal-client.service', () => {
  beforeEach(() => {
    const kc = require('../server/services/kassal-client.service');
    kc.resetState();
  });

  test('null-fallback: uten KASSAL_API_KEY returneres null umiddelbart', async () => {
    const kc = require('../server/services/kassal-client.service');
    const saved = process.env.KASSAL_API_KEY;
    delete process.env.KASSAL_API_KEY;
    try {
      mockFetch(() => { throw new Error('fetch skulle ikke kalles'); });
      const result = await kc.searchByName(server.repos, 'kjøttdeig');
      assert.equal(result, null);
    } finally {
      process.env.KASSAL_API_KEY = saved;
    }
  });

  test('searchByName henter + cacher respons', async () => {
    const kc = require('../server/services/kassal-client.service');
    let callCount = 0;
    mockFetch((url) => {
      callCount++;
      assert.ok(url.includes('/products?search='));
      return okResponse({ data: [sampleProduct()] });
    });
    const r1 = await kc.searchByName(server.repos, 'kjøttdeig');
    assert.ok(Array.isArray(r1));
    assert.equal(callCount, 1);
    // Cache hit — ingen ny fetch
    const r2 = await kc.searchByName(server.repos, 'kjøttdeig');
    assert.ok(Array.isArray(r2));
    assert.equal(callCount, 1, 'cache hit skal ikke gi nytt fetch-kall');
  });

  test('getByEan validerer EAN-format', async () => {
    const kc = require('../server/services/kassal-client.service');
    mockFetch(() => { throw new Error('skulle ikke nå fetch'); });
    assert.equal(await kc.getByEan(server.repos, null), null);
    assert.equal(await kc.getByEan(server.repos, 'abc'), null);
    assert.equal(await kc.getByEan(server.repos, '123'), null);  // for kort
  });

  test('getByEan cacher per EAN', async () => {
    const kc = require('../server/services/kassal-client.service');
    let calls = 0;
    mockFetch(() => {
      calls++;
      return okResponse({ data: sampleProduct({ id: 'k-ean-1', ean: '7038010000777' }) });
    });
    await kc.getByEan(server.repos, '7038010000777');
    await kc.getByEan(server.repos, '7038010000777');
    assert.equal(calls, 1);
  });

  test('stale-if-error: 500-respons faller tilbake til utgått cache', async () => {
    const kc = require('../server/services/kassal-client.service');
    const { repos } = server;

    // Seed utgått cache direkte
    repos.kassalCache.put({
      cacheKey: 'search:melk',
      endpoint: 'search',
      responseJson: JSON.stringify({ data: [sampleProduct({ name: 'Gammel melk' })] }),
      ttlHours: 1,
    });
    repos._db.prepare(
      `UPDATE kassal_cache SET expires_at = datetime('now','-1 hour') WHERE cache_key = ?`
    ).run('search:melk');

    mockFetch(() => errResponse(500));
    const result = await kc.searchByName(server.repos, 'melk');
    assert.ok(Array.isArray(result));
    assert.equal(result[0].name, 'Gammel melk');
  });

  test('circuit breaker åpner etter 3 påfølgende feil', async () => {
    const kc = require('../server/services/kassal-client.service');
    kc.resetState();
    mockFetch(() => errResponse(500));
    await kc.searchByName(server.repos, 'cb-test-1');
    await kc.searchByName(server.repos, 'cb-test-2');
    await kc.searchByName(server.repos, 'cb-test-3');
    const status = kc.getStatus();
    assert.equal(status.circuitOpen, true);

    // Neste kall skal ikke treffe fetch — men vi skifter mock for å bevise det
    let reached = false;
    mockFetch(() => { reached = true; return okResponse({ data: [] }); });
    await kc.searchByName(server.repos, 'cb-test-4');
    assert.equal(reached, false);
  });

  test('token bucket reduseres ved fetch', async () => {
    const kc = require('../server/services/kassal-client.service');
    kc.resetState();
    mockFetch(() => okResponse({ data: [sampleProduct({ id: 'token-test-1' })] }));
    const before = kc.getStatus().tokensAvailable;
    await kc.searchByName(server.repos, 'token-test-unique-query');
    const after = kc.getStatus().tokensAvailable;
    assert.ok(after < before);
  });
});

// ============================================================
// product-resolver.service
// ============================================================

describe('product-resolver: scoring utilities', () => {
  const resolver = require('../server/services/product-resolver.service');

  test('tokenize fjerner stop-ord og korte ord', () => {
    const t = resolver.tokenize('Tine Lettmelk 1L med låg fett');
    assert.ok(t.includes('tine'));
    assert.ok(t.includes('lettmelk'));
    assert.ok(!t.includes('og'));  // ikke stop-ord, men heller ikke i input
    assert.ok(!t.includes('1l'));  // tokens-filter fjerner korte
  });

  test('wordOverlap gir høy score ved full match', () => {
    const s = resolver.wordOverlap(['tine', 'lettmelk'], ['tine', 'lettmelk']);
    assert.equal(s, 1);
  });

  test('wordOverlap gir 0 ved null-match', () => {
    const s = resolver.wordOverlap(['kiwi', 'melk'], ['ost', 'brød']);
    assert.equal(s, 0);
  });

  test('packSizeProximity matcher 400g vs 400g eksakt', () => {
    const p = resolver.packSizeProximity(400, 'g', 400, 'g');
    assert.equal(p, 1);
  });

  test('packSizeProximity gir 0.5 for 400g vs 800g', () => {
    const p = resolver.packSizeProximity(400, 'g', 800, 'g');
    assert.equal(p, 0.5);
  });

  test('scoreCandidate favoriserer brand-match', () => {
    const a = resolver.scoreCandidate(
      { name: 'Kjøttdeig', brand: 'First Price', pack_size: 400, pack_unit: 'g' },
      { name: 'Kjøttdeig', qty: 400, unit: 'g', brandHint: 'First Price' }
    );
    const b = resolver.scoreCandidate(
      { name: 'Kjøttdeig', brand: 'Gilde', pack_size: 400, pack_unit: 'g' },
      { name: 'Kjøttdeig', qty: 400, unit: 'g', brandHint: 'First Price' }
    );
    assert.ok(a > b);
  });
});

describe('product-resolver: resolveByEan', () => {
  const resolver = require('../server/services/product-resolver.service');

  beforeEach(() => {
    const kc = require('../server/services/kassal-client.service');
    kc.resetState();
  });

  test('catalog-hit returnerer uten API-kall', async () => {
    const { repos } = server;
    repos.kassalProducts.upsert({
      kassalId: 'cat-ean-1',
      ean: '7038010111111',
      name: 'Katalog-vare',
      captureSource: 'bootstrap',
    });
    let reached = false;
    mockFetch(() => { reached = true; return okResponse({ data: {} }); });
    const result = await resolver.resolveByEan(repos, '7038010111111', { productKey: 'cat-test' });
    assert.ok(result);
    assert.equal(result.fromCatalog, true);
    assert.equal(result.confidence, 1.0);
    assert.equal(reached, false);
  });

  test('ukjent EAN henter fra Kassal og persister', async () => {
    const { repos } = server;
    mockFetch(() => okResponse({
      data: sampleProduct({ id: 'new-ean-1', ean: '7038010222222' }),
    }));
    const result = await resolver.resolveByEan(repos, '7038010222222', {
      productKey: 'ean-test-key',
      captureSource: 'receipt',
    });
    assert.ok(result);
    assert.equal(result.fromCatalog, false);
    assert.equal(result.confidence, 1.0);
    const saved = repos.kassalProducts.getByEan('7038010222222');
    assert.ok(saved);
    assert.equal(saved.capture_source, 'receipt');
    const res = repos.productResolutions.getById(result.resolutionId);
    assert.equal(res.resolved_via, 'ean');
  });
});

describe('product-resolver: resolveByLine', () => {
  const resolver = require('../server/services/product-resolver.service');

  beforeEach(() => {
    const kc = require('../server/services/kassal-client.service');
    kc.resetState();
  });

  test('navn-søk velger beste score og persister topp-3 kandidater', async () => {
    const { repos } = server;
    mockFetch(() => okResponse({
      data: [
        sampleProduct({ id: 'hit-1', name: 'First Price Kjøttdeig 14% 400g', brand: 'First Price', weight: 400, ean: '7038010333331' }),
        sampleProduct({ id: 'hit-2', name: 'Gilde Kjøttdeig 400g', brand: 'Gilde', weight: 400, ean: '7038010333332' }),
        sampleProduct({ id: 'hit-3', name: 'First Price Kjøttdeig 800g', brand: 'First Price', weight: 800, ean: '7038010333333' }),
      ],
    }));
    const result = await resolver.resolveByLine(repos, {
      name: 'Kjøttdeig',
      qty: 400,
      unit: 'g',
      brandHint: 'First Price',
      productKey: 'kjottdeig-test',
    }, { captureSource: 'receipt' });
    assert.ok(result);
    assert.equal(result.resolvedVia, 'llm_name');
    assert.ok(result.confidence > 0.3);
    assert.ok(result.candidates.length >= 1);

    // Beste skal være 400g First Price (hit-1)
    const saved = repos.kassalProducts.getByKassalId('hit-1');
    assert.ok(saved);
    assert.equal(saved.brand, 'First Price');
  });

  test('memo-path: etter confirm brukes tidligere resolution uten API-kall', async () => {
    const { repos } = server;
    // Første kall: går via search
    mockFetch(() => okResponse({
      data: [sampleProduct({ id: 'memo-1', name: 'Memo vare', ean: '7038010444441' })],
    }));
    const first = await resolver.resolveByLine(repos, {
      name: 'memo vare', productKey: 'memo-test-key',
    });
    assert.ok(first);
    // Bekreft resolutionen
    repos.productResolutions.incrementConfirmed(first.resolutionId);

    // Andre kall: skal ikke treffe fetch
    let reached = false;
    mockFetch(() => { reached = true; return okResponse({ data: [] }); });
    const second = await resolver.resolveByLine(repos, {
      name: 'memo vare', productKey: 'memo-test-key',
    });
    assert.ok(second);
    assert.equal(second.resolvedVia, 'brand_learn');
    assert.equal(reached, false);
  });

  test('svakt treff returnerer kandidater uten autoritativ match', async () => {
    const { repos } = server;
    // Kandidater som ikke deler noen ord med query
    mockFetch(() => okResponse({
      data: [
        sampleProduct({ id: 'weak-1', name: 'Helt annet produkt', brand: 'Merke' }),
      ],
    }));
    const result = await resolver.resolveByLine(repos, {
      name: 'xyz123 mystisk', productKey: 'weak-test',
    });
    assert.ok(result);
    assert.equal(result.kassalProductRowId, null);
    assert.ok(result.candidates.length >= 1);
  });

  test('ingen fetch-respons returnerer null', async () => {
    const { repos } = server;
    mockFetch(() => okResponse({ data: [] }));
    const result = await resolver.resolveByLine(repos, {
      name: 'tom-respons-test',
    });
    assert.equal(result, null);
  });

  test('resolver er null-safe når API-nøkkel mangler', async () => {
    const { repos } = server;
    const saved = process.env.KASSAL_API_KEY;
    delete process.env.KASSAL_API_KEY;
    try {
      mockFetch(() => { throw new Error('skulle ikke nå fetch'); });
      const result = await resolver.resolveByLine(repos, { name: 'null-safe-test' });
      assert.equal(result, null);
    } finally {
      process.env.KASSAL_API_KEY = saved;
    }
  });
});
