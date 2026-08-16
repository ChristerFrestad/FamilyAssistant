'use strict';

// Multi-tenant audit C1 / H3 — verify that onboarding seeds the
// per-family default data so a freshly-created family is immediately
// usable.
//
// Without this seed, a new family would have:
//   - 0 recipes  → recipe-picker is empty
//   - 0 chores   → dashboard chore-card is empty
//   - 0 consumables → no auto-add-to-shopping suggestions
//   - meal_plans pointing at family 1's recipes (orphan rows)
//
// Coverage:
//   * Onboarding response includes a seed summary in the audit-log
//   * After onboarding, repos.recipes/chores/consumables/familyProfile
//     are populated under the new family id
//   * Default meal-plan rows point at THIS family's recipes, never at
//     family 1's
//   * Cross-tenant isolation: a second family that onboards gets its
//     OWN copy and cannot see the first family's recipes

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createFreshUser(server, email) {
  const user = server.repos.auth.createUser({ email, name: email });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { userId: user.id, cookie: cookieHeader(sid) };
}

describe('Onboarding seeds per-family defaults', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
  });

  test('first onboarding seeds recipes, chores, consumables for the new family', async () => {
    const { cookie } = createFreshUser(server, 'seed-test-1@example.com');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { cookie },
      body: {
        family: { name: 'Seed Test 1' },
        user: { name: 'Owner1', category: 'adult', portionFactor: 1.0 },
      },
    });
    assert.equal(r.status, 200);
    const newFamilyId = r.body.family.id;
    assert.ok(Number.isInteger(newFamilyId) && newFamilyId > 0);

    // Verify per-family seeded counts via repos in the new family's
    // async-context.
    runWithFamily(newFamilyId, () => {
      const recipeCount = server.repos.recipes.count();
      const choreCount = server.repos.chores.getAll().length;
      const liveConsumables = server.repos.consumables.getAll();
      const consumableCount = liveConsumables.length;
      assert.ok(recipeCount > 0, `expected new family to have recipes; got ${recipeCount}`);
      assert.ok(choreCount > 0, `expected new family to have chores; got ${choreCount}`);
      assert.ok(
        consumableCount > 0,
        `expected new family to have the small staple set; got ${consumableCount}`
      );
      assert.equal(
        liveConsumables.some((c) => c.autoAdd),
        false,
        'live defaults must not auto-add branded or staple packs onto the first shopping list'
      );
      const liveLabels = liveConsumables
        .map((c) => `${c.name} ${c.packName || ''}`)
        .join(' | ')
        .toLowerCase();
      assert.equal(
        /ajax/.test(liveLabels) && /baderom|allrengj/.test(liveLabels),
        false,
        'onboarding must not insert Ajax baderom / Ajax allrengjøring as live inventory'
      );
      assert.equal(
        liveConsumables.some((c) => c.category === 'Barn' || c.category === 'Personlig pleie'),
        false,
        'onboarding must not insert baby or personal-care packs'
      );
    });
  });

  test("default meal-plan for the new family references THIS family's recipes", async () => {
    const { cookie } = createFreshUser(server, 'seed-test-2@example.com');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { cookie },
      body: {
        family: { name: 'Seed Test 2' },
        user: { name: 'Owner2', category: 'adult', portionFactor: 1.0 },
      },
    });
    assert.equal(r.status, 200);
    const newFamilyId = r.body.family.id;

    runWithFamily(newFamilyId, () => {
      // Each family gets a default 7-day plan. Every recipe_id must
      // resolve to a recipe row that belongs to THIS family.
      const plan = server.repos.mealPlans
        .getWeek(require('../server/seed').getWeekYear())
        .filter((slot) => slot.recipeId != null);
      assert.ok(plan.length > 0, 'new family should have a default meal-plan seeded');
      for (const slot of plan) {
        const recipe = server.repos.recipes.getById(slot.recipeId);
        assert.ok(
          recipe,
          `meal_plans row points at recipe_id=${slot.recipeId} which is not in this family`
        );
        assert.equal(recipe.family_id, newFamilyId);
      }
    });
  });

  test('two families onboarded back-to-back have isolated recipe catalogs', async () => {
    const userA = createFreshUser(server, 'seed-iso-a@example.com');
    const userB = createFreshUser(server, 'seed-iso-b@example.com');
    const rA = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { cookie: userA.cookie },
      body: {
        family: { name: 'Iso A' },
        user: { name: 'Anna', category: 'adult', portionFactor: 1.0 },
      },
    });
    const rB = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { cookie: userB.cookie },
      body: {
        family: { name: 'Iso B' },
        user: { name: 'Bjorn', category: 'adult', portionFactor: 1.0 },
      },
    });
    assert.equal(rA.status, 200);
    assert.equal(rB.status, 200);
    const familyA = rA.body.family.id;
    const familyB = rB.body.family.id;
    assert.notEqual(familyA, familyB);

    let recipesA;
    let recipesB;
    runWithFamily(familyA, () => {
      recipesA = server.repos.recipes
        .getAll()
        .map((r) => r.id)
        .sort((a, b) => a - b);
    });
    runWithFamily(familyB, () => {
      recipesB = server.repos.recipes
        .getAll()
        .map((r) => r.id)
        .sort((a, b) => a - b);
    });

    assert.ok(recipesA.length > 0);
    assert.ok(recipesB.length > 0);
    // No id overlap between families (confirms per-family auto-increment
    // ranges and that no INSERT OR REPLACE pattern is overwriting rows
    // across families).
    const overlap = recipesA.filter((id) => recipesB.includes(id));
    assert.deepEqual(overlap, [], `recipes leaked across families: ${overlap.join(',')}`);
  });

  test('audit-log row for the onboarding includes a seedSummary', async () => {
    const { cookie } = createFreshUser(server, 'seed-audit@example.com');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { cookie },
      body: {
        family: { name: 'Audit Test' },
        user: { name: 'Audra', category: 'adult', portionFactor: 1.0 },
      },
    });
    assert.equal(r.status, 200);
    const newFamilyId = r.body.family.id;
    const rows = server.repos._db
      .prepare(`SELECT metadata FROM audit_log WHERE family_id = ? AND entity_type = 'onboarding'`)
      .all(newFamilyId);
    assert.equal(rows.length, 1);
    const meta = JSON.parse(rows[0].metadata);
    assert.equal(meta.event, 'onboarding_completed');
    assert.ok(meta.seedSummary, 'audit metadata should contain seedSummary');
    assert.ok(meta.seedSummary.recipesInserted >= 1);
    assert.ok(meta.seedSummary.choresInserted >= 1);
    // Small generic staple set (not the old branded household dump).
    assert.ok(
      meta.seedSummary.consumablesInserted >= 1,
      `expected small staple seed; got ${meta.seedSummary.consumablesInserted}`
    );
    assert.ok(
      meta.seedSummary.consumablesInserted <= 8,
      `live seed must stay a small staple set, not the branded catalog; got ${meta.seedSummary.consumablesInserted}`
    );
  });
});
