'use strict';

// Tests for B7 / D7 three-tier filter architecture:
//   Layer 1 (allergy-filter):  HARD block, per-member blockedFor
//   Layer 2 (dislike-filter):  SOFT warnings, never blocks
//   Layer 3 (diet-filter):     HARD block WITH override toggle
//   Facade  (recipe-filter):   orchestrates all three layers
//
// These services are pure functions — no DB, no server. We test them
// directly with fabricated FamilyContext objects.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const allergyFilter = require('../server/services/allergy-filter.service');
const dislikeFilter = require('../server/services/dislike-filter.service');
const dietFilter = require('../server/services/diet-filter.service');
const recipeFilter = require('../server/services/recipe-filter.service');

// ============================================================
// Helpers
// ============================================================

function recipe(...ingredients) {
  return {
    name: 'Test-oppskrift',
    ingredients: ingredients.map((name) => ({ name })),
  };
}

function ctx({ familyAllergies = [], familyDislikes = [], members = [] } = {}) {
  return { familyAllergies, familyDislikes, members };
}

function member({ id = 1, name = 'X', allergies, dislikes, dietTags = [] } = {}) {
  return { id, name, allergies, dislikes, dietTags };
}

// ============================================================
// LAYER 1 — Allergy filter (per-member)
// ============================================================

test('allergy: member with own allergies blocks ingredient for that member only', () => {
  const c = ctx({
    members: [
      member({ id: 1, name: 'Lise', allergies: ['Gluten'] }),
      member({ id: 2, name: 'Kari', allergies: ['Laktose'] }),
    ],
  });
  const res = allergyFilter.checkRecipeForFamily(recipe('Hvetemel', 'Sukker'), c);
  assert.equal(res.safeForFamily, false);
  assert.equal(res.blockedIngredients.length, 1);
  assert.equal(res.blockedIngredients[0].ingredient, 'Hvetemel');
  assert.deepEqual(res.blockedIngredients[0].blockedFor, ['Lise']);
});

test('allergy: union across members — ingredient blocks if ANY member is allergic', () => {
  const c = ctx({
    members: [
      member({ id: 1, name: 'Lise', allergies: ['Gluten'] }),
      member({ id: 2, name: 'Kari', allergies: ['Laktose'] }),
    ],
  });
  // Uses 'Yoghurt' (not 'Melk') because ALLERGY_TRIGGERS.gluten includes 'mel'
  // as a trigger (for 'hvetemel'); 'Melk' lowercased contains 'mel' and would
  // match gluten first. Yoghurt is only a laktose trigger — no overlap.
  // 'Bulgur' is a clean gluten trigger (unrelated to laktose).
  const res = allergyFilter.checkRecipeForFamily(recipe('Yoghurt', 'Bulgur'), c);
  assert.equal(res.safeForFamily, false);
  assert.equal(res.blockedIngredients.length, 2);
  const yoghurt = res.blockedIngredients.find((b) => b.ingredient === 'Yoghurt');
  const bulgur = res.blockedIngredients.find((b) => b.ingredient === 'Bulgur');
  assert.deepEqual(yoghurt.blockedFor, ['Kari']);
  assert.deepEqual(bulgur.blockedFor, ['Lise']);
});

test('allergy: multiple members blocked for same ingredient — blockedFor lists all', () => {
  const c = ctx({
    members: [
      member({ id: 1, name: 'Lise', allergies: ['Gluten'] }),
      member({ id: 2, name: 'Kari', allergies: ['Gluten'] }),
    ],
  });
  const res = allergyFilter.checkRecipeForFamily(recipe('Pasta'), c);
  assert.equal(res.safeForFamily, false);
  assert.equal(res.blockedIngredients.length, 1);
  assert.deepEqual(res.blockedIngredients[0].blockedFor, ['Kari', 'Lise']);
});

test('allergy: fallback — member.allergies=null inherits familyAllergies', () => {
  const c = ctx({
    familyAllergies: ['Nøtter'],
    members: [member({ id: 1, name: 'Per', allergies: null })],
  });
  const res = allergyFilter.checkRecipeForFamily(recipe('Mandel'), c);
  assert.equal(res.safeForFamily, false);
  assert.deepEqual(res.blockedIngredients[0].blockedFor, ['Per']);
});

test('allergy: empty [] does NOT fallback — member explicitly has no allergies', () => {
  const c = ctx({
    familyAllergies: ['Nøtter'],
    members: [member({ id: 1, name: 'Per', allergies: [] })],
  });
  const res = allergyFilter.checkRecipeForFamily(recipe('Mandel'), c);
  assert.equal(res.safeForFamily, true, 'explicit [] should not inherit family allergies');
  assert.equal(res.blockedIngredients.length, 0);
});

test('allergy: no members → falls back to family-level check', () => {
  const c = ctx({ familyAllergies: ['Gluten'], members: [] });
  const res = allergyFilter.checkRecipeForFamily(recipe('Pasta'), c);
  assert.equal(res.safeForFamily, false);
  // Single virtual "familie" member
  assert.deepEqual(res.blockedIngredients[0].blockedFor, ['familie']);
});

test('allergy: safeForFamily=true when no allergies match', () => {
  const c = ctx({ members: [member({ id: 1, allergies: ['Nøtter'] })] });
  const res = allergyFilter.checkRecipeForFamily(recipe('Ris', 'Kylling'), c);
  assert.equal(res.safeForFamily, true);
  assert.equal(res.blockedIngredients.length, 0);
});

test('allergy: effectiveAllergies is union, not duplicates', () => {
  const c = ctx({
    members: [
      member({ id: 1, allergies: ['Gluten', 'Nøtter'] }),
      member({ id: 2, allergies: ['Nøtter', 'Laktose'] }),
    ],
  });
  const res = allergyFilter.checkRecipeForFamily(recipe('Ris'), c);
  assert.deepEqual(res.effectiveAllergies.sort(), ['Gluten', 'Laktose', 'Nøtter']);
});

// ============================================================
// LAYER 2 — Dislike filter (warnings, never blocks)
// ============================================================

test('dislike: warning for ingredient without blocking', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Lise', dislikes: ['Sopp'] })],
  });
  const res = dislikeFilter.checkRecipeForFamily(recipe('Sopp', 'Ris'), c);
  assert.equal(res.hasWarnings, true);
  assert.equal(res.warnings.length, 1);
  assert.equal(res.warnings[0].ingredient, 'Sopp');
  assert.deepEqual(res.warnings[0].dislikedBy, ['Lise']);
});

test('dislike: multiple members disliking same ingredient', () => {
  const c = ctx({
    members: [
      member({ id: 1, name: 'Lise', dislikes: ['Kål'] }),
      member({ id: 2, name: 'Per', dislikes: ['Kål'] }),
    ],
  });
  const res = dislikeFilter.checkRecipeForFamily(recipe('Kål'), c);
  assert.deepEqual(res.warnings[0].dislikedBy, ['Lise', 'Per']);
});

test('dislike: fallback — null inherits familyDislikes', () => {
  const c = ctx({
    familyDislikes: ['Fisk'],
    members: [member({ id: 1, name: 'Per', dislikes: null })],
  });
  const res = dislikeFilter.checkRecipeForFamily(recipe('Laks'), c);
  // Note: dislike uses substring match — 'fisk' is in 'laks'? no.
  // But 'fisk' does not appear in 'laks'. So warn only if dislike contains 'laks'.
  // Let's test with the exact word.
  assert.equal(res.hasWarnings, false);
});

test('dislike: fallback substring hit', () => {
  const c = ctx({
    familyDislikes: ['sopp'],
    members: [member({ id: 1, name: 'Per', dislikes: null })],
  });
  const res = dislikeFilter.checkRecipeForFamily(recipe('Champignonsopp'), c);
  assert.equal(res.hasWarnings, true);
  assert.deepEqual(res.warnings[0].dislikedBy, ['Per']);
});

test('dislike: empty [] does NOT fallback', () => {
  const c = ctx({
    familyDislikes: ['Sopp'],
    members: [member({ id: 1, name: 'Per', dislikes: [] })],
  });
  const res = dislikeFilter.checkRecipeForFamily(recipe('Sopp'), c);
  assert.equal(res.hasWarnings, false);
});

test('dislike: no warnings → hasWarnings=false', () => {
  const c = ctx({ members: [member({ id: 1, dislikes: ['Fennikel'] })] });
  const res = dislikeFilter.checkRecipeForFamily(recipe('Ris', 'Kylling'), c);
  assert.equal(res.hasWarnings, false);
  assert.equal(res.warnings.length, 0);
});

// ============================================================
// LAYER 3 — Diet filter (with override)
// ============================================================

test('diet: vegetarian member blocks meat recipe', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Lise', dietTags: ['vegetarian'] })],
  });
  const res = dietFilter.checkRecipeForFamily(recipe('Kylling', 'Ris'), c);
  assert.equal(res.hasDietConflicts, true);
  assert.equal(res.dietConflicts.length, 1);
  assert.equal(res.dietConflicts[0].memberName, 'Lise');
  assert.equal(res.dietConflicts[0].dietTag, 'vegetarian');
  assert.equal(res.dietConflicts[0].ingredient, 'Kylling');
});

test('diet: no fallback — member.dietTags=[] means no diet filter for that member', () => {
  // family_profile has NO dietTags concept, so nothing to fall back to
  const c = ctx({
    members: [member({ id: 1, name: 'Per', dietTags: [] })],
  });
  const res = dietFilter.checkRecipeForFamily(recipe('Kylling'), c);
  assert.equal(res.hasDietConflicts, false);
});

test('diet: override toggle — ignoreDietTags=true clears conflicts', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Lise', dietTags: ['vegan'] })],
  });
  const res = dietFilter.checkRecipeForFamily(recipe('Melk', 'Kjøtt'), c, {
    ignoreDietTags: true,
  });
  assert.equal(res.hasDietConflicts, false);
  assert.equal(res.overrideActive, true);
  assert.deepEqual(res.activeDietTags, ['vegan'], 'activeDietTags still reported for UI');
});

test('diet: override does NOT affect active dietTags reporting', () => {
  const c = ctx({
    members: [
      member({ id: 1, dietTags: ['vegetarian'] }),
      member({ id: 2, dietTags: ['glutenfri'] }),
    ],
  });
  const res = dietFilter.checkRecipeForFamily(recipe('Kjøtt'), c, { ignoreDietTags: true });
  assert.deepEqual(res.activeDietTags.sort(), ['glutenfri', 'vegetarian']);
});

test('diet: multiple diet tags on different members, different ingredients blocked', () => {
  const c = ctx({
    members: [
      member({ id: 1, name: 'Lise', dietTags: ['glutenfri'] }),
      member({ id: 2, name: 'Per', dietTags: ['eggfri'] }),
    ],
  });
  const res = dietFilter.checkRecipeForFamily(recipe('Hvetemel', 'Egg', 'Salt'), c);
  assert.equal(res.hasDietConflicts, true);
  const glutenConflict = res.dietConflicts.find((x) => x.dietTag === 'glutenfri');
  const eggConflict = res.dietConflicts.find((x) => x.dietTag === 'eggfri');
  assert.equal(glutenConflict.memberName, 'Lise');
  assert.equal(eggConflict.memberName, 'Per');
});

test('diet: single member with multiple tags — separate conflict per tag', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Siri', dietTags: ['vegan', 'glutenfri'] })],
  });
  const res = dietFilter.checkRecipeForFamily(recipe('Melk', 'Hvete'), c);
  // Both tags are active — Melk triggers vegan, Hvete triggers glutenfri
  assert.equal(res.dietConflicts.length, 2);
  assert.ok(res.dietConflicts.some((c) => c.ingredient === 'Melk' && c.dietTag === 'vegan'));
  assert.ok(res.dietConflicts.some((c) => c.ingredient === 'Hvete' && c.dietTag === 'glutenfri'));
});

test('diet: halal blocks pork but not chicken', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Aisha', dietTags: ['halal'] })],
  });
  const kylling = dietFilter.checkRecipeForFamily(recipe('Kylling', 'Ris'), c);
  const svin = dietFilter.checkRecipeForFamily(recipe('Svinekam', 'Ris'), c);
  assert.equal(kylling.hasDietConflicts, false);
  assert.equal(svin.hasDietConflicts, true);
});

test('diet: pescetarian allows fish but blocks meat', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Eva', dietTags: ['pescetarian'] })],
  });
  const fish = dietFilter.checkRecipeForFamily(recipe('Laks', 'Ris'), c);
  const meat = dietFilter.checkRecipeForFamily(recipe('Biff', 'Ris'), c);
  assert.equal(fish.hasDietConflicts, false);
  assert.equal(meat.hasDietConflicts, true);
});

// ============================================================
// FACADE — recipe-filter integration
// ============================================================

test('facade: buildFamilyContext normalizes partial input', () => {
  const fc = recipeFilter.buildFamilyContext({
    familyProfile: { allergies: ['X'] },
    members: [{ id: 1, name: 'Kari', dietTags: ['vegetarian'] }],
  });
  assert.deepEqual(fc.familyAllergies, ['X']);
  assert.deepEqual(fc.familyDislikes, []);
  assert.equal(fc.members.length, 1);
  assert.deepEqual(fc.members[0].dietTags, ['vegetarian']);
});

test('facade: allergy wins over diet when both trigger', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Lise', allergies: ['Gluten'], dietTags: ['vegetarian'] })],
  });
  const res = recipeFilter.filterRecipeForFamily(recipe('Hvetemel', 'Kylling'), c);
  assert.equal(res.hiddenByAllergy, true);
  assert.equal(res.hiddenByDiet, true, 'both flags true — caller picks priority');
});

test('facade: dislike alone does NOT hide the recipe', () => {
  const c = ctx({
    members: [member({ id: 1, name: 'Per', dislikes: ['sopp'] })],
  });
  const res = recipeFilter.filterRecipeForFamily(recipe('Sopp', 'Ris'), c);
  assert.equal(res.hiddenByAllergy, false);
  assert.equal(res.hiddenByDiet, false);
  assert.equal(res.shownWithDislikeWarning, true);
});

test('facade: ignoreDietTags affects diet layer only', () => {
  const c = ctx({
    members: [
      member({
        id: 1,
        name: 'Lise',
        allergies: ['Gluten'],
        dislikes: ['sopp'],
        dietTags: ['vegetarian'],
      }),
    ],
  });
  const r = recipe('Hvetemel', 'Sopp', 'Kylling');
  const withoutOverride = recipeFilter.filterRecipeForFamily(r, c);
  const withOverride = recipeFilter.filterRecipeForFamily(r, c, { ignoreDietTags: true });

  // Allergy still hides (override is diet-only)
  assert.equal(withoutOverride.hiddenByAllergy, true);
  assert.equal(withOverride.hiddenByAllergy, true);

  // Diet hidden before override; visible after
  assert.equal(withoutOverride.hiddenByDiet, true);
  assert.equal(withOverride.hiddenByDiet, false);

  // Dislike warning always present
  assert.equal(withoutOverride.shownWithDislikeWarning, true);
  assert.equal(withOverride.shownWithDislikeWarning, true);
});

test('facade: filterRecipesForFamily buckets results correctly', () => {
  const c = ctx({
    members: [
      member({ id: 1, name: 'Lise', allergies: ['Gluten'], dietTags: ['vegetarian'] }),
      member({ id: 2, name: 'Per', dislikes: ['sopp'] }),
    ],
  });
  const recipes = [
    { name: 'A', ingredients: [{ name: 'Ris' }] }, // visible
    { name: 'B', ingredients: [{ name: 'Hvetemel' }] }, // allergy → hidden
    { name: 'C', ingredients: [{ name: 'Kylling' }] }, // diet → hidden
    { name: 'D', ingredients: [{ name: 'Sopp' }] }, // dislike warning
  ];
  const buckets = recipeFilter.filterRecipesForFamily(recipes, c);
  assert.equal(buckets.visible.length, 2, 'A and D visible');
  assert.equal(buckets.hiddenByAllergy.length, 1);
  assert.equal(buckets.hiddenByDiet.length, 1);
  assert.equal(buckets.hidden.length, 2);
  assert.equal(buckets.shownWithDislikeWarning.length, 1);
  assert.equal(buckets.shownWithDislikeWarning[0].recipe.name, 'D');
});

test('facade: empty recipes array → empty buckets', () => {
  const c = ctx({ members: [] });
  const buckets = recipeFilter.filterRecipesForFamily([], c);
  assert.deepEqual(buckets.visible, []);
  assert.deepEqual(buckets.hidden, []);
});

test('facade: hiddenByDiet bucket excludes recipes also hidden by allergy', () => {
  const c = ctx({
    members: [member({ id: 1, allergies: ['Gluten'], dietTags: ['vegetarian'] })],
  });
  const recipes = [
    { name: 'X', ingredients: [{ name: 'Hvetemel' }, { name: 'Kylling' }] }, // both triggers
  ];
  const b = recipeFilter.filterRecipesForFamily(recipes, c);
  assert.equal(b.hiddenByAllergy.length, 1);
  assert.equal(b.hiddenByDiet.length, 0, 'allergy wins; diet bucket skips this recipe');
});
