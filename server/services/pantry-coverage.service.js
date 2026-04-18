// Pantry-coverage scoring for oppskriftsforslag.
//
// Brukes av meal-planning.service.js til å rangere oppskrifter basert på
// hva som allerede ligger i pantry. To moduser:
//
//   - 'maksimer':  ren pantry-dekning. Score = veiet snitt av hvor stor
//                  andel av hver ingrediens som finnes hjemme.
//   - 'balansert': samme base-score pluss urgency-bonus for ingredienser
//                  som matcher pantry-varer med kort tid igjen til utløp.
//                  Bidrar til å redusere matsvinn.
//
// Ren modul — ingen DB, ingen side effects. Tester seedes med en
// konstruert inventoryMap (samme form som repos.inventory.getAll()).

'use strict';

const OPTIONAL_WEIGHT = 0.3;
const REQUIRED_WEIGHT = 1.0;

// Bonus per ingrediens som matcher en pantry-vare som utløper snart.
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
 * Score én oppskrift mot pantry.
 *
 * @param {{ ingredients: Array }} recipe
 * @param {Object} inventoryMap - fra repos.inventory.getAll()
 * @param {'maksimer'|'balansert'} mode
 * @param {number} [now=Date.now()] - for testbarhet
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

    // "At home" = noe mengde tilgjengelig (matcher dagens adferd i
    // getSwapSuggestions der homeCount teller ingredienser med qtyRemaining >= qty).
    // Vi bruker cover > 0 for å gi kredit for delvis dekning også.
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
 * Rangér oppskrifter desc på pantry-score. Topp-N returneres.
 * Hver returnert oppskrift annoteres med scoring-felter (score, ingredientsAtHome,
 * totalIngredients, expiringUsed) — selve recipe-objektet kopieres uendret.
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
    // Tie-break for 'balansert': flere utløps-varer brukt vinner
    if (mode === 'balansert' && b.expiringUsed !== a.expiringUsed) {
      return b.expiringUsed - a.expiringUsed;
    }
    // Generell tie-break: kortere prepTime vinner hvis numerisk
    const pa = parsePrepTimeMinutes(a.recipe.prepTime);
    const pb = parsePrepTimeMinutes(b.recipe.prepTime);
    if (pa !== pb) return pa - pb;
    // Stabil: ID
    return (a.recipe.id || 0) - (b.recipe.id || 0);
  });

  return limit ? scored.slice(0, limit) : scored;
}

// "20 min" → 20. "1 time" → 60. Ukjent → 999 (havner sist i tie-break).
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
 * "Trekk fra" pantry-mengder som en valgt oppskrift vil bruke. Returnerer
 * en NY inventoryMap (muterer ikke input) — nyttig for sekvensielt valg
 * av oppskrifter til en uke hvor samme vare ikke skal telles to ganger.
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
  // eksponert for tester
  _internals: { OPTIONAL_WEIGHT, REQUIRED_WEIGHT, URGENCY_BONUS_CRITICAL, URGENCY_BONUS_SOON },
};
