// Pantry-coverage scoring for recipe suggestions.
//
// Used by meal-planning.service.js to rank recipes based on what is
// already in the pantry. Two modes:
//
//   - 'maksimer':  pure pantry coverage. Score = weighted average of
//                  how much of each ingredient is at home.
//   - 'balansert': same base score plus an urgency bonus for ingredients
//                  matching pantry items close to expiry. Helps reduce
//                  food waste.
//
// Pure module — no DB, no side effects. Tests seed with a constructed
// inventoryMap (same shape as repos.inventory.getAll()).

'use strict';

const OPTIONAL_WEIGHT = 0.3;
const REQUIRED_WEIGHT = 1.0;

// Bonus per ingredient that matches a pantry item expiring soon.
const URGENCY_BONUS_CRITICAL = 0.15; // daysLeft <= 1
const URGENCY_BONUS_SOON = 0.08; // daysLeft <= 3

function keyForIngredient(ing) {
  return ing.productKey || (ing.name || '').toLowerCase();
}

function coverForIngredient(ing, invItem) {
  if (!invItem) return 0;
  const need = Number(ing.qty) || 0;
  if (need <= 0) return 1;
  const have = Number(invItem.qtyRemaining) || 0;
  return Math.min(1, have / need);
}

function daysUntilExpiry(invItem, now = Date.now()) {
  if (!invItem || !invItem.expiresEst) return null;
  const t = new Date(invItem.expiresEst).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / 86400000);
}

function urgencyBonus(daysLeft) {
  if (daysLeft === null) return 0;
  if (daysLeft <= 1) return URGENCY_BONUS_CRITICAL;
  if (daysLeft <= 3) return URGENCY_BONUS_SOON;
  return 0;
}

/**
 * Score one recipe against the pantry.
 *
 * @param {{ ingredients: Array }} recipe
 * @param {Object} inventoryMap - from repos.inventory.getAll()
 * @param {'maksimer'|'balansert'} mode
 * @param {number} [now=Date.now()] - for testability
 * @returns {{
 *   score: number,
 *   ingredientsAtHome: number,
 *   totalIngredients: number,
 *   expiringUsed: number,
 *   coverages: Array<{ key: string, cover: number, daysLeft: number|null }>
 * }}
 */
function scoreRecipeByPantry(recipe, inventoryMap, mode = 'maksimer', now = Date.now()) {
  const ings = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ings.length === 0) {
    return {
      score: 0,
      ingredientsAtHome: 0,
      totalIngredients: 0,
      expiringUsed: 0,
      coverages: [],
    };
  }

  let weightedCoverage = 0;
  let totalWeight = 0;
  let urgencyTotal = 0;
  let ingredientsAtHome = 0;
  let expiringUsed = 0;
  const coverages = [];

  for (const ing of ings) {
    const key = keyForIngredient(ing);
    const invItem = inventoryMap[key];
    const cover = coverForIngredient(ing, invItem);
    const weight = ing.optional ? OPTIONAL_WEIGHT : REQUIRED_WEIGHT;

    weightedCoverage += cover * weight;
    totalWeight += weight;

    // "At home" = some quantity available (matches the current behavior
    // in getSwapSuggestions where homeCount counts ingredients with
    // qtyRemaining >= qty). We use cover > 0 to credit partial coverage too.
    if (cover > 0) ingredientsAtHome++;

    let daysLeft = null;
    if (mode === 'balansert' && invItem && cover > 0) {
      daysLeft = daysUntilExpiry(invItem, now);
      const bonus = urgencyBonus(daysLeft);
      if (bonus > 0) {
        urgencyTotal += bonus;
        expiringUsed++;
      }
    }

    coverages.push({ key, cover, daysLeft });
  }

  const baseScore = totalWeight > 0 ? weightedCoverage / totalWeight : 0;
  const score = mode === 'balansert' ? baseScore + urgencyTotal : baseScore;

  return {
    score,
    ingredientsAtHome,
    totalIngredients: ings.length,
    expiringUsed,
    coverages,
  };
}

/**
 * Rank recipes desc by pantry score. Top-N returned. Each returned
 * recipe is annotated with scoring fields (score, ingredientsAtHome,
 * totalIngredients, expiringUsed) — the recipe object itself is copied
 * unchanged.
 *
 * @param {Array} recipes
 * @param {Object} inventoryMap
 * @param {'maksimer'|'balansert'} mode
 * @param {number} [limit]
 * @param {number} [now=Date.now()]
 */
function rankRecipes(
  recipes,
  inventoryMap,
  mode = 'maksimer',
  limit = undefined,
  now = Date.now()
) {
  if (!Array.isArray(recipes) || recipes.length === 0) return [];

  const scored = recipes.map((r) => {
    const s = scoreRecipeByPantry(r, inventoryMap, mode, now);
    return {
      recipe: r,
      score: s.score,
      ingredientsAtHome: s.ingredientsAtHome,
      totalIngredients: s.totalIngredients,
      expiringUsed: s.expiringUsed,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break for 'balansert': more expiring items used wins
    if (mode === 'balansert' && b.expiringUsed !== a.expiringUsed) {
      return b.expiringUsed - a.expiringUsed;
    }
    // General tie-break: shorter prepTime wins if numeric
    const pa = parsePrepTimeMinutes(a.recipe.prepTime);
    const pb = parsePrepTimeMinutes(b.recipe.prepTime);
    if (pa !== pb) return pa - pb;
    // Stable: ID
    return (a.recipe.id || 0) - (b.recipe.id || 0);
  });

  return limit ? scored.slice(0, limit) : scored;
}

// "20 min" → 20. "1 time" → 60. Unknown → 999 (lands last in tie-break).
function parsePrepTimeMinutes(s) {
  if (!s) return 999;
  const m = String(s).match(/(\d+)\s*(min|t|tim|time)?/i);
  if (!m) return 999;
  const n = Number(m[1]);
  const unit = (m[2] || 'min').toLowerCase();
  if (unit.startsWith('t')) return n * 60;
  return n;
}

/**
 * "Subtract" pantry quantities that a chosen recipe will use. Returns a
 * NEW inventoryMap (does not mutate input) — useful for sequential
 * recipe selection across a week where the same item should not be
 * counted twice.
 */
function subtractIngredientsFromInventory(inventoryMap, recipe) {
  const next = { ...inventoryMap };
  for (const ing of recipe.ingredients || []) {
    const key = keyForIngredient(ing);
    const inv = next[key];
    if (!inv) continue;
    const remaining = Math.max(0, (inv.qtyRemaining || 0) - (ing.qty || 0));
    next[key] = { ...inv, qtyRemaining: remaining };
  }
  return next;
}

module.exports = {
  scoreRecipeByPantry,
  rankRecipes,
  subtractIngredientsFromInventory,
  keyForIngredient,
  coverForIngredient,
  daysUntilExpiry,
  // exposed for tests
  _internals: { OPTIONAL_WEIGHT, REQUIRED_WEIGHT, URGENCY_BONUS_CRITICAL, URGENCY_BONUS_SOON },
};
