// Meal planning service: swap-forslag, holdbarhetsjekker, søndagspush-generering
//
// Modus for forslag (lagret i family_profile.preferences.suggestionMode):
//   - 'default'    — dagens adferd (altSuggestionMap-rekkefølge / tilfeldig).
//   - 'maksimer'   — pantry-first scoring: velger oppskrifter med flest
//                    ingredienser allerede på lager.
//   - 'balansert'  — samme som 'maksimer', men med urgency-bonus for
//                    ingredienser som matcher pantry-varer nær utløp.
//
// Scoring-logikken ligger i pantry-coverage.service.js.

const { altSuggestionMap, getWeekYear } = require('../seed');
const {
  rankRecipes,
  subtractIngredientsFromInventory,
  keyForIngredient,
} = require('./pantry-coverage.service');
const allergyFilter = require('./allergy-filter.service');

const VALID_MODES = new Set(['default', 'maksimer', 'balansert']);

function resolveMode(repos) {
  try {
    const profile = repos.familyProfile.get();
    const mode = profile?.preferences?.suggestionMode;
    return VALID_MODES.has(mode) ? mode : 'default';
  } catch {
    return 'default';
  }
}

function isRecipeSafe(recipe, profile) {
  // annotateRecipe gir { safeForProfile, blockedIngredients }
  const annotated = allergyFilter.annotateRecipe(recipe, profile || {});
  return annotated.safeForProfile !== false;
}

function getSwapSuggestions(repos, dayOfWeek, weekYear) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const currentRecipeIds = plan.map((p) => p.recipeId);
  const inventoryMap = repos.inventory.getAll();
  const allRecipes = repos.recipes.getAll();
  const profile = (() => {
    try {
      return repos.familyProfile.get();
    } catch {
      return {};
    }
  })();
  const mode = resolveMode(repos);

  // Pantry-first modus: utvid kandidatpoolen til ALLE oppskrifter i samme
  // kategori som dagens måltid (hvis kategori er kjent). Faller tilbake til
  // hele biblioteket hvis kategorien ikke er satt eller poolen er tom.
  if (mode === 'maksimer' || mode === 'balansert') {
    const currentSlot = plan.find((p) => p.dayOfWeek === dayOfWeek);
    const currentRecipe = currentSlot
      ? allRecipes.find((r) => r.id === currentSlot.recipeId)
      : null;
    const targetCategory = currentRecipe ? currentRecipe.category : null;

    let pool = allRecipes.filter(
      (r) =>
        !currentRecipeIds.includes(r.id) &&
        isRecipeSafe(r, profile) &&
        (!targetCategory || r.category === targetCategory)
    );
    if (pool.length === 0) {
      // Fallback: samme filter uten kategori-krav
      pool = allRecipes.filter(
        (r) => !currentRecipeIds.includes(r.id) && isRecipeSafe(r, profile)
      );
    }

    const ranked = rankRecipes(pool, inventoryMap, mode, 5);
    return ranked.map(({ recipe, score, ingredientsAtHome, totalIngredients, expiringUsed }) => ({
      recipeId: recipe.id,
      name: recipe.name,
      prepTime: recipe.prepTime,
      category: recipe.category,
      score,
      ingredientsAtHome,
      totalIngredients,
      expiringUsed,
      reason: buildSuggestionReason(ingredientsAtHome, totalIngredients, expiringUsed, mode),
      ingredients: recipe.ingredients,
    }));
  }

  // Default: behold dagens adferd (altSuggestionMap + enkel homeCount-annotering).
  const altIds = altSuggestionMap[dayOfWeek] || [];
  const suggestions = [];

  for (const rid of altIds) {
    if (currentRecipeIds.includes(rid)) continue;
    const recipe = allRecipes.find((r) => r.id === rid);
    if (!recipe) continue;

    let homeCount = 0;
    for (const ing of recipe.ingredients || []) {
      const key = keyForIngredient(ing);
      if (inventoryMap[key] && inventoryMap[key].qtyRemaining >= ing.qty) homeCount++;
    }

    suggestions.push({
      recipeId: recipe.id,
      name: recipe.name,
      prepTime: recipe.prepTime,
      category: recipe.category,
      ingredientsAtHome: homeCount,
      totalIngredients: recipe.ingredients.length,
      reason:
        homeCount > 0
          ? `${homeCount}/${recipe.ingredients.length} ingredienser hjemme`
          : 'Ny smak!',
      ingredients: recipe.ingredients,
    });

    if (suggestions.length >= 5) break;
  }

  return suggestions;
}

function buildSuggestionReason(atHome, total, expiringUsed, mode) {
  const base = `${atHome}/${total} ingredienser hjemme`;
  if (mode === 'balansert' && expiringUsed > 0) {
    return `${base} · bruker ${expiringUsed} utløpsnær vare`;
  }
  return atHome > 0 ? base : 'Ny smak!';
}

function checkShelfLife(repos, plan, fromDay, toDay) {
  const fromSlot = plan.find((p) => p.dayOfWeek === fromDay);
  if (!fromSlot) return { ok: true, warnings: [] };

  const recipe = repos.recipes.getById(fromSlot.recipeId);
  if (!recipe) return { ok: true, warnings: [] };

  const productsMap = repos.products.getAllAsMap();
  const warnings = [];
  const purchaseDay = 0;
  const maxDay = toDay;

  for (const ing of recipe.ingredients || []) {
    const product = productsMap[ing.productKey];
    if (!product || !product.shelfDays) continue;
    if (product.shelfDays <= maxDay - purchaseDay + 1 && product.shelfDays < 14) {
      const DAYS = [
        'mandag',
        'tirsdag',
        'onsdag',
        'torsdag',
        'fredag',
        'l\u00f8rdag',
        's\u00f8ndag',
      ];
      const latestDay = Math.min(purchaseDay + product.shelfDays - 1, 6);
      warnings.push({
        ingredient: product.productName,
        shelfDays: product.shelfDays,
        latestDay: DAYS[latestDay],
        message: `${product.productName} holder maks ${product.shelfDays} dager \u2014 senest ${DAYS[latestDay]}`,
      });
    }
  }
  return { ok: warnings.length === 0, warnings };
}

function generateSundayDraft(repos) {
  const nextWeekDate = new Date(Date.now() + 7 * 86400000);
  const nextWk = getWeekYear(nextWeekDate);
  const currentWk = getWeekYear();

  const currentPlan = repos.mealPlans.getWeek(currentWk);
  const recentIds = currentPlan.map((s) => s.recipeId);
  const history = repos.mealHistory.getRecent(28).map((h) => h.recipeId);
  const allRecent = [...new Set([...recentIds, ...history])];

  const all = repos.recipes.getAll();
  const profile = (() => {
    try {
      return repos.familyProfile.get();
    } catch {
      return {};
    }
  })();
  const mode = resolveMode(repos);

  // Oppskrifter som ikke er brukt nylig OG som er trygge for profilen.
  const freshSafe = all.filter((r) => !allRecent.includes(r.id) && isRecipeSafe(r, profile));
  const rask = freshSafe.filter((r) => r.category === 'rask');
  const comfort = freshSafe.filter((r) => r.category === 'comfort');
  const helg = freshSafe.filter((r) => r.category === 'helg');

  // Fallback-pooler (når fresh er tom) — inkluderer kun trygge.
  const allSafe = all.filter((r) => isRecipeSafe(r, profile));
  const allRask = allSafe.filter((r) => r.category === 'rask');
  const allComfort = allSafe.filter((r) => r.category === 'comfort');
  const allHelg = allSafe.filter((r) => r.category === 'helg');

  const usedIds = new Set();

  // 'default' bruker tilfeldig-plukk (uendret adferd).
  function pickRandom(arr, fallback) {
    let src = arr.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = fallback.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = all.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) return null;
    const chosen = src[Math.floor(Math.random() * src.length)];
    usedIds.add(chosen.id);
    return chosen;
  }

  // 'maksimer'/'balansert' bruker pantry-scoring, og trekker fra "simulert"
  // pantry mellom valg for å ikke dobbelt-telle samme vare.
  let simulatedPantry = repos.inventory.getAll();

  function pickPantryFirst(arr, fallback) {
    let src = arr.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = fallback.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = all.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) return null;
    const ranked = rankRecipes(src, simulatedPantry, mode, 1);
    const chosen = ranked[0]?.recipe || null;
    if (chosen) {
      usedIds.add(chosen.id);
      simulatedPantry = subtractIngredientsFromInventory(simulatedPantry, chosen);
    }
    return chosen;
  }

  const pick = mode === 'default' ? pickRandom : pickPantryFirst;

  const suggested = [
    { dayOfWeek: 0, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 1, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 2, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 3, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 4, recipeId: pick(comfort, allComfort)?.id, status: 'planned' },
    { dayOfWeek: 5, recipeId: pick(helg, allHelg)?.id, status: 'planned' },
    { dayOfWeek: 6, recipeId: pick(helg, allHelg)?.id, status: 'planned' },
  ].filter((s) => s.recipeId);

  return { weekYear: nextWk, meals: suggested };
}

/**
 * "Hva kan jeg lage nå?" — returnerer topp-5 oppskrifter i en valgt
 * kategori, rangert etter pantry-dekning (og utløps-bonus i 'balansert').
 *
 * Respekterer brukervalgt modus; hvis modus = 'default' faller vi tilbake
 * til 'maksimer' for DENNE funksjonen (knappen er eksplisitt pantry-fokusert).
 *
 * Returnerer også `currentDayOfWeek` og `remainingDays` slik at frontend
 * kan la brukeren velge hvilken dag oppskriften skal legges på.
 *
 * @param {object} repos
 * @param {{ category: 'rask'|'comfort'|'helg' }} opts
 */
function generatePantryRestOfWeek(repos, { category }) {
  if (!['rask', 'comfort', 'helg'].includes(category)) {
    throw new Error(`Ugyldig kategori: ${category}`);
  }

  const weekYear = getWeekYear();
  const todayDow = (new Date().getDay() + 6) % 7; // ISO: mandag = 0
  const plan = repos.mealPlans.getWeek(weekYear);
  const usedIds = new Set(plan.map((p) => p.recipeId).filter(Boolean));
  const remainingDays = [];
  for (let d = todayDow; d <= 6; d++) {
    const slot = plan.find((p) => p.dayOfWeek === d);
    if (!slot || slot.status === 'planned') remainingDays.push(d);
  }

  const profile = (() => {
    try {
      return repos.familyProfile.get();
    } catch {
      return {};
    }
  })();
  const allRecipes = repos.recipes.getAll();
  const pool = allRecipes.filter(
    (r) => r.category === category && !usedIds.has(r.id) && isRecipeSafe(r, profile)
  );

  const userMode = resolveMode(repos);
  const mode = userMode === 'default' ? 'maksimer' : userMode;

  const inventoryMap = repos.inventory.getAll();
  const ranked = rankRecipes(pool, inventoryMap, mode, 5);

  const suggestions = ranked.map(
    ({ recipe, score, ingredientsAtHome, totalIngredients, expiringUsed }) => ({
      recipeId: recipe.id,
      name: recipe.name,
      prepTime: recipe.prepTime,
      category: recipe.category,
      score: Math.round(score * 100) / 100,
      ingredientsAtHome,
      totalIngredients,
      expiringUsed,
      reason: buildSuggestionReason(ingredientsAtHome, totalIngredients, expiringUsed, mode),
      ingredients: recipe.ingredients,
    })
  );

  return {
    weekYear,
    category,
    mode,
    currentDayOfWeek: todayDow,
    remainingDays,
    suggestions,
  };
}

/**
 * Aggregerer ingredienser som mangler (stillNeed > 0) for resten av uka
 * basert på nåværende meal-plan. Gjenbruker samme regneformel som
 * shopping-list.service.js (totalQty − inventory.qtyRemaining).
 *
 * Returnerer: [{ name, productKey, qty, unit, category, stillNeed }]
 */
function computeMissingForRestOfWeek(repos, weekYear) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const inventoryMap = repos.inventory.getAll();
  const productsMap = repos.products.getAllAsMap();
  const allRecipes = repos.recipes.getAll();
  const todayDow = (new Date().getDay() + 6) % 7;

  const totals = new Map();
  for (const slot of plan) {
    if (slot.dayOfWeek < todayDow) continue;
    if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') continue;
    const recipe = allRecipes.find((r) => r.id === slot.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients || []) {
      const key = keyForIngredient(ing);
      const entry = totals.get(key) || {
        name: ing.name,
        productKey: ing.productKey || null,
        unit: ing.unit,
        qty: 0,
      };
      entry.qty += Number(ing.qty) || 0;
      totals.set(key, entry);
    }
  }

  const missing = [];
  for (const [key, entry] of totals) {
    const have = inventoryMap[key]?.qtyRemaining || 0;
    const stillNeed = Math.max(0, entry.qty - have);
    if (stillNeed <= 0) continue;
    const product = productsMap[key];
    missing.push({
      name: product ? product.productName : entry.name,
      productKey: entry.productKey,
      qty: stillNeed,
      unit: entry.unit,
      category: product ? product.category : 'Tørrvarer & annet',
    });
  }
  return missing;
}

module.exports = {
  getSwapSuggestions,
  checkShelfLife,
  generateSundayDraft,
  generatePantryRestOfWeek,
  computeMissingForRestOfWeek,
  resolveMode,
};
