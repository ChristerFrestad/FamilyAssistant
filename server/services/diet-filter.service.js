// @ts-check
/**
 * B7 / D7 layer 3 — HARD filter WITH override for diet_tags.
 *
 * While allergy-filter hides recipes permanently and dislike-filter only
 * warns, diet-filter hides recipes by default but can be turned off via
 * `options.ignoreDietTags=true`. The UI decides whether the toggle is on.
 *
 * Input: familyContext with `members[]` where each member has `dietTags`
 * (enum array). Diet_tags have NO fallback inheritance — it is a
 * lifestyle choice, not something the family can "set for everyone".
 *
 * Matching: each diet_tag is linked to a set of ingredient trigger
 * substrings via `DIET_TAG_TRIGGERS`. Simple substring match (same
 * technique as allergy-filter). Deliberately pragmatic — can be extended
 * later with ingredient categorisation in the DB.
 *
 * Overlap risk with allergies:
 *   diet_tag `laktosefri` triggers milk products — same as allergy
 *   `laktose`. That's OK: allergy-filter hides the recipe via layer 1,
 *   and diet-filter simultaneously reports that diet_tag was violated.
 *   The call site combines the flags and decides UI priority (allergy
 *   first).
 *
 * D7 override:
 *   When `options.ignoreDietTags=true` we return { hasDietConflicts:
 *   false, dietConflicts: [] } REGARDLESS of what the recipe contains.
 *   This is query-param driven (e.g. ?ignoreDietTags=true), not
 *   server-state — the UI remembers the toggle state.
 */

/**
 * Seed mapping from diet_tag → trigger substrings. Matches the D3 enum
 * list (13 values). The lists are conservative: prefer false positives
 * (recipe hidden incorrectly) over missed blocks (vegetarian served meat).
 *
 * Note: `diabetiker-vennlig` is INTENTIONALLY omitted — diabetes
 * requires nutritional info per recipe + per-user carb/sugar limits to
 * provide medical value. A single enum tag would give false safety.
 * Deferred to phase 2 (earliest weeks 6-10). See
 * `docs/workflow/pending-decisions.md`.
 *
 * @type {Record<string, string[]>}
 */
const DIET_TAG_TRIGGERS = Object.freeze({
  vegetarian: [
    'kjøtt',
    'kjott',
    'bacon',
    'skinke',
    'kylling',
    'biff',
    'svin',
    'storfe',
    'lam',
    'kjøttdeig',
    'kjottdeig',
    'pulled pork',
    'spekeskinke',
    'karbonadedeig',
    'pølse',
    'polse',
    'salami',
    'pepperoni',
    'kebab',
    'kalkun',
    'and',
    'fasan',
    'vilt',
    'hjort',
    'elg',
    'reinsdyr',
    'fisk',
    'laks',
    'torsk',
    'sei',
    'tunfisk',
    'makrell',
    'sild',
    'reker',
    'krabbe',
    'hummer',
    'blåskjell',
    'blaskjell',
    'scampi',
  ],
  vegan: [
    'kjøtt',
    'kjott',
    'bacon',
    'skinke',
    'kylling',
    'biff',
    'svin',
    'lam',
    'kjøttdeig',
    'kjottdeig',
    'pølse',
    'polse',
    'salami',
    'fisk',
    'laks',
    'torsk',
    'reker',
    'krabbe',
    'melk',
    'fløte',
    'flote',
    'rømme',
    'romme',
    'smør',
    'smor',
    'ost',
    'parmesan',
    'mozzarella',
    'cheddar',
    'feta',
    'yoghurt',
    'egg',
    'eggehvite',
    'eggeplomme',
    'majones',
    'honning',
    'gelatin',
  ],
  pescetarian: [
    'kjøtt',
    'kjott',
    'bacon',
    'skinke',
    'kylling',
    'biff',
    'svin',
    'storfe',
    'lam',
    'kjøttdeig',
    'kjottdeig',
    'pølse',
    'polse',
    'salami',
    'pepperoni',
    'spekeskinke',
  ],
  halal: ['svin', 'bacon', 'skinke', 'pulled pork', 'spekeskinke', 'gelatin', 'vin', 'øl', 'ol'],
  kosher: [
    'svin',
    'bacon',
    'skinke',
    'skalldyr',
    'reke',
    'krabbe',
    'hummer',
    'blåskjell',
    'blaskjell',
    'kamskjell',
    'østers',
    'osters',
    'akkar',
    'blekksprut',
  ],
  laktosefri: [
    'melk',
    'fløte',
    'flote',
    'rømme',
    'romme',
    'smør',
    'smor',
    'ost',
    'yoghurt',
    'parmesan',
    'mozzarella',
    'cheddar',
    'feta',
    'ricotta',
  ],
  glutenfri: [
    'hvete',
    'hvetemel',
    'rug',
    'bygg',
    'spelt',
    'kamut',
    'couscous',
    'semolina',
    'bulgur',
    'pasta',
    'nudler',
    'brød',
    'tortilla',
    'seitan',
  ],
  eggfri: ['egg', 'eggehvite', 'eggeplomme', 'eggerøre', 'eggerore', 'omelett', 'majones'],
  nøttefri: [
    'nøtt',
    'nott',
    'hasselnøtt',
    'hasselnott',
    'peanøtt',
    'peanott',
    'mandel',
    'mandle',
    'valnøtt',
    'valnott',
    'cashew',
    'pistasj',
    'paranøtt',
    'paranott',
    'pekannøtt',
    'pekannott',
    'macadamia',
  ],
  lavkarbo: [
    'pasta',
    'nudler',
    'ris',
    'potet',
    'brød',
    'tortilla',
    'sukker',
    'sirup',
    'honning',
    'hvete',
    'mais',
    'bønner',
    'bonner',
  ],
  lchf: [
    'pasta',
    'nudler',
    'ris',
    'potet',
    'brød',
    'tortilla',
    'sukker',
    'sirup',
    'honning',
    'hvete',
    'mais',
    'bønner',
    'bonner',
    'banan',
    'eple',
    'appelsin',
    'druer',
  ],
  keto: [
    'pasta',
    'nudler',
    'ris',
    'potet',
    'brød',
    'tortilla',
    'sukker',
    'sirup',
    'honning',
    'hvete',
    'mais',
    'bønner',
    'bonner',
    'banan',
    'eple',
    'appelsin',
    'druer',
    'melk',
    'yoghurt',
  ],
  'lav-fodmap': [
    'hvitløk',
    'hvitlok',
    'løk',
    'lok',
    'purre',
    'sjalottløk',
    'sjalottlok',
    'bønner',
    'bonner',
    'linser',
    'melk',
    'yoghurt',
    'hvete',
    'honning',
    'epler',
    'pære',
    'pare',
    'sopp',
    'blomkål',
    'blomkal',
  ],
});

/**
 * @typedef {import('./allergy-filter.service').FamilyContext} FamilyContext
 */

/**
 * @typedef {object} DietConflict
 * @property {string} ingredient - Ingredient name from the recipe
 * @property {string} dietTag - Which diet_tag was violated (e.g. "vegetarian")
 * @property {string} memberName - Which member has the diet_tag
 * @property {string} trigger - Substring that matched
 */

/**
 * @typedef {object} DietCheckResult
 * @property {boolean} hasDietConflicts - false if ignoreDietTags=true
 * @property {DietConflict[]} dietConflicts
 * @property {string[]} activeDietTags - Union across all members
 * @property {boolean} overrideActive - true if ignoreDietTags=true
 */

/**
 * Check a recipe against each member's diet_tags. Returns conflicts; the
 * caller decides whether to hide the recipe (default) or show it
 * (options.ignoreDietTags=true — D7 override toggle).
 *
 * @param {{ingredients?: Array<{name?: string, ingredient?: string}>}} recipe
 * @param {FamilyContext} familyContext
 * @param {{ignoreDietTags?: boolean}} [options]
 * @returns {DietCheckResult}
 */
function checkRecipeForFamily(recipe, familyContext, options = {}) {
  const ignoreDietTags = options.ignoreDietTags === true;
  const members = Array.isArray(familyContext?.members) ? familyContext.members : [];

  // Collect union of active diet_tags (for reporting even when override is on)
  const allTags = new Set();
  for (const m of members) {
    const tags = Array.isArray(m.dietTags) ? m.dietTags : [];
    for (const t of tags) if (typeof t === 'string' && t.trim()) allTags.add(t);
  }

  if (ignoreDietTags) {
    return {
      hasDietConflicts: false,
      dietConflicts: [],
      activeDietTags: Array.from(allTags),
      overrideActive: true,
    };
  }

  /** @type {DietConflict[]} */
  const conflicts = [];
  const ingredients = recipe?.ingredients || [];

  for (const ing of ingredients) {
    const rawName = (ing && (ing.name || ing.ingredient)) || '';
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    const lower = rawName.toLowerCase();

    // For each (member, diet_tag) combination, check if any trigger matches.
    // Record one conflict per (ingredient, memberName, dietTag) tuple so the
    // UI can attribute precisely.
    for (const m of members) {
      const memberTags = Array.isArray(m.dietTags) ? m.dietTags : [];
      for (const tag of memberTags) {
        const triggers = DIET_TAG_TRIGGERS[tag];
        if (!Array.isArray(triggers)) continue;
        for (const trigger of triggers) {
          if (lower.includes(trigger)) {
            conflicts.push({
              ingredient: rawName,
              dietTag: tag,
              memberName: m.name || 'Unknown',
              trigger,
            });
            break; // one conflict per (member, tag) per ingredient
          }
        }
      }
    }
  }

  return {
    hasDietConflicts: conflicts.length > 0,
    dietConflicts: conflicts,
    activeDietTags: Array.from(allTags),
    overrideActive: false,
  };
}

module.exports = {
  DIET_TAG_TRIGGERS,
  checkRecipeForFamily,
};
