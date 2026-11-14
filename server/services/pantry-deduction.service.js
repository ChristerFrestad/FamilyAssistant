// Sprint 6 — Smart-coupling: meal-cooked → pantry deduction.
//
// Pure orchestration service that ties together three existing pieces:
//
//   1. recipe.ingredients   (from repos.recipes.getById)
//   2. family-portion-scaling (services/family.service.js)
//   3. pantry mutation     (services/pantry.service.correctQty)
//
// Two public functions:
//
//   buildSuggestions(repos, mealPlanRow)
//     Returns an array of per-ingredient suggestion objects so the
//     mark-cooked dialog can render an editable preview.
//
//   applyDeduction(repos, mealId, items)
//     Mutates pantry via correctQty per item. Reuses 'correction' as
//     the inventory_log reason (per Christer's decision to avoid a
//     migration just to discriminate meal vs manual correction). The
//     deduction context is preserved in inventory_log.notes with the
//     prefix 'meal_deduction:<mealId>' so audit-history is reconstructable.
//
// The service is stateless — repos is injected. No DB-handle access
// outside of repos.* repository methods.
//
// "Eaten" vs "cooked" terminology: the user-facing endpoint is
// /api/meals/:id/mark-eaten because that matches Christer's mental
// model ("I ate this meal"), but the persisted DB enum value is
// 'cooked' (the existing meal_plans.status enum, no migration). The
// two are aliases for the same state in this codebase.

'use strict';

const { keyForIngredient } = require('./pantry-coverage.service');
const { aliasGroup, aliasKeys, preferredKey } = require('./product-key-alias');
const { effectiveScale } = require('./family.service');
const pantryService = require('./pantry.service');
const { getFamilyId } = require('../auth/family-context');

/**
 * @typedef {Object} DeductionSuggestion
 * @property {string|null} productKey      Pantry key, null if no link
 * @property {string} name                 Display name (recipe ingredient name)
 * @property {number} recipeAmount         Amount written on the recipe
 * @property {number} portionFactor        Scale applied (effectiveScale × override)
 * @property {number} suggestedDeduction   recipeAmount × portionFactor
 * @property {number} pantryRemaining      Current pantry quantity (0 if missing)
 * @property {string|null} pantryUnit      Pantry unit string, null if no link
 * @property {boolean} matched             Whether the productKey was found in pantry
 * @property {boolean} optional            Original recipe optional-flag
 */

/**
 * Build per-ingredient suggestions for a meal that the user just
 * marked cooked. Defensive against missing recipe rows, ingredients
 * without productKey, and zero-qty rows.
 *
 * @param {Object} repos
 * @param {Object} mealPlanRow             Row from mealPlans.getWeek
 * @returns {DeductionSuggestion[]}
 */
/**
 * Exact inventory_log.notes value for one meal. Equality, not a prefix:
 * meal 5 must not match meal_deduction:51.
 * @param {number} mealId
 * @returns {string}
 */
function deductionNote(mealId) {
  const id = Number(mealId);
  if (!Number.isInteger(id) || id <= 0) return '';
  return `meal_deduction:${id}`;
}

/**
 * @param {Object} repos
 * @param {string} productKey
 * @param {number} mealId
 * @returns {boolean}
 */
function hasExactDeduction(repos, productKey, mealId) {
  const note = deductionNote(mealId);
  if (!note || !productKey) return false;
  if (repos.inventoryLog && typeof repos.inventoryLog.hasExactNote === 'function') {
    return repos.inventoryLog.hasExactNote(productKey, note);
  }
  if (!repos.inventoryLog || typeof repos.inventoryLog.getByKey !== 'function') return false;
  const rows = repos.inventoryLog.getByKey(productKey, 200);
  return rows.some((row) => row.notes === note);
}

function inventoryKeys(repos) {
  if (!repos.inventory || typeof repos.inventory.getAll !== 'function') return [];
  return Object.keys(repos.inventory.getAll() || {});
}

function spellings(repos, productKey) {
  return aliasKeys(productKey, { repos, extraKeys: inventoryKeys(repos) });
}

function hasAliasDeduction(repos, productKey, mealId) {
  return spellings(repos, productKey).some((key) => hasExactDeduction(repos, key, mealId));
}

function pantryOnHandFromRepos(repos, productKey) {
  let total = 0;
  const seen = new Set();
  for (const key of spellings(repos, productKey)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const inv = repos.inventory.getByKey(key);
    total += Number(inv?.qtyRemaining) || 0;
  }
  return total;
}

/**
 * Deduct `amount` across the raw row and the slug row. Caller holds the
 * transaction. A note on either key blocks both. Each inventory row is
 * touched at most once.
 */
function deductAcrossAliases(repos, mealId, productKey, amount, reason) {
  const note = deductionNote(mealId);
  if (note && hasAliasDeduction(repos, productKey, mealId)) {
    return { taken: 0, reason: 'already-deducted', parts: [] };
  }
  let left = round1(amount);
  const parts = [];
  for (const key of spellings(repos, productKey)) {
    if (left <= 0) break;
    const inv = repos.inventory.getByKey(key);
    const have = Number(inv?.qtyRemaining) || 0;
    if (have <= 0) continue;
    const take = Math.min(left, have);
    const newQty = round1(have - take);
    let lowStock = null;
    if (reason === 'cron_depletion') {
      repos.inventory.reduceQty(key, take);
      if (repos.inventoryLog && typeof repos.inventoryLog.insert === 'function') {
        repos.inventoryLog.insert({
          productKey: key,
          qtyDelta: round1(newQty - have),
          newQty,
          unit: inv.unit || null,
          reason: 'cron_depletion',
          notes: note,
        });
      }
    } else {
      const result = pantryService.correctQty(repos, {
        productKey: key,
        newQty,
        notes: note,
      });
      lowStock = result.lowStock;
    }
    parts.push({ key, take, newQty, lowStock });
    left = round1(left - take);
  }
  if (parts.length === 0) return { taken: 0, reason: 'not-in-pantry', parts };
  return { taken: round1(amount - left), reason: null, parts };
}

function buildSuggestions(repos, mealPlanRow) {
  if (!mealPlanRow || !mealPlanRow.recipeId) return [];
  const recipe = repos.recipes.getById(mealPlanRow.recipeId);
  if (!recipe || !Array.isArray(recipe.ingredients)) return [];

  const familyId = getFamilyId();
  const scale = effectiveScale(repos, familyId, recipe.servings, null);

  // Sum amounts when multiple ingredients resolve to the same pantry
  // key (e.g. "salt" and "havsalt" both land at productKey='salt').
  // This avoids double-deduction on confirm.
  const collated = new Map();
  for (const ing of recipe.ingredients) {
    const key = keyForIngredient(ing);
    if (!key) continue;
    const group = aliasGroup(key, repos);
    const recipeAmount = Number(ing.qty) || 0;
    const scaledAmount = round1(recipeAmount * scale);
    const existing = collated.get(group);
    if (existing) {
      existing.recipeAmount = round1(existing.recipeAmount + recipeAmount);
      existing.suggestedDeduction = round1(existing.suggestedDeduction + scaledAmount);
      // Keep first-seen name + optional flag — collation is rare and
      // either name reads correctly to the user.
    } else {
      collated.set(group, {
        productKey: preferredKey(key, repos) || ing.productKey || null,
        name: ing.name || key,
        recipeAmount,
        portionFactor: scale,
        suggestedDeduction: scaledAmount,
        pantryRemaining: 0,
        pantryUnit: ing.unit || null,
        matched: false,
        optional: !!ing.optional,
      });
    }
  }

  // Hydrate matched flag + pantry quantities from inventory.
  for (const [, suggestion] of collated) {
    if (!suggestion.productKey) continue;
    const onHand = pantryOnHandFromRepos(repos, suggestion.productKey);
    if (onHand <= 0 && !hasAliasDeduction(repos, suggestion.productKey, mealPlanRow.id)) continue;
    suggestion.matched = onHand > 0;
    suggestion.pantryRemaining = onHand;
    if (hasAliasDeduction(repos, suggestion.productKey, mealPlanRow.id)) {
      suggestion.suggestedDeduction = 0;
      suggestion.alreadyDeducted = true;
      continue;
    }
    // Clamp the suggested deduction so the UI does not default to a
    // value greater than what we have at home.
    if (suggestion.suggestedDeduction > suggestion.pantryRemaining) {
      suggestion.suggestedDeduction = round1(suggestion.pantryRemaining);
    }
  }

  return Array.from(collated.values());
}

/**
 * Apply user-confirmed deductions. Wraps each item in
 * pantry.service.correctQty so the existing audit-log + low-stock
 * trigger pipeline runs naturally.
 *
 * @param {Object} repos
 * @param {number} mealId                     meal_plans.id
 * @param {Array<{productKey: string, amountToDeduct: number}>} items
 * @returns {{ applied: Array, skipped: Array, lowStockTriggered: string[] }}
 */
function applyDeduction(repos, mealId, items) {
  if (!Array.isArray(items)) return { applied: [], skipped: [], lowStockTriggered: [] };
  const applied = [];
  const skipped = [];
  const lowStockTriggered = [];

  const run = () => {
    const groups = new Map();
    for (const item of items) {
      if (!item || !item.productKey) {
        skipped.push({ productKey: item?.productKey ?? null, reason: 'missing-productKey' });
        continue;
      }
      const requested = Number(item.amountToDeduct);
      if (!Number.isFinite(requested) || requested <= 0) {
        skipped.push({ productKey: item.productKey, reason: 'non-positive-amount' });
        continue;
      }
      const group = aliasGroup(item.productKey, repos);
      const prev = groups.get(group);
      if (prev) prev.amount = round1(prev.amount + requested);
      else groups.set(group, { key: preferredKey(item.productKey, repos), amount: requested });
    }
    for (const group of groups.values()) {
      const result = deductAcrossAliases(repos, mealId, group.key, group.amount, 'correction');
      if (result.reason === 'already-deducted') {
        skipped.push({ productKey: group.key, reason: 'already-deducted' });
        continue;
      }
      if (result.parts.length === 0) {
        skipped.push({ productKey: group.key, reason: 'not-in-pantry' });
        continue;
      }
      for (const part of result.parts) {
        applied.push({
          productKey: part.key,
          prevQty: round1(part.newQty + part.take),
          newQty: part.newQty,
          delta: round1(-part.take),
        });
        if (part.lowStock?.triggered) lowStockTriggered.push(part.key);
      }
    }
  };

  if (typeof repos.transaction === 'function') repos.transaction(run)();
  else run();

  return { applied, skipped, lowStockTriggered };
}

function round1(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

module.exports = {
  buildSuggestions,
  applyDeduction,
  deductAcrossAliases,
  deductionNote,
  hasExactDeduction,
  hasAliasDeduction,
};
