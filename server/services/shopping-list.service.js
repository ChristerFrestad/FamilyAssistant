// Shopping list service (Iterasjon 3b fase A)
//
// Ansvar:
//   1. Bygg opp en handleliste-struktur fra ukeplan + pantry + consumables + extras
//   2. Persistér som 'active' handleliste i shopping_lists + shopping_list_items
//   3. Behold bakoverkompatibel buildShoppingList() som leser den persistente
//      lista hvis den finnes (eller beregner on-demand som fallback)
//
// Designvalg:
//   - generateForWeek() er den autoritative skriveveien. Alle andre
//     konsumenter (routes.js, sunday-push) kaller denne.
//   - buildShoppingList() beholdes som lese-API for bakoverkompatibilitet:
//     hvis det finnes en 'active' liste i DB, returner den formatert som
//     det gamle objektet. Hvis ikke, beregn on-demand UTEN å persistere.
//     Det lar eksisterende tester (sunday-push som ikke har kalt generate)
//     og GET /api/shopping/current fungere uten endringer.
//   - Ingen Kassal-kall i denne fasen. Fase B sender bakgrunnsjobb for
//     berikelse etter at lista er lagret.

const { normalizeSync } = require('./ingredient-normalizer.service');

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
// Beregning (felles for build + generate)
// ============================================================

/**
 * Beregn hva som skal på handlelista for en uke, basert på nåværende
 * ukeplan, pantry, consumables og extras. Ren funksjon — ingen DB-skriving.
 * Returnerer et flat item-array klart for insert i shopping_list_items,
 * pluss den legacy kategori-strukturen for bakoverkompatibilitet.
 */
function computeShoppingListForWeek(repos, weekYear) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const inventoryMap = repos.inventory.getAll();
  const productsMap = repos.products.getAllAsMap();
  const allRecipes = repos.recipes.getAll();
  const consumables = repos.consumables.getAll();
  const extras = repos.shoppingExtras.getWeek(weekYear);

  const seen = new Map();

  // 1. Samle ingredienser fra aktive middager.
  //    'away', 'skipped' og 'removed' teller ikke — dagen trenger ingen mat.
  for (const slot of plan) {
    if (slot.status === 'away' || slot.status === 'skipped' || slot.status === 'removed') continue;
    const recipe = allRecipes.find(r => r.id === slot.recipeId);
    if (!recipe) continue;
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
      entry.totalQty += ing.qty || 0;
      entry.meals.push(recipe.name);
      entry.recipeIds.add(recipe.id);
    }
  }

  // 2. Bygg flatItems + catMap (gruppert for legacy-format)
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

    const packCount = product && product.packSize > 0
      ? Math.ceil(stillNeed / product.packSize) : 0;
    const estPrice = product ? packCount * (product.estPrice || 0) : 0;
    const dairyRule = product?.dairyRule;
    let dairyNote = null;
    if (dairyRule === 'r\u00f8ros_only') dairyNote = '\ud83d\udd34 KUN R\u00f8ros-meieriet (Kiwi)';
    else if (dairyRule === 'r\u00f8ros_preferred') dairyNote = '\ud83d\udfe1 R\u00f8ros foretrukket, Anglamark OK';

    const name = product ? product.productName : data.name;

    // Fase C: normaliser ingrediensnavn til norsk hvis det ser engelsk ut.
    // Hvis product-matchen allerede har et norsk productName, hopper vi over
    // fordi det er autoritativt. Ellers kjør normalizer på data.name (originalen
    // fra recipe).
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
      sourceRef: data.recipeIds.size > 0
        ? Array.from(data.recipeIds).join(',')
        : null,
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

    // Legacy catMap skipper items som er dekket fra pantry
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
      packCount = c.packSize > 1 ? (Math.ceil(deficit / c.packSize) || 1) : 1;
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
    if (catMap[cat].find(i => i.consumableId === c.id)) continue;
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

  // 4. Manuelt tillagte extras
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
      categories: CATEGORY_ORDER.filter(c => catMap[c]).map(c => ({ category: c, items: catMap[c] })),
      totalEstPrice: Math.round(totalEstPrice),
    },
  };
}

// ============================================================
// Public: generer persistent handleliste for en uke
// ============================================================

/**
 * Generer (eller regenerer) en handleliste for en uke og persister den.
 *
 * Oppfører seg idempotent: tidligere 'active' for samme uke blir
 * flyttet til 'superseded' før ny 'active' opprettes (håndheves av
 * partial unique index + shoppingLists.createActive).
 *
 * @param {Object} repos
 * @param {string} weekYear
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] — generer selv om uken ikke er komplett
 * @returns {{ listId: number, itemCount: number, needsBuyCount: number, totalEstPrice: number }}
 */
function generateForWeek(repos, weekYear, { force = false } = {}) {
  if (!force && !repos.mealPlans.isWeekComplete(weekYear)) {
    const err = new Error('Uken er ikke komplett \u2014 alle 7 dager m\u00e5 ha et valg (middag, away, skipped eller removed)');
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
// Public: les handleliste (bakoverkompatibel)
// ============================================================

/**
 * Bakoverkompatibel lesing av handleliste som et legacy-objekt med
 * { categories, totalEstPrice }. Bruker:
 *   1. Aktiv DB-liste hvis den finnes (persistert via generateForWeek)
 *   2. On-demand beregning ellers (uten persistens)
 *
 * Dette lar eksisterende GET /api/shopping/current og sunday-push fungere
 * uendret selv før brukeren har generert en "ekte" liste.
 */
function buildShoppingList(repos, weekYear) {
  const active = repos.shoppingLists?.getActive
    ? repos.shoppingLists.getActive(weekYear)
    : null;

  if (active && active.items && active.items.length > 0) {
    return legacyViewFromActiveList(active);
  }

  return computeShoppingListForWeek(repos, weekYear).legacy;
}

/**
 * Formater en persistent shopping_list som legacy-objektet som UI-et
 * allerede forstår. Gruppér items på category.
 */
function legacyViewFromActiveList(list) {
  const catMap = {};
  let totalEstPrice = 0;
  for (const it of list.items) {
    if (it.pantryHas && !it.needsBuy) continue; // gjemmes i legacy-visning
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
      source: it.sourceType === 'meal_ingredient' ? 'recipe'
        : it.sourceType === 'consumable' ? 'consumable'
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
    categories: CATEGORY_ORDER.filter(c => catMap[c]).map(c => ({ category: c, items: catMap[c] })),
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
