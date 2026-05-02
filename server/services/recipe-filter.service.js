// @ts-check
/**
 * B7 / D7 — Facade over the three filter layers (allergy / dislike / diet).
 *
 * Orchestrates:
 *   Layer 1 (allergy): HARD filter, no override — recipe is hidden if
 *                      ONE or more members' allergies are violated.
 *   Layer 2 (dislike): SOFT filter — warnings in the response, recipe
 *                      is always shown. The UI marks which ingredients
 *                      which members dislike.
 *   Layer 3 (diet):    HARD filter WITH override — recipe is hidden if
 *                      one of the members' diet_tags hits, but
 *                    options.ignoreDietTags=true slår av dette laget
 *                    (allergies og dislikes påvirkes IKKE av override).
 *
 * Call-site API:
 *
 *   const filter = require('./services/recipe-filter.service');
 *
 *   // Single recipe
 *   const res = filter.filterRecipeForFamily(recipe, ctx, opts);
 *   // → { allergy, dislike, diet, hiddenByAllergy, hiddenByDiet,
 *   //     shownWithDislikeWarning }
 *
 *   // List of recipes
 *   const all = filter.filterRecipesForFamily(recipes, ctx, opts);
 *   // → { visible, hidden, hiddenByAllergy, hiddenByDiet,
 *   //     shownWithDislikeWarning }
 *
 * Building familyContext from repos:
 *   const ctx = filter.buildFamilyContext({
 *     familyProfile: repos.familyProfile.get(),
 *     members: repos.family.listMembers(familyId),
 *   });
 */

const allergyFilter = require('./allergy-filter.service');
const dislikeFilter = require('./dislike-filter.service');
const dietFilter = require('./diet-filter.service');

/**
 * @typedef {import('./allergy-filter.service').FamilyContext} FamilyContext
 * @typedef {import('./allergy-filter.service').FamilyMemberContext} FamilyMemberContext
 * @typedef {import('./allergy-filter.service').PerMemberAllergyResult} PerMemberAllergyResult
 * @typedef {import('./dislike-filter.service').DislikeCheckResult} DislikeCheckResult
 * @typedef {import('./diet-filter.service').DietCheckResult} DietCheckResult
 */

/**
 * @typedef {object} FilterOptions
 * @property {boolean} [ignoreDietTags] - D7 override for diet_tags only
 */

/**
 * @typedef {object} RecipeFilterResult
 * @property {object} recipe
 * @property {PerMemberAllergyResult} allergy
 * @property {DislikeCheckResult} dislike
 * @property {DietCheckResult} diet
 * @property {boolean} hiddenByAllergy
 * @property {boolean} hiddenByDiet
 * @property {boolean} shownWithDislikeWarning
 */

/**
 * Build a FamilyContext from repo data. Safe with partial input
 * (missing familyProfile or empty members both degrade gracefully).
 *
 * @param {{familyProfile?: {allergies?: string[], dislikes?: string[]},
 *          members?: FamilyMemberContext[]}} input
 * @returns {FamilyContext}
 */
function buildFamilyContext(input = {}) {
  const fp = input.familyProfile || {};
  return {
    familyAllergies: Array.isArray(fp.allergies) ? fp.allergies : [],
    familyDislikes: Array.isArray(fp.dislikes) ? fp.dislikes : [],
    members: Array.isArray(input.members)
      ? input.members.map((m) => ({
          id: m.id,
          name: m.name,
          allergies: m.allergies === undefined ? null : m.allergies,
          dislikes: m.dislikes === undefined ? null : m.dislikes,
          dietTags: Array.isArray(m.dietTags) ? m.dietTags : [],
          customDietNote: m.customDietNote ?? null,
        }))
      : [],
  };
}

/**
 * Run all three filter layers for a single recipe.
 *
 * @param {object} recipe
 * @param {FamilyContext} familyContext
 * @param {FilterOptions} [options]
 * @returns {RecipeFilterResult}
 */
function filterRecipeForFamily(recipe, familyContext, options = {}) {
  const allergy = allergyFilter.checkRecipeForFamily(recipe, familyContext);
  const dislike = dislikeFilter.checkRecipeForFamily(recipe, familyContext);
  const diet = dietFilter.checkRecipeForFamily(recipe, familyContext, options);

  const hiddenByAllergy = !allergy.safeForFamily;
  const hiddenByDiet = diet.hasDietConflicts && !diet.overrideActive;
  const shownWithDislikeWarning = dislike.hasWarnings;

  return {
    recipe,
    allergy,
    dislike,
    diet,
    hiddenByAllergy,
    hiddenByDiet,
    shownWithDislikeWarning,
  };
}

/**
 * Run all three filter layers for a list of recipes and bucket the
 * results for the UI (visible, hiddenByAllergy, hiddenByDiet, etc.).
 *
 * @param {object[]} recipes
 * @param {FamilyContext} familyContext
 * @param {FilterOptions} [options]
 * @returns {{
 *   visible: RecipeFilterResult[],
 *   hidden: RecipeFilterResult[],
 *   hiddenByAllergy: RecipeFilterResult[],
 *   hiddenByDiet: RecipeFilterResult[],
 *   shownWithDislikeWarning: RecipeFilterResult[],
 * }}
 */
function filterRecipesForFamily(recipes, familyContext, options = {}) {
  const arr = Array.isArray(recipes) ? recipes : [];
  const results = arr.map((r) => filterRecipeForFamily(r, familyContext, options));

  const hiddenByAllergy = results.filter((r) => r.hiddenByAllergy);
  const hiddenByDiet = results.filter((r) => r.hiddenByDiet && !r.hiddenByAllergy);
  // ^ exclude from hiddenByDiet bucket if also allergy-hidden; allergy wins
  const hidden = results.filter((r) => r.hiddenByAllergy || r.hiddenByDiet);
  const visible = results.filter((r) => !r.hiddenByAllergy && !r.hiddenByDiet);
  const shownWithDislikeWarning = visible.filter((r) => r.shownWithDislikeWarning);

  return {
    visible,
    hidden,
    hiddenByAllergy,
    hiddenByDiet,
    shownWithDislikeWarning,
  };
}

module.exports = {
  buildFamilyContext,
  filterRecipeForFamily,
  filterRecipesForFamily,
};
