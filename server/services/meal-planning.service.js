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

const { altSuggestionMap, getWeekYear, recipes: seedRecipes } = require('../seed');
const { FEW_RECIPES } = require('./recipe-library/copy');

const seedRecipeById = new Map(seedRecipes.map((recipe) => [recipe.id, recipe]));
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
    if (mode === 'default' || mode === 'maksimer' || mode === 'balansert') return mode;
    // No explicit choice. Balance pantry coverage with food that expires soon.
    return 'balansert';
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

    const haveUrls = allRecipes.map((recipe) => recipe.url).filter(Boolean);
    const libraryRows =
      repos.recipeLibrary && typeof repos.recipeLibrary.listPlanningCandidates === 'function'
        ? repos.recipeLibrary.listPlanningCandidates(haveUrls, 40)
        : [];
    const libraryPool = libraryRows
      .filter((row) => !targetCategory || row.category === targetCategory)
      .map((row) => ({
        id: null,
        libraryId: row.id,
        name: row.title,
        prepTime: row.totalTimeMin ? `${row.totalTimeMin} min` : null,
        category: row.category || 'comfort',
        ingredients: row.ingredients || [],
        fromLibrary: true,
        sourceName: row.sourceName,
        url: row.canonicalUrl,
      }));
    const ranked = rankRecipes([...pool, ...libraryPool], inventoryMap, mode, 8);
    return ranked.map(({ recipe, score, ingredientsAtHome, totalIngredients, expiringUsed }) => ({
      recipeId: recipe.fromLibrary ? null : recipe.id,
      libraryId: recipe.libraryId || null,
      name: recipe.name,
      prepTime: recipe.prepTime,
      category: recipe.category,
      sourceName: recipe.sourceName || null,
      sourceLabel: recipe.sourceName ? `Fra ${recipe.sourceName}` : null,
      fromLibrary: recipe.fromLibrary === true,
      score,
      ingredientsAtHome,
      totalIngredients,
      expiringUsed,
      reason: suggestionReason(ingredientsAtHome, expiringUsed),
      ingredients: recipe.ingredients,
    }));
  }

  // Default: altSuggestionMap lists seed ids. Later families get new
  // row ids, so match the seed recipe by name.
  const altIds = altSuggestionMap[dayOfWeek] || [];
  const suggestions = [];

  for (const rid of altIds) {
    const seedRecipe = seedRecipeById.get(rid);
    const recipe = seedRecipe
      ? allRecipes.find((item) => item.name === seedRecipe.name)
      : allRecipes.find((item) => item.id === rid);
    if (!recipe || currentRecipeIds.includes(recipe.id)) continue;

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

  const activeCount = allRecipes.length;
  if ((activeCount < FEW_RECIPES || suggestions.length === 0) && repos.recipeLibrary) {
    const have = new Set(allRecipes.map((recipe) => recipe.url).filter(Boolean));
    const libraryRows = repos.recipeLibrary.listSuggestions([...have], 5);
    for (const row of libraryRows) {
      suggestions.push({
        recipeId: null,
        libraryId: row.id,
        name: row.title,
        prepTime: row.totalTimeMin ? `${row.totalTimeMin} min` : null,
        category: row.category || 'comfort',
        sourceName: row.sourceName,
        sourceLabel: `Fra ${row.sourceName}`,
        fromLibrary: true,
        ingredientsAtHome: 0,
        totalIngredients: 0,
        reason: `Fra ${row.sourceName}`,
        ingredients: [],
      });
    }
  }

  return suggestions;
}

function suggestionReason(atHome, expiringUsed) {
  if (expiringUsed > 0) return 'Går ut snart';
  if (atHome > 0) return `Bruker ${atHome} ting du har`;
  return 'Ny smak';
}

function buildSuggestionReason(atHome, _total, expiringUsed) {
  return suggestionReason(atHome, expiringUsed);
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

const WEEK_CATEGORY_PLAN = ['rask', 'rask', 'rask', 'rask', 'comfort', 'helg', 'helg'];

/**
 * Stable week index so two consecutive ISO weeks rotate by one step.
 * YYYY-WNN is zero-padded; a bad string yields 0.
 * @param {string} weekYear
 */
function weekIndex(weekYear) {
  const raw = String(weekYear || '');
  const year = Number(raw.slice(0, 4));
  const week = Number(raw.slice(6));
  if (!Number.isFinite(year) || !Number.isFinite(week)) return 0;
  return year * 53 + week;
}

function rotateList(list, shift) {
  if (list.length === 0) return list;
  const n = ((shift % list.length) + list.length) % list.length;
  return list.slice(n).concat(list.slice(0, n));
}

/**
 * Pick 7 dinner recipe ids for a week. Deterministic for the same
 * catalog + week + recent set. Prefers the category mix
 * Mon–Thu rask, Fri comfort, Sat–Sun helg, skips ids in `recentIds`
 * while alternatives remain, and never repeats a recipe inside the week.
 * Missing slots stay null (unplanned) when the catalog runs out.
 *
 * @param {Array<{id: number, category: string}>} recipes
 * @param {string} weekYear
 * @param {number[]} [recentIds]
 * @returns {Array<{dayOfWeek: number, recipeId: number|null, status: string}>}
 */
function chooseWeekRecipes(recipes, weekYear, recentIds = []) {
  const recent = new Set(recentIds.filter((id) => id != null));
  const used = new Set();
  const byCat = { rask: [], comfort: [], helg: [] };
  const sorted = [...recipes].filter((r) => r && r.id != null).sort((a, b) => a.id - b.id);
  for (const recipe of sorted) {
    if (byCat[recipe.category]) byCat[recipe.category].push(recipe);
  }
  const shift = weekIndex(weekYear);
  for (const cat of Object.keys(byCat)) {
    byCat[cat] = rotateList(byCat[cat], shift);
  }

  function take(preferred) {
    const order = [preferred, 'rask', 'comfort', 'helg'];
    for (const cat of order) {
      const fresh = (byCat[cat] || []).find((r) => !used.has(r.id) && !recent.has(r.id));
      if (fresh) {
        used.add(fresh.id);
        return fresh.id;
      }
    }
    for (const cat of order) {
      const any = (byCat[cat] || []).find((r) => !used.has(r.id));
      if (any) {
        used.add(any.id);
        return any.id;
      }
    }
    return null;
  }

  return WEEK_CATEGORY_PLAN.map((category, dayOfWeek) => ({
    dayOfWeek,
    recipeId: take(category),
    status: 'planned',
  }));
}

/**
 * Build a fresh 7-day dinner plan for a week that does not exist yet.
 * Uses the family's active recipes, skips unsafe ones, and avoids
 * dinners from the previous four weeks when the library is large enough.
 * @param {object} repos
 * @param {string} weekYear
 */
function libraryCandidates(repos, familyRecipes, profile) {
  if (!repos.recipeLibrary || typeof repos.recipeLibrary.listPlanningCandidates !== 'function') {
    return [];
  }
  const have = familyRecipes.map((recipe) => recipe.url).filter(Boolean);
  return repos.recipeLibrary
    .listPlanningCandidates(have, 400)
    .map((row) => ({
      libraryId: row.id,
      name: row.title,
      category: row.category || 'comfort',
      prepTime: row.totalTimeMin ? `${row.totalTimeMin} min` : null,
      ingredients: row.ingredients || [],
      fromLibrary: true,
      sourceName: row.sourceName,
      url: row.canonicalUrl,
    }))
    .filter((recipe) => isRecipeSafe(recipe, profile));
}

function buildVariedWeekPlan(repos, weekYear, blockedIds = [], options = {}) {
  const profile = (() => {
    try {
      return repos.familyProfile.get();
    } catch {
      return {};
    }
  })();
  const mode = resolveMode(repos);
  const rankMode = mode === 'default' ? 'balansert' : mode;
  const salt = Number(options.salt) || 0;
  const shift = weekIndex(weekYear) + salt;
  const avoidLibrary = new Set(options.avoidLibraryIds || []);
  const family = rotateList(
    (repos.recipes.getAll() || []).filter((recipe) => isRecipeSafe(recipe, profile)),
    shift
  );
  const library = rotateList(libraryCandidates(repos, family, profile), shift);
  const recent = new Set(
    repos.mealPlans && typeof repos.mealPlans.recentRecipeIds === 'function'
      ? repos.mealPlans.recentRecipeIds(weekYear, 4)
      : []
  );
  for (const id of blockedIds) recent.add(id);
  const usedFamily = new Set();
  const usedLibrary = new Set();
  let pantry = repos.inventory.getAll();

  function candidates(category, allowRecent) {
    const own = family.filter(
      (recipe) =>
        recipe.category === category &&
        !usedFamily.has(recipe.id) &&
        (allowRecent || !recent.has(recipe.id))
    );
    const shared = library.filter(
      (recipe) =>
        recipe.category === category &&
        !usedLibrary.has(recipe.libraryId) &&
        (allowRecent || !avoidLibrary.has(recipe.libraryId))
    );
    return [...own, ...shared];
  }

  function take(category) {
    let src = candidates(category, false);
    if (src.length === 0) src = candidates(category, true);
    if (src.length === 0) {
      src = [
        ...family.filter((recipe) => !usedFamily.has(recipe.id)),
        ...library.filter((recipe) => !usedLibrary.has(recipe.libraryId)),
      ];
    }
    if (src.length === 0) return null;
    const ranked = rankRecipes(src, pantry, rankMode, 1);
    const chosen = ranked[0]?.recipe;
    if (!chosen) return null;
    if (chosen.fromLibrary) {
      usedLibrary.add(chosen.libraryId);
      pantry = subtractIngredientsFromInventory(pantry, chosen);
      return { recipeId: null, libraryRecipeId: chosen.libraryId };
    }
    usedFamily.add(chosen.id);
    pantry = subtractIngredientsFromInventory(pantry, chosen);
    return { recipeId: chosen.id, libraryRecipeId: null };
  }

  return WEEK_CATEGORY_PLAN.map((category, dayOfWeek) => {
    const picked = take(category);
    return {
      dayOfWeek,
      recipeId: picked ? picked.recipeId : null,
      libraryRecipeId: picked ? picked.libraryRecipeId : null,
      status: 'planned',
    };
  });
}

const LOCKED_STATUSES = new Set(['cooked', 'away', 'skipped', 'removed']);

/**
 * Replace dinners that are still a draft. Cooked, away, skipped and
 * removed days stay. onlyAuto leaves a person's own planned choice.
 * @param {object} repos
 * @param {string} weekYear
 * @param {{ onlyAuto?: boolean }} [options]
 */
function hasDinner(row) {
  return Boolean(row && (row.recipeId != null || row.libraryRecipeId != null));
}

function regenerateUnlockedDays(repos, weekYear, { fillEmptyOnly = false } = {}) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const targets = [];
  for (let day = 0; day < 7; day += 1) {
    const row = plan.find((slot) => slot.dayOfWeek === day);
    const locked = row && LOCKED_STATUSES.has(row.status);
    const manual = row && row.planOrigin === 'manual';
    if (locked || manual) continue;
    if (fillEmptyOnly && hasDinner(row)) continue;
    targets.push(day);
  }
  if (targets.length === 0) return plan;

  const avoidIds = [];
  const avoidLibraryIds = [];
  for (const day of targets) {
    const row = plan.find((slot) => slot.dayOfWeek === day);
    if (row && row.recipeId != null) avoidIds.push(row.recipeId);
    if (row && row.libraryRecipeId != null) avoidLibraryIds.push(row.libraryRecipeId);
  }
  const picks = buildVariedWeekPlan(repos, weekYear, avoidIds, {
    avoidLibraryIds,
    salt: Date.now() % 100000,
  });
  const write = () => {
    for (const day of targets) {
      const chosen = picks.find((slot) => slot.dayOfWeek === day);
      if (!chosen || (chosen.recipeId == null && chosen.libraryRecipeId == null)) continue;
      if (chosen.libraryRecipeId != null && chosen.recipeId == null) {
        repos.mealPlans.setLibraryRecipe(weekYear, day, chosen.libraryRecipeId, 'planned', 'auto');
      } else {
        repos.mealPlans.setRecipe(weekYear, day, chosen.recipeId, 'planned', 'auto');
      }
    }
  };
  if (repos._db && typeof repos._db.transaction === 'function') repos._db.transaction(write)();
  else write();
  return repos.mealPlans.getWeek(weekYear);
}

function fillEmptyDays(repos, weekYear) {
  return regenerateUnlockedDays(repos, weekYear, { fillEmptyOnly: true });
}

module.exports = {
  getSwapSuggestions,
  checkShelfLife,
  generateSundayDraft,
  generatePantryRestOfWeek,
  computeMissingForRestOfWeek,
  resolveMode,
  chooseWeekRecipes,
  buildVariedWeekPlan,
  regenerateUnlockedDays,
  fillEmptyDays,
  suggestionReason,
};
