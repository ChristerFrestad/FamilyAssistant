// Integrasjons- og unit-tester for iterasjon 3b fase A
// (persistent handleliste + uke-komplett-trigger + capture-hook).
//
// Dekker:
//   - mealPlans.isWeekComplete (7 dagers matrise inkl. 'removed')
//   - shoppingLists repository (createActive, markItemBought, markItemUnpantry)
//   - shopping-list.service.generateForWeek (force/no-force, supersede)
//   - Autogenerer-hook via PUT /api/meals/status
//   - Routes: generate, list/:id, items/:id/bought, items/:id/unpantry, list/:id/done
//   - Capture-hook: markItemBought med resolutionId → times_confirmed++
//   - Capture-hook: confirmReceipt → productResolutions.incrementConfirmed

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
});

// ============================================================
// Helpers
// ============================================================

async function getCurrentWeek() {
  const r = await request(server.baseUrl, 'GET', '/api/meals/current');
  return r.body.weekYear;
}

/**
 * Sett alle 7 dager til en kjent tilstand. Default: første 5 dager = recipeId 1,
 * lørdag = 'away', søndag = 'removed'. Returnerer weekYear.
 */
function fillWeek(
  repos,
  wk,
  { recipeIds = [1, 1, 1, 1, 1], saturdayStatus = 'away', sundayStatus = 'removed' } = {}
) {
  for (let d = 0; d < 5; d++) {
    repos.mealPlans.setRecipe(wk, d, recipeIds[d] ?? 1, 'planned');
  }
  // Lørdag
  repos.mealPlans.setRecipe(wk, 5, null, saturdayStatus);
  // Søndag
  repos.mealPlans.setRecipe(wk, 6, null, sundayStatus);
}

// ============================================================
// mealPlans.isWeekComplete
// ============================================================

describe('mealPlans.isWeekComplete', () => {
  test('returnerer false hvis uken ikke eksisterer', () => {
    assert.equal(server.repos.mealPlans.isWeekComplete('2099-W01'), false);
  });

  test('returnerer false hvis noen dager ikke er avklart', async () => {
    const wk = await getCurrentWeek();
    // Sett bare 3 dager
    server.repos.mealPlans.setRecipe(wk, 0, 1, 'planned');
    server.repos.mealPlans.setRecipe(wk, 1, 1, 'planned');
    server.repos.mealPlans.setRecipe(wk, 2, 1, 'planned');
    // Resten skal default seeding ha gitt (fra ensureCurrentWeek), men noen
    // kan være recipe_id=null + status='planned' → ikke komplett.
    // Vi fyller dem manuelt med recipe_id=null + status='planned' for å være sikker.
    for (let d = 3; d < 7; d++) {
      server.repos.mealPlans.setRecipe(wk, d, null, 'planned');
    }
    assert.equal(server.repos.mealPlans.isWeekComplete(wk), false);
  });

  test('returnerer true når alle 7 dager har recipe eller away/skipped/removed', async () => {
    const wk = await getCurrentWeek();
    fillWeek(server.repos, wk); // 5 recipes + away + removed
    assert.equal(server.repos.mealPlans.isWeekComplete(wk), true);
  });

  test('godtar "removed" som valid valg', async () => {
    const wk = await getCurrentWeek();
    fillWeek(server.repos, wk, {
      saturdayStatus: 'removed',
      sundayStatus: 'removed',
    });
    assert.equal(server.repos.mealPlans.isWeekComplete(wk), true);
  });
});

// ============================================================
// shoppingLists repository
// ============================================================

describe('shoppingLists repository', () => {
  test('createActive supersede setter gammel active til superseded', () => {
    const { repos } = server;
    const wk = '2099-W40';

    // Første liste
    const first = repos.shoppingLists.createActive(
      wk,
      [
        {
          sourceType: 'extra',
          ingredientName: 'Sjokolade',
          category: 'Tørrvarer & annet',
          needsBuy: true,
        },
      ],
      { totalEstPrice: 40 }
    );
    assert.ok(first.listId > 0);
    assert.equal(first.itemCount, 1);
    assert.equal(first.needsBuyCount, 1);

    // Andre liste → første skal bli superseded
    const second = repos.shoppingLists.createActive(
      wk,
      [{ sourceType: 'extra', ingredientName: 'Melk', category: 'Meieri', needsBuy: true }],
      { totalEstPrice: 25 }
    );
    assert.ok(second.listId > first.listId);

    const active = repos.shoppingLists.getActive(wk);
    assert.equal(active.id, second.listId);

    const oldList = repos.shoppingLists.getById(first.listId);
    assert.equal(oldList.status, 'superseded');
  });

  test('markItemBought setter bought_at og needs_buy=0', () => {
    const { repos } = server;
    const wk = '2099-W41';
    const { listId } = repos.shoppingLists.createActive(wk, [
      { sourceType: 'extra', ingredientName: 'Brød', category: 'Brød & bakst', needsBuy: true },
    ]);
    const list = repos.shoppingLists.getById(listId);
    const item = list.items[0];
    repos.shoppingLists.markItemBought(item.id, 1);

    const after = repos.shoppingLists.getById(listId);
    assert.equal(after.items[0].needsBuy, false);
    assert.ok(after.items[0].boughtAt);
    assert.equal(after.items[0].boughtQty, 1);
  });

  test('markItemUnpantry flipper pantry_has=0 og needs_buy=1', () => {
    const { repos } = server;
    const wk = '2099-W42';
    const { listId } = repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'meal_ingredient',
        ingredientName: 'Ost',
        category: 'Meieri',
        pantryHas: true,
        pantryQty: 2,
        needsBuy: false,
      },
    ]);
    const list = repos.shoppingLists.getById(listId);
    const item = list.items[0];
    assert.equal(item.pantryHas, true);
    assert.equal(item.needsBuy, false);

    repos.shoppingLists.markItemUnpantry(item.id);
    const after = repos.shoppingLists.getById(listId);
    assert.equal(after.items[0].pantryHas, false);
    assert.equal(after.items[0].needsBuy, true);
  });

  test('markDone setter status="done" og confirmed_at', () => {
    const { repos } = server;
    const wk = '2099-W43';
    const { listId } = repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'extra',
        ingredientName: 'Sukker',
        category: 'Tørrvarer & annet',
        needsBuy: true,
      },
    ]);
    repos.shoppingLists.markDone(listId);
    const list = repos.shoppingLists.getById(listId);
    assert.equal(list.status, 'done');
    assert.ok(list.confirmedAt);
  });
});

// ============================================================
// shopping-list.service.generateForWeek
// ============================================================

describe('generateForWeek', () => {
  const { generateForWeek } = require('../server/services/shopping-list.service');

  test('throws WEEK_NOT_COMPLETE uten force hvis uken ikke er komplett', async () => {
    const { repos } = server;
    const wk = '2099-W50';
    // Kun en dag satt
    repos.mealPlans.setRecipe(wk, 0, 1, 'planned');

    assert.throws(
      () => generateForWeek(repos, wk, { force: false }),
      (err) => err.code === 'WEEK_NOT_COMPLETE'
    );
  });

  test('genererer og persisterer med force=true selv om uken er tom', async () => {
    const { repos } = server;
    const wk = '2099-W51';
    const result = generateForWeek(repos, wk, { force: true });
    assert.ok(result.listId > 0);
    assert.equal(result.weekYear, wk);

    const active = repos.shoppingLists.getActive(wk);
    assert.ok(active);
    assert.equal(active.status, 'active');
  });

  test('genererer uten force når uken er komplett (removed-dag tillatt)', async () => {
    const { repos } = server;
    const wk = '2099-W52';
    fillWeek(repos, wk);
    const result = generateForWeek(repos, wk, { force: false });
    assert.ok(result.listId > 0);

    // Regenerere → supersede
    const result2 = generateForWeek(repos, wk, { force: false });
    assert.ok(result2.listId > result.listId);

    const prev = repos.shoppingLists.getById(result.listId);
    assert.equal(prev.status, 'superseded');
  });
});

// ============================================================
// Routes: /api/shopping/generate + list/:id + items/bought/unpantry/done
// ============================================================

describe('Shopping routes', () => {
  test('POST /api/shopping/generate uten komplett uke → 400 WEEK_NOT_COMPLETE', async () => {
    const wk = '2080-W10';
    // Kun én dag
    server.repos.mealPlans.setRecipe(wk, 0, 1, 'planned');

    const res = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.detail, /complete/);
  });

  test('POST /api/shopping/generate med force → 200 og listId', async () => {
    const wk = '2080-W11';
    const res = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk, force: true },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.listId > 0);
    assert.equal(res.body.weekYear, wk);
  });

  test('GET /api/shopping/list/:id returnerer full liste med items', async () => {
    const wk = '2080-W12';
    fillWeek(server.repos, wk);
    const gen = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { weekYear: wk },
    });
    assert.equal(gen.status, 200);
    const res = await request(server.baseUrl, 'GET', `/api/shopping/list/${gen.body.listId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.list.id, gen.body.listId);
    assert.equal(res.body.list.status, 'active');
    assert.ok(Array.isArray(res.body.list.items));
  });

  test('GET /api/shopping/list/:id ukjent id → 404', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/shopping/list/999999');
    assert.equal(res.status, 404);
  });

  test('PUT /api/shopping/items/:id/bought oppdaterer pantry + inventory_log', async () => {
    const wk = '2080-W13';
    // Opprett en liste med et item som har product_key satt
    const { listId } = server.repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'meal_ingredient',
        ingredientName: 'Kjøttdeig',
        productKey: 'kjottdeig_400g',
        qty: 400,
        unit: 'g',
        packSize: 400,
        packUnit: 'g',
        packCount: 1,
        category: 'Kjøtt & fisk',
        needsBuy: true,
      },
    ]);
    const list = server.repos.shoppingLists.getById(listId);
    const itemId = list.items[0].id;

    const res = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: { qty: 400 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    // Item skal ha needsBuy=false, boughtAt satt
    const after = server.repos.shoppingLists.getById(listId);
    assert.equal(after.items[0].needsBuy, false);
    assert.ok(after.items[0].boughtAt);

    // Inventory_log skal ha en 'shopping_bought'-rad
    const logs = server.repos.inventoryLog.getByReason('shopping_bought', 10);
    assert.ok(logs.some((l) => l.productKey === 'kjottdeig_400g'));
  });

  test('PUT /api/shopping/items/:id/bought øker times_confirmed hvis resolutionId finnes', async () => {
    const { repos } = server;
    const wk = '2080-W14';

    // Lag en kassal_product + resolution
    const kpId = repos.kassalProducts.upsert({
      kassalId: 'kp-3b-1',
      name: 'Tine lettmelk 1L',
      ean: '7038010001111',
    });
    const resolutionId = repos.productResolutions.upsertSeen({
      productKey: 'lettmelk_1l',
      kassalProductId: kpId,
      resolvedVia: 'ean',
      confidence: 1.0,
    });

    const { listId } = repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'meal_ingredient',
        ingredientName: 'Lettmelk',
        productKey: 'lettmelk_1l',
        qty: 1,
        unit: 'l',
        packSize: 1,
        packCount: 1,
        category: 'Meieri',
        needsBuy: true,
      },
    ]);
    // Hent itemId og knytt resolution manuelt (simulerer fase B enricher)
    const list = repos.shoppingLists.getById(listId);
    const itemId = list.items[0].id;
    repos.shoppingLists.attachResolution(itemId, {
      kassalProductId: kpId,
      resolutionId,
      confidence: 1.0,
      resolvedVia: 'ean',
    });

    const before = repos.productResolutions.getById(resolutionId);
    const beforeCount = before.times_confirmed || 0;

    const res = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/bought`, {
      body: {},
    });
    assert.equal(res.status, 200);

    const afterRes = repos.productResolutions.getById(resolutionId);
    assert.equal(afterRes.times_confirmed, beforeCount + 1);
  });

  test('PUT /api/shopping/items/:id/unpantry flipper pantry_has → needs_buy', async () => {
    const { repos } = server;
    const wk = '2080-W15';
    const { listId } = repos.shoppingLists.createActive(wk, [
      {
        sourceType: 'meal_ingredient',
        ingredientName: 'Ost',
        productKey: 'ost_400g',
        category: 'Meieri',
        pantryHas: true,
        pantryQty: 2,
        needsBuy: false,
      },
    ]);
    const list = repos.shoppingLists.getById(listId);
    const itemId = list.items[0].id;

    const res = await request(server.baseUrl, 'PUT', `/api/shopping/items/${itemId}/unpantry`);
    assert.equal(res.status, 200);

    const after = repos.shoppingLists.getById(listId);
    assert.equal(after.items[0].pantryHas, false);
    assert.equal(after.items[0].needsBuy, true);
  });

  test('POST /api/shopping/list/:id/done lukker lista', async () => {
    const { repos } = server;
    const wk = '2080-W16';
    const { listId } = repos.shoppingLists.createActive(wk, [
      { sourceType: 'extra', ingredientName: 'Epler', category: 'Frukt & grønt', needsBuy: true },
    ]);
    const res = await request(server.baseUrl, 'POST', `/api/shopping/list/${listId}/done`);
    assert.equal(res.status, 200);
    const list = repos.shoppingLists.getById(listId);
    assert.equal(list.status, 'done');
  });
});

// ============================================================
// Autogenerer-hook via /api/meals/status
// ============================================================

describe('Autogenerer-hook', () => {
  test('PUT /api/meals/status autogenererer liste når uken blir komplett', async () => {
    const { repos } = server;
    const wk = '2080-W20';

    // Fyll 6 dager; siste settes via API slik at hook-et trigges
    for (let d = 0; d < 5; d++) {
      repos.mealPlans.setRecipe(wk, d, 1, 'planned');
    }
    repos.mealPlans.setRecipe(wk, 5, null, 'away');
    // Dag 6 må eksistere som rad (ellers er det ingenting å UPDATE-e).
    // Simulerer default-seeding der dag 6 har recipe_id=null + status='planned'
    repos.mealPlans.setRecipe(wk, 6, null, 'planned');
    // Ikke komplett ennå (dag 6 er planned uten recipe)
    assert.equal(repos.mealPlans.isWeekComplete(wk), false);
    assert.equal(repos.shoppingLists.getActive(wk), null);

    // Via API: sett siste dag til 'removed'
    const res = await request(server.baseUrl, 'PUT', '/api/meals/status', {
      body: { weekYear: wk, dayOfWeek: 6, status: 'removed' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.autogeneratedShoppingList, 'forventet autogeneratedShoppingList i response');

    // Aktiv liste skal nå finnes
    const active = repos.shoppingLists.getActive(wk);
    assert.ok(active);
    assert.equal(active.status, 'active');
  });

  test('Andre oppdatering etter at lista finnes kjører smart-merge', async () => {
    // Smart-merge contract (BR-003, 2026-05-03): auto-trigger no longer
    // bails out when an active list exists. Instead it merges new
    // meal-ingredients into the existing list, preserving bought rows
    // and manual rows. This test pins that contract.
    const { repos } = server;
    const wk = '2080-W21';
    for (let d = 0; d < 7; d++) {
      repos.mealPlans.setRecipe(wk, d, 1, 'planned');
    }
    const { generateForWeek } = require('../server/services/shopping-list.service');
    const first = generateForWeek(repos, wk);
    assert.ok(first.listId);

    const res = await request(server.baseUrl, 'PUT', '/api/meals/status', {
      body: { weekYear: wk, dayOfWeek: 0, status: 'skipped' },
    });
    assert.equal(res.status, 200);
    // The hook now returns the regenerated list summary instead of null.
    assert.ok(
      res.body.autogeneratedShoppingList,
      'auto-trigger should produce a fresh list via smart-merge'
    );
    assert.equal(res.body.autogeneratedShoppingList.weekYear, wk);

    // The previously-active list is superseded; a new active list takes
    // its place. Same week, new id.
    const active = repos.shoppingLists.getActive(wk);
    assert.notEqual(active.id, first.listId, 'a new active list was created');
    const prev = repos.shoppingLists.getById(first.listId);
    assert.equal(prev.status, 'superseded');
  });
});

// ============================================================
// Receipt capture-hook
// ============================================================

describe('Receipt confirmReceipt capture-hook', () => {
  test('confirmReceipt øker times_confirmed på beste resolution for product_key', () => {
    const { repos } = server;
    const { confirmReceipt } = require('../server/services/receipt.service');

    // Lag kassal_product + resolution
    const kpId = repos.kassalProducts.upsert({
      kassalId: 'kp-3b-receipt',
      name: 'Kiwi Mild Kaffe 400g',
    });
    const resolutionId = repos.productResolutions.upsertSeen({
      productKey: 'kaffe_400g',
      kassalProductId: kpId,
      resolvedVia: 'ean',
      confidence: 1.0,
    });

    // Lag en pending receipt med ett item som har product_key='kaffe_400g'
    const receiptId = repos.receipts.insert({
      filePath: '/tmp/x.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: 'sha-3b-capture-' + Date.now(),
      status: 'pending',
    });
    repos.receiptItems.insertMany(receiptId, [
      {
        lineText: 'Kiwi Mild Kaffe',
        productKey: 'kaffe_400g',
        productName: 'Kiwi Mild Kaffe 400g',
        qty: 1,
        unit: 'stk',
        unitPrice: 55,
        totalPrice: 55,
        discount: 0,
        confidence: 0.9,
      },
    ]);
    // Sett confirmed=true på item-et slik at confirmReceipt plukker det opp
    const items = repos.receiptItems.getByReceipt(receiptId);
    repos.receiptItems.updateItem(items[0].id, { confirmed: true });

    const before = repos.productResolutions.getById(resolutionId);
    const beforeCount = before.times_confirmed || 0;

    confirmReceipt(repos, receiptId);

    const after = repos.productResolutions.getById(resolutionId);
    assert.equal(
      after.times_confirmed,
      beforeCount + 1,
      'bekreftet kvittering skal øke times_confirmed'
    );
  });
});
