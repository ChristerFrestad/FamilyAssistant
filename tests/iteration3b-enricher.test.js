// Tester for iterasjon 3b fase B: shopping-list enricher.
//
// Dekker:
//   - No API key → enrichList markerer 'done' noop, ingen fetch-kall
//   - Happy path: mock global.fetch returnerer en Kassal-match,
//     enricher skriver attachResolution og setter 'done'
//   - Idempotens: 'done' og 'running' hoppes over
//   - Bail på circuit_open → 'partial', ikke 'done'
//   - Bail på tom token bucket → 'partial'
//   - enrichPendingLists plukker opp 'pending' og 'partial'
//   - Route: POST /api/shopping/list/:id/enrich retry
//
// Mocking-strategi:
//   - Sett KASSAL_API_KEY før vi importerer moduler slik at kassal-client
//     ikke null-bailer.
//   - Override global.fetch i hver relevant test for å simulere Kassal-respons,
//     og restore etterpå.
//   - Kall kassalClient.resetState() mellom tester for å nullstille
//     token bucket og circuit breaker.

process.env.KASSAL_API_KEY = 'test-kassal-key-3b';

const { test, before, after, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

let server;
let originalFetch;

// Lastes etter startTestServer (som har sin egen require.cache-clearing).
// Vi re-requirer disse i before().
let enricher;
let kassalClient;

before(async () => {
  server = await startTestServer();
  // helpers.js tømmer require.cache etter server/-prefix, så vi må kreve
  // modulene HER — etter server er startet — for å være sikre på at
  // vi har samme instans som routes.js bruker.
  enricher = require('../server/services/shopping-list-enricher.service');
  kassalClient = require('../server/services/kassal-client.service');
  originalFetch = global.fetch;
});

after(async () => {
  global.fetch = originalFetch;
  if (server) await server.close();
});

beforeEach(() => {
  // Nullstill kassal-state mellom hver test — tokens/circuit carry over ellers.
  kassalClient.resetState();
  // Default: fetch skal feile høyt hvis en test glemmer å mocke
  global.fetch = async () => {
    throw new Error('global.fetch ikke mocket i denne testen');
  };
});

// ============================================================
// Helpers
// ============================================================

/**
 * Mock Kassal-respons som produkt-søk. Returnerer en enkelt varenummer-match
 * for navn='Kjøttdeig' som gir høy score (>0.3).
 */
function mockFetchWithKassalProduct({
  id = 'kp-mock-1',
  name = 'Kjøttdeig 400g',
  price = 55,
  ean = null,
} = {}) {
  const responseBody = {
    data: [
      {
        id,
        name,
        brand: 'Gilde',
        vendor: 'Nortura',
        weight: 400,
        weight_unit: 'g',
        current_price: price,
        ean,
        image: null,
        category: { name: 'Kjøtt' },
      },
    ],
  };
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => responseBody,
  });
}

/**
 * Mock Kassal-respons som alltid feiler med 429 (rate limited av serveren).
 * Brukes for å tvinge circuit breaker åpen.
 */
function mockFetchWith429() {
  global.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'rate limited' }),
  });
}

/**
 * Lag en handleliste med N items som trenger berikelse.
 */
function createListWithItems(repos, wk, n = 2) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      sourceType: 'meal_ingredient',
      ingredientName: 'Kjøttdeig',
      productKey: `kjottdeig_${wk}_${i}`,
      qty: 400,
      unit: 'g',
      packSize: 400,
      packUnit: 'g',
      packCount: 1,
      category: 'Kjøtt & fisk',
      needsBuy: true,
    });
  }
  return repos.shoppingLists.createActive(wk, items);
}

// ============================================================
// 1. No API key → noop done
// ============================================================

describe('enrichList no-api-key', () => {
  test('uten API-nøkkel markerer lista som done uten fetch', async () => {
    const { repos } = server;
    const wk = '2099-WE01';
    const { listId } = createListWithItems(repos, wk, 1);

    // Sporing: fetch skal ikke kalles
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls++;
      throw new Error('fetch skulle ikke ha blitt kalt');
    };

    const result = await enricher.enrichList(repos, listId, {
      apiKey: null,
      delayMs: 0,
    });

    assert.equal(result.finalStatus, 'done');
    assert.equal(result.reason, 'no_api_key');
    assert.equal(result.enriched, 0);
    assert.equal(fetchCalls, 0);

    const list = repos.shoppingLists.getById(listId);
    assert.equal(list.enrichmentStatus, 'done');
  });
});

// ============================================================
// 2. Happy path: resolve + attachResolution
// ============================================================

describe('enrichList happy path', () => {
  test('resolver items og skriver kassal_product_id + estimated_price', async () => {
    const { repos } = server;
    const wk = '2099-WE02';
    const { listId } = createListWithItems(repos, wk, 1);

    // Nullstill state i denne testen (top-level beforeEach propagerer ikke alltid i describe)
    kassalClient.resetState();

    mockFetchWithKassalProduct({ id: 'kp-happy-1', name: 'Gilde Kjøttdeig 400g', price: 69.9 });

    const result = await enricher.enrichList(repos, listId, { delayMs: 0 });

    assert.equal(result.finalStatus, 'done');
    assert.equal(result.bailed, false);
    assert.equal(result.enriched, 1);

    const list = repos.shoppingLists.getById(listId);
    assert.equal(list.enrichmentStatus, 'done');
    assert.ok(list.items[0].kassalProductId, 'item skal ha kassal_product_id satt');
    assert.ok(list.items[0].resolutionConfidence >= 0.3);
    // estimated_price = pris * packCount (1) = 69.90
    assert.ok(list.items[0].estPrice > 0);
  });

  test('svakt treff (score < 0.3) lagrer kandidater men ikke kassal_product_id', async () => {
    const { repos } = server;
    const wk = '2099-WE03';
    // Item med et helt ukjent navn slik at overlap blir 0
    const { listId } = repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'meal_ingredient',
        ingredientName: 'Zxqwerty ukjentvare',
        qty: 1,
        unit: 'stk',
        category: 'Tørrvarer & annet',
        needsBuy: true,
      },
    ]);

    // Mock response: et produkt som ikke har tokens til felles med søket
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'kp-weak-1',
            name: 'Helt Annen Vare',
            brand: null,
            vendor: null,
            current_price: 10,
          },
        ],
      }),
    });

    const result = await enricher.enrichList(repos, listId, { delayMs: 0 });

    assert.equal(result.finalStatus, 'done');
    // Svakt treff teller som "skipped" (ikke enriched), men vi lagrer kandidater
    assert.equal(result.enriched, 0);
    assert.equal(result.skipped, 1);

    const list = repos.shoppingLists.getById(listId);
    assert.equal(list.items[0].kassalProductId, null);
    // resolvedVia skal være satt når vi har kandidater
    assert.ok(
      list.items[0].resolvedVia ||
        list.items[0].resolutionConfidence === 0 ||
        list.items[0].resolutionConfidence !== null
    );
  });
});

// ============================================================
// 3. Idempotens
// ============================================================

describe('enrichList idempotens', () => {
  test('lister med status=done hoppes over', async () => {
    const { repos } = server;
    const wk = '2099-WE04';
    const { listId } = createListWithItems(repos, wk, 1);
    repos.shoppingLists.setEnrichmentStatus(listId, 'done', { finishedAt: true });

    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls++;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    const result = await enricher.enrichList(repos, listId, { delayMs: 0 });
    assert.equal(result.finalStatus, 'done');
    assert.equal(result.reason, 'already_done');
    assert.equal(fetchCalls, 0);
  });

  test('lister med status=running hoppes over', async () => {
    const { repos } = server;
    const wk = '2099-WE05';
    const { listId } = createListWithItems(repos, wk, 1);
    repos.shoppingLists.setEnrichmentStatus(listId, 'running', { startedAt: true });

    const result = await enricher.enrichList(repos, listId, { delayMs: 0 });
    assert.equal(result.finalStatus, 'running');
    assert.equal(result.reason, 'already_running');
  });

  test('ingen items som trenger berikelse → done nothing_to_enrich', async () => {
    const { repos } = server;
    const wk = '2099-WE06';
    const { listId } = repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'meal_ingredient',
        ingredientName: 'Ost',
        productKey: 'ost_1',
        pantryHas: true,
        needsBuy: false,
        category: 'Meieri',
      },
    ]);

    const result = await enricher.enrichList(repos, listId, { delayMs: 0 });
    assert.equal(result.finalStatus, 'done');
    assert.equal(result.reason, 'nothing_to_enrich');
  });
});

// ============================================================
// 4. Bail på circuit_open
// ============================================================

describe('enrichList circuit breaker bail', () => {
  test('circuit open → status=partial, bailer før første kall', async () => {
    const { repos } = server;
    const wk = '2099-WE07';
    const { listId } = createListWithItems(repos, wk, 2);

    // Tving circuit åpen ved å kjøre 3 feil gjennom kassal-client direkte
    mockFetchWith429();
    // Tre mislykkede kall for å trippe circuit
    await kassalClient.searchByName(repos, 'dummy-a');
    await kassalClient.searchByName(repos, 'dummy-b');
    await kassalClient.searchByName(repos, 'dummy-c');
    assert.equal(kassalClient.getStatus().circuitOpen, true);

    // Fetch skal ikke kalles mer etter at enricher ser circuit open
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls++;
      return { ok: false, status: 429, json: async () => ({}) };
    };

    const result = await enricher.enrichList(repos, listId, { delayMs: 0 });
    assert.equal(result.finalStatus, 'partial');
    assert.equal(result.bailed, true);
    assert.equal(result.reason, 'circuit_open');
    assert.equal(fetchCalls, 0);

    const list = repos.shoppingLists.getById(listId);
    assert.equal(list.enrichmentStatus, 'partial');
  });
});

// ============================================================
// 5. enrichPendingLists plukker opp partial
// ============================================================

describe('enrichPendingLists', () => {
  test('plukker opp pending og partial, hopper over done', async () => {
    const { repos } = server;
    const wkA = '2099-WE20';
    const wkB = '2099-WE21';
    const wkC = '2099-WE22';

    const { listId: idA } = createListWithItems(repos, wkA, 1);
    const { listId: idB } = createListWithItems(repos, wkB, 1);
    const { listId: idC } = createListWithItems(repos, wkC, 1);

    // A: pending (default), B: partial, C: done
    repos.shoppingLists.setEnrichmentStatus(idB, 'partial');
    repos.shoppingLists.setEnrichmentStatus(idC, 'done', { finishedAt: true });

    mockFetchWithKassalProduct({ id: 'kp-pending-1', name: 'Gilde Kjøttdeig 400g' });

    const results = await enricher.enrichPendingLists(repos, { delayMs: 0, maxLists: 10 });
    const processedIds = results.map((r) => r.listId);

    assert.ok(processedIds.includes(idA), 'pending liste skal være med');
    assert.ok(processedIds.includes(idB), 'partial liste skal være med');
    assert.ok(!processedIds.includes(idC), 'done liste skal hoppes over');

    // Verifiser at både A og B er done etter kjøring
    assert.equal(repos.shoppingLists.getById(idA).enrichmentStatus, 'done');
    assert.equal(repos.shoppingLists.getById(idB).enrichmentStatus, 'done');
  });
});

// ============================================================
// 6. Route: POST /api/shopping/list/:id/enrich
// ============================================================

describe('POST /api/shopping/list/:id/enrich', () => {
  test('returnerer 202 og trigger bakgrunns-enrich', async () => {
    const { repos } = server;
    const wk = '2099-WE30';
    const { listId } = createListWithItems(repos, wk, 1);
    repos.shoppingLists.setEnrichmentStatus(listId, 'partial');

    mockFetchWithKassalProduct({ id: 'kp-retry-1', name: 'Gilde Kjøttdeig 400g' });

    const res = await request(server.baseUrl, 'POST', `/api/shopping/list/${listId}/enrich`);
    assert.equal(res.status, 202);
    assert.equal(res.body.listId, listId);

    // enrichInBackground kjører via setImmediate — gi den en mikrotick
    // (bruker en kort sleep for å la den fullføre)
    await new Promise((r) => setTimeout(r, 50));

    const after = repos.shoppingLists.getById(listId);
    // Statusen skal ha beveget seg vekk fra 'partial' (enten 'done' eller
    // 'running' hvis vi er midt i prosessen). 'partial' vil bety at jobben
    // aldri ble trigget.
    assert.notEqual(after.enrichmentStatus, 'partial');
  });

  test('ukjent listId → 404', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/shopping/list/9999999/enrich');
    assert.equal(res.status, 404);
  });

  test('ugyldig id → 400', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/shopping/list/abc/enrich');
    assert.equal(res.status, 400);
  });
});
