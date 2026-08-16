'use strict';

// New-family seed policy: first weekly shopping list is the meal-plan
// grocery list, not a restock of branded household demo inventory.
//
// Drives the real seed path (seedFamilyDefaults / onboarding complete)
// then the real generate path (generateForWeek). Does not mock those
// functions and does not start past seed.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { seedFamilyDefaults } = require('../server/services/seed.service');
const { generateForWeek } = require('../server/services/shopping-list.service');
const { getWeekYear } = require('../server/seed');

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createFreshUser(server, email) {
  const user = server.repos.auth.createUser({ email, name: email });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { userId: user.id, cookie: cookieHeader(sid) };
}

function itemLabel(item) {
  return [item.ingredientName, item.ingredientNameNo, item.packName, item.name, item.productKey]
    .filter(Boolean)
    .join(' ');
}

function isAjaxHouseholdMustBuy(item) {
  const text = itemLabel(item).toLowerCase();
  const ajax = text.includes('ajax');
  const baderom = text.includes('baderom');
  const allrengjor = text.includes('allrengj');
  return (ajax && baderom) || (ajax && allrengjor);
}

function needsBuyItems(list) {
  return (list?.items || []).filter((it) => it.needsBuy);
}

describe('First-week shopping after new-family seed', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  test('seedFamilyDefaults → generateForWeek has recipe groceries, no Ajax household must-buys', () => {
    const family = server.repos.family.createFamily('First week seed family');
    const summary = seedFamilyDefaults(server.repos, family.id);
    assert.ok(summary.recipesInserted > 0, 'seed must insert recipes');
    assert.ok(summary.mealPlansSeeded > 0, 'seed must insert the default week plan');

    const weekYear = getWeekYear();
    const result = runWithFamily(family.id, () => {
      const live = server.repos.consumables.getAll();
      assert.equal(
        live.some((c) => c.autoAdd),
        false,
        'new family must not start with auto-restocking consumables'
      );
      assert.equal(
        live.some(isAjaxHouseholdMustBuy),
        false,
        'live inventory must not include Ajax baderom / Ajax allrengjøring'
      );
      assert.equal(
        live.some((c) => c.category === 'Barn' || c.category === 'Personlig pleie'),
        false,
        'new family must not start with baby or personal-care packs'
      );

      const gen = generateForWeek(server.repos, weekYear);
      const list = server.repos.shoppingLists.getActive(weekYear);
      return { gen, list, live };
    });

    assert.ok(result.gen.listId > 0);
    assert.ok(result.list, 'generateForWeek must persist an active list');

    const buy = needsBuyItems(result.list);
    const ajaxHits = buy.filter(isAjaxHouseholdMustBuy);
    assert.deepEqual(
      ajaxHits.map(itemLabel),
      [],
      'first generated list must not include Ajax baderomsspray or Ajax allrengjøring 1.5L'
    );

    const labels = buy.map(itemLabel).join(' | ').toLowerCase();
    assert.match(
      labels,
      /kyllingfilet/,
      'first list must include a dinner ingredient from the seeded meal plan (Kyllingfilet, recipe 1)'
    );
    assert.ok(
      buy.some((it) => it.sourceType === 'meal_ingredient' && it.needsBuy),
      'first list must contain needs-buy recipe ingredients'
    );
    assert.equal(
      buy.some((it) => it.sourceType === 'consumable'),
      false,
      'default staples are not auto-added; first list is groceries, not household restock'
    );
  });

  test('onboarding complete then generateForWeek is the same grocery-only first list', async () => {
    const { cookie } = createFreshUser(server, 'first-week-onboard@example.com');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { cookie },
      body: {
        family: { name: 'Onboard First Week' },
        user: { name: 'Owner', category: 'adult', portionFactor: 1.0 },
      },
    });
    assert.equal(r.status, 200);
    const familyId = r.body.family.id;
    const weekYear = getWeekYear();

    const list = runWithFamily(familyId, () => {
      generateForWeek(server.repos, weekYear);
      return server.repos.shoppingLists.getActive(weekYear);
    });

    const buy = needsBuyItems(list);
    assert.deepEqual(buy.filter(isAjaxHouseholdMustBuy).map(itemLabel), []);
    assert.match(buy.map(itemLabel).join(' | ').toLowerCase(), /kyllingfilet|laksefilet/);
  });

  test('seedFamilyDefaults does not replace or wipe existing consumable rows', () => {
    const family = server.repos.family.createFamily('Already tracking');
    runWithFamily(family.id, () => {
      server.repos.consumables.upsertMany([
        {
          name: 'Existing custom cleaner',
          category: 'Husholdning',
          depletionModel: 'fixed_interval',
          depletionRate: 21,
          depletionUnit: 'dager/flaske',
          currentQty: 2,
          unit: 'flasker',
          reorderThreshold: 1,
          autoAdd: true,
          packName: 'Ajax baderom spray 750ml',
          packSize: 1,
          packUnit: 'flaske',
          estPrice: 45,
          store: 'Kiwi',
        },
      ]);
    });

    const before = runWithFamily(family.id, () => server.repos.consumables.getAll());
    assert.equal(before.length, 1);
    assert.equal(before[0].name, 'Existing custom cleaner');
    assert.equal(before[0].currentQty, 2);
    assert.equal(before[0].autoAdd, true);

    const summary = seedFamilyDefaults(server.repos, family.id);
    assert.equal(summary.consumablesInserted, 0);

    const after = runWithFamily(family.id, () => server.repos.consumables.getAll());
    assert.equal(after.length, 1);
    assert.equal(after[0].name, 'Existing custom cleaner');
    assert.equal(after[0].packName, 'Ajax baderom spray 750ml');
    assert.equal(after[0].currentQty, 2);
    assert.equal(after[0].autoAdd, true);
    assert.equal(after[0].id, before[0].id);
  });

  test('re-running seed on a freshly seeded family does not duplicate consumables', () => {
    const family = server.repos.family.createFamily('Idempotent seed');
    const first = seedFamilyDefaults(server.repos, family.id);
    assert.ok(first.consumablesInserted >= 0);
    const countAfterFirst = runWithFamily(
      family.id,
      () => server.repos.consumables.getAll().length
    );

    const second = seedFamilyDefaults(server.repos, family.id);
    assert.equal(second.consumablesInserted, 0);
    const countAfterSecond = runWithFamily(
      family.id,
      () => server.repos.consumables.getAll().length
    );
    assert.equal(countAfterSecond, countAfterFirst);
  });
});
