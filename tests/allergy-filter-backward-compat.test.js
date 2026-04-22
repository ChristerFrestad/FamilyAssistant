'use strict';

// Regression guard for B7: the existing checkRecipe/annotateRecipe/
// checkRecipes API must continue to return the SAME shape and values
// for callers that haven't migrated to checkRecipeForFamily yet.
//
// Scenario: a family with family-level allergies only (no per-member
// data, which is what current deploys have pre-B7). The filter layer
// must return:
//   - safeForProfile: boolean (not safeForFamily)
//   - blockedIngredients: [{ingredient, allergy, trigger}] — NO blockedFor
//   - checkedAgainst: string[] (not effectiveAllergies)
//
// A regression here means the 4 call sites in routes.js +
// meal-planning.service.js would break silently. This test is the
// safety net.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const allergyFilter = require('../server/services/allergy-filter.service');

function recipe(...ingredients) {
  return { ingredients: ingredients.map((name) => ({ name })) };
}

// ============================================================
// Legacy checkRecipe signature preserved
// ============================================================

test('legacy checkRecipe returns { safeForProfile, blockedIngredients, checkedAgainst }', () => {
  const profile = { allergies: ['Gluten'] };
  const res = allergyFilter.checkRecipe(recipe('Hvetemel', 'Sukker'), profile);

  assert.ok('safeForProfile' in res, 'must return safeForProfile (not renamed)');
  assert.ok('blockedIngredients' in res);
  assert.ok('checkedAgainst' in res);

  // Must NOT have the new field name leaking in
  assert.equal(res.safeForFamily, undefined, 'should not expose new field name');
  assert.equal(res.effectiveAllergies, undefined, 'should not expose new field name');
});

test('legacy blockedIngredients shape: { ingredient, allergy, trigger } — NO blockedFor', () => {
  const profile = { allergies: ['Laktose'] };
  const res = allergyFilter.checkRecipe(recipe('Melk', 'Ris'), profile);

  assert.equal(res.blockedIngredients.length, 1);
  const b = res.blockedIngredients[0];
  assert.equal(b.ingredient, 'Melk');
  assert.equal(typeof b.allergy, 'string');
  assert.equal(typeof b.trigger, 'string');
  assert.equal(b.blockedFor, undefined, 'legacy API must NOT leak blockedFor field');
});

test('legacy checkedAgainst contains the passed-in allergies verbatim', () => {
  const profile = { allergies: ['Gluten', 'Laktose'] };
  const res = allergyFilter.checkRecipe(recipe('Ris'), profile);
  assert.deepEqual(res.checkedAgainst.sort(), ['Gluten', 'Laktose']);
});

// ============================================================
// Semantic equivalence: same inputs → same flag
// ============================================================

test('legacy: safeForProfile=true when no allergies match', () => {
  const res = allergyFilter.checkRecipe(recipe('Ris', 'Kylling'), { allergies: ['Nøtter'] });
  assert.equal(res.safeForProfile, true);
  assert.equal(res.blockedIngredients.length, 0);
});

test('legacy: safeForProfile=false when allergy triggered', () => {
  const res = allergyFilter.checkRecipe(recipe('Pasta'), { allergies: ['Gluten'] });
  assert.equal(res.safeForProfile, false);
});

test('legacy: empty profile.allergies → always safe', () => {
  const res = allergyFilter.checkRecipe(recipe('Alt mulig rart'), { allergies: [] });
  assert.equal(res.safeForProfile, true);
  assert.deepEqual(res.checkedAgainst, []);
});

test('legacy: missing profile → always safe (graceful)', () => {
  const res = allergyFilter.checkRecipe(recipe('Pasta'), {});
  assert.equal(res.safeForProfile, true);
});

// ============================================================
// annotateRecipe preserved shape
// ============================================================

test('legacy annotateRecipe returns original recipe + safety fields', () => {
  const original = { id: 42, name: 'Pasta carbonara', ingredients: [{ name: 'Pasta' }] };
  const res = allergyFilter.annotateRecipe(original, { allergies: ['Gluten'] });

  assert.equal(res.id, 42);
  assert.equal(res.name, 'Pasta carbonara');
  assert.equal(res.safeForProfile, false);
  assert.ok(Array.isArray(res.blockedIngredients));
});

test('legacy annotateRecipe handles null/undefined recipe gracefully', () => {
  const res = allergyFilter.annotateRecipe(null, { allergies: [] });
  assert.equal(res.safeForProfile, true);
  assert.deepEqual(res.blockedIngredients, []);
});

// ============================================================
// Equivalence: legacy vs new API on family-only input
// ============================================================

test('equivalence: checkRecipe(profile) and checkRecipeForFamily(ctx with no members) block same ingredients', () => {
  const ingredients = recipe('Hvetemel', 'Melk', 'Egg', 'Ris');
  const profile = { allergies: ['Gluten', 'Laktose'] };
  const legacy = allergyFilter.checkRecipe(ingredients, profile);

  const ctxNoMembers = { familyAllergies: profile.allergies, familyDislikes: [], members: [] };
  const modern = allergyFilter.checkRecipeForFamily(ingredients, ctxNoMembers);

  // Same set of ingredient names blocked
  const legacyNames = legacy.blockedIngredients.map((b) => b.ingredient).sort();
  const modernNames = modern.blockedIngredients.map((b) => b.ingredient).sort();
  assert.deepEqual(legacyNames, modernNames);

  // Same safety flag
  assert.equal(legacy.safeForProfile, modern.safeForFamily);
});

test('equivalence: family-level only → modern blockedFor is ["familie"]', () => {
  const ctxNoMembers = { familyAllergies: ['Gluten'], familyDislikes: [], members: [] };
  const res = allergyFilter.checkRecipeForFamily(recipe('Pasta'), ctxNoMembers);
  assert.equal(res.blockedIngredients.length, 1);
  assert.deepEqual(res.blockedIngredients[0].blockedFor, ['familie']);
});

// ============================================================
// checkRecipes (batch) backward-compat
// ============================================================

test('legacy checkRecipes returns array of legacy-shape results', () => {
  const recipes = [recipe('Pasta'), recipe('Ris'), recipe('Melk')];
  const results = allergyFilter.checkRecipes(recipes, { allergies: ['Gluten', 'Laktose'] });
  assert.equal(results.length, 3);
  assert.equal(results[0].safeForProfile, false); // pasta blocked
  assert.equal(results[1].safeForProfile, true); // ris fine
  assert.equal(results[2].safeForProfile, false); // melk blocked
  for (const r of results) {
    assert.ok('checkedAgainst' in r);
    assert.equal(r.safeForFamily, undefined, 'must not leak new field');
  }
});

// ============================================================
// Module exports surface
// ============================================================

test('module exports: legacy + new APIs both available', () => {
  const exports_ = require('../server/services/allergy-filter.service');
  // Legacy
  assert.equal(typeof exports_.checkRecipe, 'function');
  assert.equal(typeof exports_.checkRecipes, 'function');
  assert.equal(typeof exports_.annotateRecipe, 'function');
  assert.equal(typeof exports_.buildTriggerMap, 'function');
  assert.equal(typeof exports_.normalizeAllergyKey, 'function');
  assert.ok(exports_.ALLERGY_TRIGGERS);
  // New
  assert.equal(typeof exports_.checkRecipeForFamily, 'function');
  assert.equal(typeof exports_.effectiveAllergiesForMember, 'function');
});
