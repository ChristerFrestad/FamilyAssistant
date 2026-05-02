// Meal planning service: swap suggestions, shelf-life checks, Sunday-push generation
//
// Suggestion modes (stored in family_profile.preferences.suggestionMode):
//   - 'default'    — current behavior (altSuggestionMap order / random).
//   - 'maksimer'   — pantry-first scoring: pick recipes with the most
//                    ingredients already in stock.
//   - 'balansert'  — same as 'maksimer' but with an urgency bonus for
//                    ingredients that match pantry items near expiry.
//
// The scoring logic lives in pantry-coverage.service.js.

const { altSuggestionMap, getWeekYear } = require('../seed');
const {
  rankRecipes,
  subtractIngredientsFromInventory,
  keyForIngredient,
} = require('./pantry-coverage.service');
const recipeFilter = require('./recipe-filter.service');
const { getOptionalFamilyId } = require('../auth/family-context');
const { effectiveScale } = require('./family.service');

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

// B7 — uses the new recipe-filter service. Kept intentionally family-only
// (members not passed in) to preserve exact meal-planning behavior —
// per-member filtering will come in a later iteration alongside UI work.
// For a family with only family_profile.allergies this returns the SAME
// result as the previous annotateRecipe()-based check.
function isRecipeSafe(recipe, profile) {
  const ctx = recipeFilter.buildFamilyContext({ familyProfile: profile || {} });
  const res = recipeFilter.filterRecipeForFamily(recipe, ctx);
  return !res.hiddenByAllergy;
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

  // Pantry-first mode: expand the candidate pool to ALL recipes in the
  // same category as today's meal (if the category is known). Falls back
  // to the entire library if the category is not set or the pool is empty.
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
      // Fallback: same filter without category requirement
      pool = allRecipes.filter((r) => !currentRecipeIds.includes(r.id) && isRecipeSafe(r, profile));
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

  // Default: keep current behavior (altSuggestionMap + simple homeCount annotation).
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

  // Recipes that have not been used recently AND are safe for the profile.
  const freshSafe = all.filter((r) => !allRecent.includes(r.id) && isRecipeSafe(r, profile));
  const rask = freshSafe.filter((r) => r.category === 'rask');
  const comfort = freshSafe.filter((r) => r.category === 'comfort');
  const helg = freshSafe.filter((r) => r.category === 'helg');

  // Fallback pools (when fresh is empty) — only include safe ones.
  const allSafe = all.filter((r) => isRecipeSafe(r, profile));
  const allRask = allSafe.filter((r) => r.category === 'rask');
  const allComfort = allSafe.filter((r) => r.category === 'comfort');
  const allHelg = allSafe.filter((r) => r.category === 'helg');

  const usedIds = new Set();

  // 'default' uses random picking (unchanged behavior).
  function pickRandom(arr, fallback) {
    let src = arr.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = fallback.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = all.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) return null;
    const chosen = src[Math.floor(Math.random() * src.length)];
    usedIds.add(chosen.id);
    return chosen;
  }

  // 'maksimer'/'balansert' use pantry scoring, subtracting from a
  // "simulated" pantry between picks so the same item is not double-counted.
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
 * "What can I cook now?" — returns the top-5 recipes in a chosen
 * category, ranked by pantry coverage (and expiry bonus in 'balansert').
 *
 * Respects the user-selected mode; if mode = 'default' we fall back to
 * 'maksimer' for THIS function (the button is explicitly pantry-focused).
 *
 * Also returns `currentDayOfWeek` and `remainingDays` so the frontend can
 * let the user pick which day to plan the recipe for.
 *
 * @param {object} repos
 * @param {{ category: 'rask'|'comfort'|'helg' }} opts
 */
function generatePantryRestOfWeek(repos, { category }) {
  if (!['rask', 'comfort', 'helg'].includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  const weekYear = getWeekYear();
  const todayDow = (new Date().getDay() + 6) % 7; // ISO: Monday = 0
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
 * Aggregate ingredients that are missing (stillNeed > 0) for the rest of
 * the week based on the current meal plan. Reuses the same formula as
 * shopping-list.service.js (totalQty − inventory.qtyRemaining).
 *
 * Returns: [{ name, productKey, qty, unit, category, stillNeed }]
 */
function computeMissingForRestOfWeek(repos, weekYear) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const inventoryMap = repos.inventory.getAll();
  const productsMap = repos.products.getAllAsMap();
  const allRecipes = repos.recipes.getAll();
  const todayDow = (new Date().getDay() + 6) % 7;
  const familyId = getOptionalFamilyId();

  const totals = new Map();
  for (const slot of plan) {
    if (slot.dayOfWeek < todayDow) continue;
    if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') continue;
    const recipe = allRecipes.find((r) => r.id === slot.recipeId);
    if (!recipe) continue;
    const scale = familyId ? effectiveScale(repos, familyId, recipe.servings) : 1;
    for (const ing of recipe.ingredients || []) {
      const key = keyForIngredient(ing);
      const entry = totals.get(key) || {
        name: ing.name,
        productKey: ing.productKey || null,
        unit: ing.unit,
        qty: 0,
      };
      entry.qty += (Number(ing.qty) || 0) * scale;
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
