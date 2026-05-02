// Shopping list service (Iteration 3b phase A)
//
// Responsibilities:
//   1. Build a shopping-list structure from week plan + pantry +
//      consumables + extras
//   2. Persist as the 'active' shopping list in shopping_lists +
//      shopping_list_items
//   3. Keep backward-compatible buildShoppingList() that reads the
//      persistent list when it exists (or computes on-demand as fallback)
//
// Design choices:
//   - generateForWeek() is the authoritative write path. All other
//     consumers (routes.js, sunday-push) call this one.
//   - buildShoppingList() is preserved as a read API for backward
//     compatibility: if there is an 'active' list in DB, return it
//     formatted as the old object. Otherwise compute on-demand WITHOUT
//     persisting. This lets existing tests (sunday-push that has not
//     called generate) and GET /api/shopping/current work unchanged.
//   - No Kassal calls in this phase. Phase B kicks off a background job
//     for enrichment after the list is saved.

const { normalizeSync } = require('./ingredient-normalizer.service');
const { getOptionalFamilyId } = require('../auth/family-context');
const { effectiveScale } = require('./family.service');

const CATEGORY_ORDER = [
  'Kj\u00f8tt & fisk',
  'Meieri',
  'Frukt & gr\u00f8nt',
  'Br\u00f8d & bakst',
  'T\u00f8rrvarer & annet',
  'Drikkevarer',
  'Husholdning',
  'Barn',
  'Personlig pleie',
];

// ============================================================
// Computation (shared between build + generate)
// ============================================================

/**
 * Compute what should be on the shopping list for a week based on the
 * current week plan, pantry, consumables and extras. Pure function — no
 * DB writes. Returns a flat item array ready for insertion into
 * shopping_list_items plus the legacy category structure for backward
 * compatibility.
 */
function computeShoppingListForWeek(repos, weekYear) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const inventoryMap = repos.inventory.getAll();
  const productsMap = repos.products.getAllAsMap();
  const allRecipes = repos.recipes.getAll();
  const consumables = repos.consumables.getAll();
  const extras = repos.shoppingExtras.getWeek(weekYear);
  // Family-aware portion scaling. When the roster has members, scale each
  // recipe's ingredients by (familyPortionSum / recipe.servings). Outside a
  // family context or for empty rosters the scale is 1 and behaviour is
  // unchanged for legacy single-tenant users.
  const familyId = getOptionalFamilyId();

  const seen = new Map();

  // 1. Collect ingredients from active dinners.
  //    'away', 'skipped' and 'removed' do not count — the day needs no food.
  for (const slot of plan) {
    if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') continue;
    const recipe = allRecipes.find((r) => r.id === slot.recipeId);
    if (!recipe) continue;
    const scale = familyId ? effectiveScale(repos, familyId, recipe.servings) : 1;
    for (const ing of recipe.ingredients || []) {
      const key = ing.productKey || (ing.name || '').toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, {
          totalQty: 0,
          unit: ing.unit,
          meals: [],
          name: ing.name,
          productKey: ing.productKey || null,
          recipeIds: new Set(),
        });
      }
      const entry = seen.get(key);
      entry.totalQty += (ing.qty || 0) * scale;
      entry.meals.push(recipe.name);
      entry.recipeIds.add(recipe.id);
    }
  }

  // 2. Build flatItems + catMap (grouped for legacy format)
  const flatItems = [];
  const catMap = {};

  for (const [key, data] of seen) {
    const product = productsMap[key];
    const cat = product ? product.category : 'T\u00f8rrvarer & annet';
    const invItem = inventoryMap[key] || {};
    const hasHome = invItem.qtyRemaining || 0;
    const stillNeed = Math.max(0, data.totalQty - hasHome);
    const pantryHas = hasHome > 0 && stillNeed === 0;
    const needsBuy = stillNeed > 0;

    const packCount = product && product.packSize > 0 ? Math.ceil(stillNeed / product.packSize) : 0;
    const estPrice = product ? packCount * (product.estPrice || 0) : 0;
    const dairyRule = product?.dairyRule;
    let dairyNote = null;
    if (dairyRule === 'r\u00f8ros_only') dairyNote = '\ud83d\udd34 KUN R\u00f8ros-meieriet (Kiwi)';
    else if (dairyRule === 'r\u00f8ros_preferred')
      dairyNote = '\ud83d\udfe1 R\u00f8ros foretrukket, Anglamark OK';

    const name = product ? product.productName : data.name;

    // Phase C: normalise ingredient name to Norwegian if it looks English.
    // If the product match already has a Norwegian productName we skip
    // because that is authoritative. Otherwise run the normalizer on
    // data.name (the original from the recipe).
    let ingredientNameNo = null;
    if (!product) {
      const norm = normalizeSync({ name: data.name, qty: data.totalQty, unit: data.unit });
      if (norm.language === 'en' && norm.nameNo && norm.nameNo !== data.name.toLowerCase()) {
        ingredientNameNo = norm.nameNo;
      }
    }

    // flatItem: row-ready for shopping_list_items
    flatItems.push({
      sourceType: 'meal_ingredient',
      sourceRef: data.recipeIds.size > 0 ? Array.from(data.recipeIds).join(',') : null,
      ingredientName: name,
      ingredientNameNo,
      productKey: data.productKey,
      qty: stillNeed > 0 ? stillNeed : data.totalQty,
      unit: data.unit,
      category: cat,
      packSize: product ? product.packSize : null,
      packUnit: product ? product.unit : data.unit,
      packCount,
      estPrice,
      pantryHas,
      pantryQty: hasHome,
      needsBuy,
      mealsJson: data.meals,
      dairyNote,
    });

    // Legacy catMap skips items that are covered from the pantry
    if (stillNeed <= 0) continue;
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push({
      key,
      name,
      totalNeeded: data.totalQty,
      hasHome,
      stillNeed,
      unit: data.unit,
      packSize: product ? product.packSize : null,
      packUnit: product ? product.unit : data.unit,
      packCount,
      estPrice,
      dairyNote,
      meals: data.meals,
      source: 'recipe',
      checkedOff: false,
    });
  }

  // 3. Consumables under reorder threshold
  for (const c of consumables) {
    if (!c.autoAdd) continue;
    if ((c.currentQty || 0) > (c.reorderThreshold || 0)) continue;

    let packCount = 1;
    if (c.packSize && c.reorderThreshold > 0) {
      const deficit = Math.max(0, c.reorderThreshold - c.currentQty);
      packCount = c.packSize > 1 ? Math.ceil(deficit / c.packSize) || 1 : 1;
    }

    let daysLeft = null;
    if (c.depletionRate > 0 && c.currentQty > 0) {
      if (c.depletionModel === 'daily_rate') daysLeft = Math.round(c.currentQty / c.depletionRate);
      else if (c.depletionModel === 'fixed_interval') daysLeft = c.depletionRate;
    }

    flatItems.push({
      sourceType: 'consumable',
      sourceRef: String(c.id),
      ingredientName: c.packName || c.name,
      productKey: null,
      qty: null,
      unit: c.unit,
      category: c.category,
      packSize: c.packSize || null,
      packUnit: c.packUnit || c.unit,
      packCount,
      estPrice: (c.estPrice || 0) * packCount,
      pantryHas: false,
      pantryQty: c.currentQty,
      needsBuy: true,
      notes: c.notes || null,
    });

    const cat = c.category;
    if (!catMap[cat]) catMap[cat] = [];
    if (catMap[cat].find((i) => i.consumableId === c.id)) continue;
    catMap[cat].push({
      key: `consumable_${c.id}`,
      consumableId: c.id,
      name: c.packName || c.name,
      totalNeeded: null,
      hasHome: c.currentQty,
      stillNeed: null,
      unit: c.unit,
      packSize: c.packSize || null,
      packUnit: c.packUnit || c.unit,
      packCount,
      estPrice: (c.estPrice || 0) * packCount,
      dairyNote: null,
      meals: [],
      source: 'consumable',
      checkedOff: false,
      depletionInfo: c.depletionUnit,
      daysLeft,
      store: c.store || null,
      notes: c.notes || null,
    });
  }

  // 4. Manually-added extras
  for (const extra of extras) {
    const cat = extra.category || 'T\u00f8rrvarer & annet';
    flatItems.push({
      sourceType: 'extra',
      sourceRef: String(extra.id),
      ingredientName: extra.name,
      productKey: null,
      qty: extra.quantity || 1,
      unit: '',
      category: cat,
      packSize: null,
      packUnit: '',
      packCount: extra.quantity || 1,
      estPrice: 0,
      pantryHas: false,
      pantryQty: null,
      needsBuy: !extra.checked,
    });

    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push({
      key: `extra_${extra.id}`,
      extraId: extra.id,
      name: extra.name,
      totalNeeded: null,
      hasHome: 0,
      stillNeed: null,
      unit: '',
      packSize: null,
      packUnit: '',
      packCount: extra.quantity || 1,
      estPrice: 0,
      dairyNote: null,
      meals: [],
      source: 'manual',
      checkedOff: !!extra.checked,
    });
  }

  // 5. Total
  let totalEstPrice = 0;
  for (const items of Object.values(catMap)) {
    for (const item of items) totalEstPrice += item.estPrice || 0;
  }

  return {
    flatItems,
    legacy: {
      categories: CATEGORY_ORDER.filter((c) => catMap[c]).map((c) => ({
        category: c,
        items: catMap[c],
      })),
      totalEstPrice: Math.round(totalEstPrice),
    },
  };
}

// ============================================================
// Public: generate persistent shopping list for a week
// ============================================================

/**
 * Generate (or regenerate) a shopping list for a week and persist it.
 *
 * Behaves idempotently: previous 'active' for the same week is moved to
 * 'superseded' before the new 'active' is created (enforced by the
 * partial unique index + shoppingLists.createActive).
 *
 * @param {Object} repos
 * @param {string} weekYear
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] — generate even if the week is not complete
 * @returns {{ listId: number, itemCount: number, needsBuyCount: number, totalEstPrice: number }}
 */
function generateForWeek(repos, weekYear, { force = false } = {}) {
  if (!force && !repos.mealPlans.isWeekComplete(weekYear)) {
    const err = new Error(
      'Week is not complete \u2014 all 7 days must have a choice (dinner, away, skipped or removed)'
    );
    err.code = 'WEEK_NOT_COMPLETE';
    throw err;
  }

  const { flatItems, legacy } = computeShoppingListForWeek(repos, weekYear);
  const { listId, itemCount, needsBuyCount } = repos.shoppingLists.createActive(
    weekYear,
    flatItems,
    { totalEstPrice: legacy.totalEstPrice }
  );

  return {
    listId,
    itemCount,
    needsBuyCount,
    totalEstPrice: legacy.totalEstPrice,
    weekYear,
  };
}

// ============================================================
// Public: read shopping list (backward compatible)
// ============================================================

/**
 * Backward-compatible read of the shopping list as a legacy object with
 * { categories, totalEstPrice }. Uses:
 *   1. Active DB list if it exists (persisted via generateForWeek)
 *   2. On-demand computation otherwise (no persistence)
 *
 * This lets existing GET /api/shopping/current and sunday-push work
 * unchanged even before the user has generated a "real" list.
 */
function buildShoppingList(repos, weekYear) {
  const active = repos.shoppingLists?.getActive ? repos.shoppingLists.getActive(weekYear) : null;

  if (active && active.items && active.items.length > 0) {
    return legacyViewFromActiveList(active);
  }

  return computeShoppingListForWeek(repos, weekYear).legacy;
}

/**
 * Format a persistent shopping_list as the legacy object the UI already
 * understands. Group items by category.
 */
function legacyViewFromActiveList(list) {
  const catMap = {};
  let totalEstPrice = 0;
  for (const it of list.items) {
    if (it.pantryHas && !it.needsBuy) continue; // hidden in legacy view
    const cat = it.category || 'T\u00f8rrvarer & annet';
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push({
      key: it.productKey || `item_${it.id}`,
      itemId: it.id,
      name: it.ingredientName,
      totalNeeded: it.qty,
      hasHome: it.pantryQty || 0,
      stillNeed: it.qty,
      unit: it.unit || '',
      packSize: it.packSize,
      packUnit: it.packUnit || it.unit || '',
      packCount: it.packCount,
      estPrice: it.estPrice || 0,
      dairyNote: it.dairyNote || null,
      meals: it.mealsJson || [],
      source:
        it.sourceType === 'meal_ingredient'
          ? 'recipe'
          : it.sourceType === 'consumable'
            ? 'consumable'
            : 'manual',
      checkedOff: !!it.boughtAt,
      boughtAt: it.boughtAt,
      kassalProductId: it.kassalProductId,
      resolutionConfidence: it.resolutionConfidence,
    });
    totalEstPrice += it.estPrice || 0;
  }
  return {
    listId: list.id,
    enrichmentStatus: list.enrichmentStatus,
    categories: CATEGORY_ORDER.filter((c) => catMap[c]).map((c) => ({
      category: c,
      items: catMap[c],
    })),
    totalEstPrice: Math.round(list.totalEstPrice ?? totalEstPrice),
  };
}

module.exports = {
  buildShoppingList,
  generateForWeek,
  computeShoppingListForWeek,
  legacyViewFromActiveList,
  CATEGORY_ORDER,
};
