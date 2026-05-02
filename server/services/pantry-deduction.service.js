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
    const recipeAmount = Number(ing.qty) || 0;
    const scaledAmount = round1(recipeAmount * scale);
    const existing = collated.get(key);
    if (existing) {
      existing.recipeAmount = round1(existing.recipeAmount + recipeAmount);
      existing.suggestedDeduction = round1(existing.suggestedDeduction + scaledAmount);
      // Keep first-seen name + optional flag — collation is rare and
      // either name reads correctly to the user.
    } else {
      collated.set(key, {
        productKey: ing.productKey || null,
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
    const inv = repos.inventory.getByKey(suggestion.productKey);
    if (!inv) continue;
    suggestion.matched = true;
    suggestion.pantryRemaining = Number(inv.qtyRemaining) || 0;
    suggestion.pantryUnit = inv.unit || suggestion.pantryUnit;
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
  const noteTag = `meal_deduction:${mealId}`;

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
    const inv = repos.inventory.getByKey(item.productKey);
    if (!inv) {
      skipped.push({ productKey: item.productKey, reason: 'not-in-pantry' });
      continue;
    }
    const prevQty = Number(inv.qtyRemaining) || 0;
    const clamped = Math.min(requested, prevQty);
    if (clamped <= 0) {
      skipped.push({ productKey: item.productKey, reason: 'pantry-empty' });
      continue;
    }
    const newQty = round1(prevQty - clamped);
    const result = pantryService.correctQty(repos, {
      productKey: item.productKey,
      newQty,
      notes: noteTag,
    });
    applied.push({
      productKey: item.productKey,
      prevQty,
      newQty,
      delta: result.delta,
    });
    if (result.lowStock?.triggered) {
      lowStockTriggered.push(item.productKey);
    }
  }

  return { applied, skipped, lowStockTriggered };
}

function round1(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

module.exports = {
  buildSuggestions,
  applyDeduction,
};
