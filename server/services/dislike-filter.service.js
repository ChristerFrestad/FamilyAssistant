// @ts-check
/**
 * B7 / D7 layer 2 — SOFT filter for disliked ingredients.
 *
 * While allergy-filter is the safety layer (binary block, no override),
 * dislike-filter is the comfort layer: recipes with disliked ingredients
 * are ALWAYS shown, but the UI marks the ingredient with "Lise dislikes
 * mushroom".
 *
 * Fallback semantics (D6): a member with dislikes=null inherits
 * familyDislikes from family_profile. A member with dislikes=[] has
 * explicitly "no dislikes" (does not fall back).
 *
 * Matching: simple case-insensitive substring. Unlike allergy-filter we
 * do NOT use an expanded trigger-synonym map (no `ALLERGY_TRIGGERS`
 * equivalent) because dislikes are personal and the user writes them
 * verbatim. "Sopp" matches "sopp", "champignon", "skogsopp" if the user
 * writes "sopp" in the dislike list, but does NOT match "aubergine"
 * unless the user has typed "aubergine".
 *
 * Design note: dislikes and allergies can point at the same word (some
 * dislike milk WITHOUT being lactose-allergic). That is OK — they are
 * caught by different layers, and dislike-filter reports the ingredient
 * even if allergy-filter also did. The call site decides whether to
 * show them as a warning or hide the row entirely.
 */

/**
 * @typedef {import('./allergy-filter.service').FamilyMemberContext} FamilyMemberContext
 * @typedef {import('./allergy-filter.service').FamilyContext} FamilyContext
 */

/**
 * @typedef {object} DislikeWarning
 * @property {string} ingredient - Ingredient name from the recipe
 * @property {string[]} dislikedBy - Names of members who dislike this
 * @property {string[]} triggers - Dislike strings that matched
 */

/**
 * @typedef {object} DislikeCheckResult
 * @property {boolean} hasWarnings
 * @property {DislikeWarning[]} warnings
 * @property {string[]} effectiveDislikes - Union across all members
 */

function effectiveDislikesForMember(member, familyDislikes) {
  if (member.dislikes === null || member.dislikes === undefined) {
    return Array.isArray(familyDislikes) ? familyDislikes : [];
  }
  return Array.isArray(member.dislikes) ? member.dislikes : [];
}

/**
 * Check a recipe against a family context (per-member dislikes).
 * Never blocks — returns warnings only.
 *
 * @param {{ingredients?: Array<{name?: string, ingredient?: string}>}} recipe
 * @param {FamilyContext} familyContext
 * @returns {DislikeCheckResult}
 */
function checkRecipeForFamily(recipe, familyContext) {
  const fd = Array.isArray(familyContext?.familyDislikes) ? familyContext.familyDislikes : [];
  const members = Array.isArray(familyContext?.members) ? familyContext.members : [];

  const effectiveMembers =
    members.length > 0
      ? members.map((m) => ({
          name: m.name || 'Unknown',
          effective: effectiveDislikesForMember(m, fd),
        }))
      : [{ name: 'familie', effective: fd }];

  const unionDislikes = new Set();
  for (const m of effectiveMembers) {
    for (const d of m.effective) {
      if (typeof d === 'string' && d.trim()) unionDislikes.add(d.trim());
    }
  }

  /** @type {DislikeWarning[]} */
  const warnings = [];
  const ingredients = recipe?.ingredients || [];

  for (const ing of ingredients) {
    const rawName = (ing && (ing.name || ing.ingredient)) || '';
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    const lower = rawName.toLowerCase();

    const dislikedByMembers = new Set();
    const triggers = new Set();

    for (const m of effectiveMembers) {
      for (const dislike of m.effective) {
        if (typeof dislike !== 'string' || !dislike.trim()) continue;
        const d = dislike.toLowerCase().trim();
        if (lower.includes(d)) {
          dislikedByMembers.add(m.name);
          triggers.add(dislike.trim());
        }
      }
    }

    if (dislikedByMembers.size > 0) {
      warnings.push({
        ingredient: rawName,
        dislikedBy: Array.from(dislikedByMembers).sort(),
        triggers: Array.from(triggers).sort(),
      });
    }
  }

  return {
    hasWarnings: warnings.length > 0,
    warnings,
    effectiveDislikes: Array.from(unionDislikes),
  };
}

module.exports = {
  checkRecipeForFamily,
  effectiveDislikesForMember,
};
