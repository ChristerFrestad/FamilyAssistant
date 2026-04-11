// @ts-check
/**
 * Uke 9 SAF-1: Deterministisk allergi-post-filter for LLM-genererte oppskrifter.
 *
 * Denne filen er det eneste stedet i kodebasen som gir "SAFETY"-garanti mot
 * allergi-brudd. LLM-output (oppskrifter generert av Ollama/OpenAI/Anthropic)
 * er IKKE trusted — LLM-en kan hallusinere, glemme allergier i kontekst, eller
 * gi feilnavn på ingredienser. Denne filen fanger det.
 *
 * Modell:
 *   1. Operatør registrerer allergier i family_profile (liste av strenger).
 *   2. Denne servicen utvider hver allergi til en "trigger-synonym-liste"
 *      via ALLERGY_TRIGGERS (f.eks. "nøtter" → nøtt, hasselnøtt, peanøtt,
 *      mandel, valnøtt, cashew, pistasj, etc).
 *   3. For hver ingrediens i oppskriften sjekkes navnet mot trigger-listen
 *      via lowercase substring-match (enkel, deterministisk, ingen AI).
 *   4. Oppskriften får flaggene:
 *        - safeForProfile: boolean
 *        - blockedIngredients: [{ingredient, allergy, trigger}]
 *   5. Frontend viser tydelig advarsel hvis safeForProfile=false.
 *
 * Designvalg:
 *   - Ingen fuzzy matching, ingen LLM, ingen probabilistisk. Substring-match
 *     er bevisst strengt — false positives er akseptable (for mange warnings
 *     er bedre enn ett missed allergen).
 *   - Trigger-listen er konservativ: "nøtter" match-er alt som inneholder
 *     "nøt" inkludert "muskatnøtt" (trygt) og "nøttebrun" (false positive).
 *     Ved false positive kan operatør overstyre i UI.
 *   - Hver trigger-entry er en Array<string> for å tillate fler-synonymer.
 *   - Supplement-list for "skjulte" allergener (laktose i hvete-fri pasta
 *     er fortsatt laktose hvis oppskriften inneholder "parmesan").
 */

/**
 * Norske allergi-triggere. Keys er lowercase synonymer for user-input,
 * values er lister med ingredient-substrings som trigger match.
 * ALL MATCHING ER CASE-INSENSITIV.
 *
 * @type {Record<string, string[]>}
 */
const ALLERGY_TRIGGERS = {
  // Nøtter — bred kategori
  nøtter: [
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
    'pine nut',
    'pinjekjerne',
  ],
  peanøtter: ['peanøtt', 'peanott', 'peanut', 'jordnøtt', 'jordnott'],
  mandler: ['mandel', 'mandle', 'almond'],
  hasselnøtter: ['hasselnøtt', 'hasselnott', 'hazelnut'],

  // Melk / laktose
  laktose: [
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
    'krem',
    'kondensert melk',
    'myse',
    'whey',
    'kasein',
  ],
  melk: [
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
    'krem',
    'myse',
    'whey',
    'kasein',
  ],

  // Gluten
  gluten: [
    'hvete',
    'hvetemel',
    'mel', // OBS: false positive på f.eks. 'rismel'
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
    'kornblanding',
    'kjeks',
    'seitan',
    'farris',
    'tarrinne',
  ],
  hvete: ['hvete', 'hvetemel', 'semolina', 'couscous', 'bulgur', 'spelt', 'kamut', 'pasta', 'brød'],

  // Egg
  egg: ['egg', 'eggehvite', 'eggeplomme', 'eggerøre', 'omelett', 'majones'],

  // Skalldyr
  skalldyr: [
    'reke',
    'reker',
    'krabbe',
    'hummer',
    'kreps',
    'blåskjell',
    'blaskjell',
    'østers',
    'osters',
    'kamskjell',
    'akkar',
    'blekksprut',
  ],

  // Fisk
  fisk: [
    'fisk',
    'laks',
    'torsk',
    'sei',
    'tunfisk',
    'tuna',
    'makrell',
    'sild',
    'hyse',
    'kveite',
    'rødspette',
    'rodspette',
    'uer',
    'steinbit',
    'ansjos',
    'sardin',
    'kaviar',
  ],

  // Soya
  soya: ['soya', 'soyasaus', 'tofu', 'edamame', 'miso', 'tempeh'],

  // Sesam
  sesam: ['sesam', 'tahini'],

  // Sennep
  sennep: ['sennep', 'dijon', 'mustard'],

  // Selleri
  selleri: ['selleri', 'sellerirot', 'celery'],

  // Lupin
  lupin: ['lupin'],

  // Svoveldioksid / sulfitter
  sulfitter: ['sulfitt', 'sulfitter', 'vin', 'tørket frukt', 'torket frukt'],
};

/**
 * Normaliser allergi-strengen til en kanonisk nøkkel som matcher ALLERGY_TRIGGERS.
 * Fjerner bindestreker, whitespace-edges, lowercase.
 *
 * @param {string} allergy
 * @returns {string}
 */
function normalizeAllergyKey(allergy) {
  if (typeof allergy !== 'string') return '';
  return allergy.toLowerCase().trim().replace(/-/g, '').replace(/\s+/g, ' ');
}

/**
 * Bygg sammenslått trigger-liste for ALLE allergier brukeren har.
 * Returnerer en Map fra trigger-substring til hvilken allergi som genererte den.
 *
 * @param {string[]} allergies
 * @returns {Map<string, string>} trigger-substring → allergi-navn
 */
function buildTriggerMap(allergies) {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!Array.isArray(allergies)) return map;

  for (const rawAllergy of allergies) {
    const key = normalizeAllergyKey(rawAllergy);
    if (!key) continue;

    // Match alle trigger-keys som inneholder allergien (eller omvendt).
    // Dette fanger "nøtt" → ALLERGY_TRIGGERS['nøtter'], "peanøtter" → egen key.
    const foundDirect = ALLERGY_TRIGGERS[key];
    if (foundDirect) {
      for (const t of foundDirect) {
        map.set(t.toLowerCase(), rawAllergy);
      }
      continue;
    }

    // Fuzzy: hvis brukerens allergi-streng inneholder en av trigger-keys,
    // eller omvendt, bruk triggere. F.eks. "melkeprotein" → 'melk'.
    for (const [triggerKey, triggerList] of Object.entries(ALLERGY_TRIGGERS)) {
      if (key.includes(triggerKey) || triggerKey.includes(key)) {
        for (const t of triggerList) {
          map.set(t.toLowerCase(), rawAllergy);
        }
      }
    }

    // Fallback: bruk selve allergi-strengen som trigger
    map.set(key, rawAllergy);
  }

  return map;
}

/**
 * @typedef {object} BlockedIngredient
 * @property {string} ingredient - Original ingrediens-navn fra oppskriften
 * @property {string} allergy - Hvilken bruker-allergi som ble brutt
 * @property {string} trigger - Substring som matchet
 */

/**
 * @typedef {object} AllergyCheckResult
 * @property {boolean} safeForProfile
 * @property {BlockedIngredient[]} blockedIngredients
 * @property {string[]} checkedAgainst - Allergier som ble brukt i sjekken
 */

/**
 * Sjekk en oppskrift mot en bruker-profil.
 *
 * @param {{ingredients?: Array<{name?: string, ingredient?: string}>}} recipe
 * @param {{allergies?: string[]}} profile
 * @returns {AllergyCheckResult}
 */
function checkRecipe(recipe, profile) {
  const allergies = (profile?.allergies || []).filter((a) => typeof a === 'string' && a.trim());

  // Tomme allergier → alt er trygt (ingen profil = ingen beskyttelse)
  if (allergies.length === 0) {
    return { safeForProfile: true, blockedIngredients: [], checkedAgainst: [] };
  }

  const triggerMap = buildTriggerMap(allergies);

  /** @type {BlockedIngredient[]} */
  const blocked = [];
  const ingredients = recipe?.ingredients || [];

  for (const ing of ingredients) {
    const rawName = (ing && (ing.name || ing.ingredient)) || '';
    if (typeof rawName !== 'string' || !rawName.trim()) continue;
    const lower = rawName.toLowerCase();

    for (const [trigger, allergy] of triggerMap.entries()) {
      if (lower.includes(trigger)) {
        blocked.push({
          ingredient: rawName,
          allergy,
          trigger,
        });
        // Break inner — kun første match per ingrediens (unngå duplisering)
        break;
      }
    }
  }

  return {
    safeForProfile: blocked.length === 0,
    blockedIngredients: blocked,
    checkedAgainst: allergies,
  };
}

/**
 * Batch-sjekk flere oppskrifter i en omgang (f.eks. før visning av
 * recipe-suggestions i meal-planning).
 *
 * @param {Array<{ingredients?: Array<{name?: string, ingredient?: string}>}>} recipes
 * @param {{allergies?: string[]}} profile
 * @returns {Array<AllergyCheckResult>}
 */
function checkRecipes(recipes, profile) {
  if (!Array.isArray(recipes)) return [];
  return recipes.map((r) => checkRecipe(r, profile));
}

/**
 * Dekorer en oppskrift med safety-felter. Returnerer en kopi med
 * safeForProfile + blockedIngredients lagt til.
 *
 * @param {object} recipe
 * @param {{allergies?: string[]}} profile
 * @returns {object}
 */
function annotateRecipe(recipe, profile) {
  const check = checkRecipe(/** @type {any} */ (recipe), profile);
  return Object.assign({}, recipe || {}, check);
}

module.exports = {
  ALLERGY_TRIGGERS,
  normalizeAllergyKey,
  buildTriggerMap,
  checkRecipe,
  checkRecipes,
  annotateRecipe,
};
