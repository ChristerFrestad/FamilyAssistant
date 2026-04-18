// Family-level helpers used by meal planning and shopping-list generation.
//
// familyPortionSum(repos, familyId)
//   Returns the sum of portion_factor across the current roster
//   (family_profile_members). A roster of {adult:1.0, teen:0.75, child:0.5}
//   returns 2.25 — the effective "number of eaters".
//
// effectiveScale(repos, familyId, recipeServings, overrideTargetServings)
//   Returns the multiplier to apply to each recipe ingredient. Layers, in
//   order of precedence:
//     1. Explicit override — interpreted as "cook for N servings"; the
//        returned multiplier is override / recipeServings. Used by the UI
//        "skaler til N porsjoner"-input when a recipe is cooked for guests.
//     2. familyPortionSum / recipeServings when both are > 0.
//     3. 1 (no scaling) — applies to empty rosters or when the recipe
//        does not declare servings, so legacy seed data stays intact.

function familyPortionSum(repos, familyId) {
  if (!repos?.family?.portionSum) return 0;
  try {
    return Number(repos.family.portionSum(familyId)) || 0;
  } catch {
    return 0;
  }
}

function effectiveScale(repos, familyId, recipeServings, overrideTargetServings) {
  const servings = Number(recipeServings);
  const servingsValid = Number.isFinite(servings) && servings > 0;

  if (overrideTargetServings != null) {
    const target = Number(overrideTargetServings);
    if (Number.isFinite(target) && target > 0 && servingsValid) {
      return target / servings;
    }
  }
  if (!servingsValid) return 1;
  const sum = familyPortionSum(repos, familyId);
  if (!Number.isFinite(sum) || sum <= 0) return 1;
  return sum / servings;
}

module.exports = { familyPortionSum, effectiveScale };
