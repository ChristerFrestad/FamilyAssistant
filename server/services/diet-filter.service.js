// @ts-check
/**
 * B7 / D7 lag 3 — HARDT filter MED override for diet_tags.
 *
 * Mens allergy-filter skjuler oppskrifter permanent og dislike-filter
 * bare varsler, skjuler diet-filter oppskrifter default men kan slås av
 * via `options.ignoreDietTags=true`. UI bestemmer om toggelen er på.
 *
 * Input: familyContext med `members[]` hvor hvert medlem har `dietTags`
 * (enum-array). Diet_tags har INGEN fallback-arv — det er livsstil, ikke
 * noe familien kan "sette for alle".
 *
 * Matching: hver diet_tag er koblet til et sett ingredient-trigger-
 * substrings via `DIET_TAG_TRIGGERS`. Enkel substring-match (samme
 * teknikk som allergy-filter). Bevisst pragmatisk — kan utvides senere
 * med ingredient-kategorisering i DB.
 *
 * Fare for overlapp med allergier:
 *   diet_tag `laktosefri` triggerer melk-produkter — samme som allergi
 *   `laktose`. Det er OK: allergy-filter skjuler oppskriften via lag 1,
 *   og diet-filter rapporterer samtidig at diet_tag ble brutt. Call site
 *   kombinerer flaggene og bestemmer UI-prioritet (allergi først).
 *
 * D7-override:
 *   Når `options.ignoreDietTags=true` returneres { hasDietConflicts:
 *   false, dietConflicts: [] } UANSETT hva oppskriften inneholder.
 *   Dette er query-param-drevet (f.eks. ?ignoreDietTags=true), ikke
 *   server-state — UI husker toggle-tilstanden.
 */

/**
 * Seed-mapping fra diet_tag → trigger-substrings. Matcher D3 enum-liste
 * (13 verdier). Listene er konservative: heller ha false positives
 * (oppskrift skjules feil) enn missed blocks (vegetarianer får kjøtt).
 *
 * Note: `diabetiker-vennlig` er BEVISST utelatt — diabetes krever
 * næringsstoffinfo per oppskrift + per-bruker karbo/sukker-grenser for
 * å gi medisinsk nytte. Én enum-tag ville gitt falsk trygghet. Utsatt
 * til fase 2 (tidligst uke 6-10). Se `docs/workflow/pending-decisions.md`.
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
 * @property {string} ingredient - Ingrediens-navn fra oppskriften
 * @property {string} dietTag - Hvilken diet_tag ble brutt (f.eks. "vegetarian")
 * @property {string} memberName - Hvilket medlem har diet_tag
 * @property {string} trigger - Substring som matchet
 */

/**
 * @typedef {object} DietCheckResult
 * @property {boolean} hasDietConflicts - false hvis ignoreDietTags=true
 * @property {DietConflict[]} dietConflicts
 * @property {string[]} activeDietTags - Union across all members
 * @property {boolean} overrideActive - true hvis ignoreDietTags=true
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
              memberName: m.name || 'Ukjent',
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
