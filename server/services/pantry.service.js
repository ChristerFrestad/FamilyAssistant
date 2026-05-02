// Pantry service (Iteration 1 + Phase F2)
//
// Responsibilities:
//   1. Add items to pantry manually with auto-computed shelf life
//   2. Adjust quantity (correction) with audit-log
//   3. Remove expired items with audit-log
//   4. (F2) Persist total_size and trigger low-stock to shopping list
//
// Every change writes an inventory_log row so we can answer "why is
// there flour here?" and "what disappeared from pantry without us buying
// it again?".
//
// The service is stateless — it takes repos as a parameter and returns
// an object.

const { logger } = require('../logger');
const units = require('./units');
const seed = require('../seed');

// ============================================================
// Shelf-life estimation
// ============================================================

/**
 * Heuristic for auto-computed shelf life when the user does not provide
 * an explicit expires date. Primary source is products.shelf_days if
 * the product exists. Fallback is category heuristic.
 */
const CATEGORY_SHELF_DAYS = {
  'Kjøtt & fisk': 3,
  Meieri: 10,
  'Frukt & grønt': 5,
  'Brød & bakst': 4,
  'Tørrvarer & annet': 365,
  Drikkevarer: 180,
  Husholdning: 730,
  Barn: 365,
  'Personlig pleie': 730,
};

function estimateShelfDays(product, overrideCategory = null) {
  if (product?.shelfDays) return product.shelfDays;
  const cat = overrideCategory || product?.category;
  if (cat && CATEGORY_SHELF_DAYS[cat]) return CATEGORY_SHELF_DAYS[cat];
  return 14; // safe default
}

function calculateExpiresEst(product, providedDays, overrideCategory) {
  const days = providedDays ?? estimateShelfDays(product, overrideCategory);
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

// ============================================================
// Manual add
// ============================================================

/**
 * Add an item to pantry manually. Used by the "add to pantry" UI and
 * by LLM tool-call (add_to_pantry).
 *
 * @param {Object} repos
 * @param {Object} opts
 * @param {string} opts.productKey
 * @param {number} opts.qty
 * @param {string} [opts.unit]
 * @param {number} [opts.shelfDays]     — override computed shelf life
 * @param {string} [opts.expiresEst]    — override with explicit date
 * @param {string} [opts.category]      — fallback if product is unknown
 * @param {string} [opts.notes]
 * @param {string} [opts.reason='manual'] — 'manual' | 'initial_seed' | 'correction'
 */
function addToPantry(repos, opts) {
  const {
    productKey,
    qty,
    total,
    unit,
    shelfDays,
    expiresEst: explicitExpires,
    category,
    notes,
    reason = 'manual',
  } = opts;

  if (!productKey || !Number.isFinite(qty) || qty <= 0) {
    throw new Error('productKey and positive qty are required');
  }

  // Phase F2: validate unit if provided. If not provided, use product.unit or 'stk'.
  let resolvedUnit;
  if (unit) {
    try {
      resolvedUnit = units.validateUnit(unit);
    } catch (err) {
      throw new Error(err.message, { cause: err });
    }
  }

  const product = repos.products.getByKey(productKey) || null;
  if (!resolvedUnit) {
    resolvedUnit = product?.unit || 'stk';
    // If product.unit is an invalid format, fall back to 'stk'
    if (!units.isAllowedUnit(resolvedUnit)) resolvedUnit = 'stk';
  }
  const expiresEst = explicitExpires || calculateExpiresEst(product, shelfDays, category);

  const tx = repos.transaction(() => {
    const { prev, next } = repos.inventory.upsertManual(productKey, {
      qtyAdded: qty,
      unit: resolvedUnit,
      expiresEst,
      incrementPurchaseCount: reason === 'manual',
    });
    // Phase F2: if total is provided, store it. Otherwise keep existing total.
    if (Number.isFinite(total) && total > 0) {
      repos.inventory.setTotalSize(productKey, total);
    }
    const prevQty = prev?.qtyRemaining || 0;
    const newQty = next?.qtyRemaining || prevQty + qty;
    repos.inventoryLog.insert({
      productKey,
      qtyDelta: qty,
      newQty,
      unit: resolvedUnit,
      reason,
      notes: notes || null,
    });
    return next;
  });
  const result = tx();

  logger.info(
    { productKey, qty, total, unit: resolvedUnit, reason, expiresEst },
    'pantry: manual add'
  );
  return {
    productKey,
    qtyRemaining: result?.qtyRemaining ?? qty,
    totalSize: total ?? result?.totalSize ?? null,
    unit: resolvedUnit,
    expiresEst,
    reason,
  };
}

/**
 * Correct quantity (may be positive or negative). Always writes an
 * audit log with reason='correction'.
 */
function correctQty(repos, { productKey, newQty, newTotal, newUnit, notes }) {
  if (!productKey || !Number.isFinite(newQty) || newQty < 0) {
    throw new Error('productKey and non-negative newQty are required');
  }

  // Phase F2: validate newUnit if provided
  let resolvedUnit = null;
  if (newUnit) {
    try {
      resolvedUnit = units.validateUnit(newUnit);
    } catch (err) {
      throw new Error(err.message, { cause: err });
    }
  }

  const existing = repos.inventory.getByKey(productKey);
  const prevQty = existing?.qtyRemaining || 0;
  const delta = newQty - prevQty;
  const effectiveUnit = resolvedUnit || existing?.unit || '';

  const tx = repos.transaction(() => {
    if (!existing) {
      repos.inventory.upsertManual(productKey, {
        qtyAdded: newQty,
        unit: effectiveUnit,
        incrementPurchaseCount: false,
      });
    } else if (delta !== 0 || resolvedUnit) {
      repos._db
        .prepare(
          `
        UPDATE inventory
           SET qty_remaining = ?,
               unit = CASE WHEN ? = '' THEN unit ELSE ? END,
               updated_at = datetime('now')
         WHERE product_key = ?
      `
        )
        .run(newQty, resolvedUnit || '', resolvedUnit || '', productKey);
    }
    // Phase F2: update total_size if provided
    if (Number.isFinite(newTotal) && newTotal > 0) {
      repos.inventory.setTotalSize(productKey, newTotal);
    }
    repos.inventoryLog.insert({
      productKey,
      qtyDelta: delta,
      newQty,
      unit: effectiveUnit,
      reason: 'correction',
      notes: notes || null,
    });
  });
  tx();
  logger.info(
    { productKey, prevQty, newQty, newTotal, newUnit: resolvedUnit, delta },
    'pantry: correction'
  );

  // Phase F2: check low-stock and trigger auto-add to shopping list
  const afterState = repos.inventory.getByKey(productKey);
  const total = afterState?.totalSize;
  const lowResult = checkAndTriggerLowStock(repos, productKey, newQty, total);

  return {
    productKey,
    prevQty,
    newQty,
    newTotal,
    newUnit: resolvedUnit,
    delta,
    lowStock: lowResult,
  };
}

/**
 * Phase F2 — low-stock check.
 *
 * If qty/total < LOW_THRESHOLD and the item is not already on the active
 * shopping list, add it. Returns a small report for audit.
 */
function checkAndTriggerLowStock(repos, productKey, qty, total) {
  if (!Number.isFinite(total) || total <= 0) return { triggered: false, reason: 'no-total' };
  const isLow = units.isLowStock(qty, total);
  if (!isLow) return { triggered: false, reason: 'above-threshold' };

  // Find active shopping list
  try {
    if (!repos.shoppingLists || typeof repos.shoppingLists.getActive !== 'function') {
      return { triggered: false, reason: 'no-shopping-list-repo' };
    }
    // shopping.repo.js getActive(weekYear) requires the current
    // ISO week-year. Earlier code called it without the argument,
    // which silently returned null and made the auto-add path
    // a no-op. Resolve weekYear from the same helper that
    // ensureCurrentWeek uses so the trigger fires for the active week.
    const weekYear = seed.getWeekYear();
    const active = repos.shoppingLists.getActive(weekYear);
    if (!active) return { triggered: false, reason: 'no-active-list' };

    // Check whether the item is already on the list. _getItems wraps
    // the items into an enriched shape with productKey on top level.
    const existingItems = active.items || [];
    const alreadyThere = existingItems.some(
      (i) => i.productKey === productKey || i.product_key === productKey
    );
    if (alreadyThere) return { triggered: false, reason: 'already-on-list' };

    // Add it. shopping.repo.addItem uses positional (listId, opts) —
    // the previous single-object call was a latent bug that swallowed
    // every low-stock add. The 'auto:low-stock' notes marker lets the
    // shopping UI render a "Suggested from pantry" badge without any
    // schema changes.
    if (typeof repos.shoppingLists.addItem === 'function') {
      const product = repos.products.getByKey(productKey);
      repos.shoppingLists.addItem(active.id, {
        name: product?.product_name || productKey,
        qty: 1,
        unit: product?.unit || 'stk',
        category: product?.category || null,
        notes: 'auto:low-stock',
        productKey,
      });
      logger.info(
        { productKey, qty, total, ratio: qty / total, listId: active.id },
        'pantry: low-stock → added to shopping list'
      );
      return { triggered: true, listId: active.id };
    }
    return { triggered: false, reason: 'no-addItem-method' };
  } catch (err) {
    logger.warn({ err: err.message, productKey }, 'pantry: low-stock trigger failed');
    return { triggered: false, reason: 'error', error: err.message };
  }
}

/**
 * Remove expired items: set qty_remaining=0 for all with expires_est <
 * today's date. Writes inventory_log with reason='shelf_life_expired'.
 * Returns the number removed.
 */
function removeExpired(repos) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const inventoryMap = repos.inventory.getAll();
  let removed = 0;

  const tx = repos.transaction(() => {
    for (const [key, inv] of Object.entries(inventoryMap)) {
      if (!inv.expiresEst || !inv.qtyRemaining || inv.qtyRemaining <= 0) continue;
      if (inv.expiresEst > todayStr) continue;
      const qtyRemoved = inv.qtyRemaining;
      repos._db
        .prepare(
          `
        UPDATE inventory SET qty_remaining = 0, updated_at = datetime('now')
        WHERE product_key = ?
      `
        )
        .run(key);
      repos.inventoryLog.insert({
        productKey: key,
        qtyDelta: -qtyRemoved,
        newQty: 0,
        unit: inv.unit || '',
        reason: 'shelf_life_expired',
        notes: `Expired ${inv.expiresEst}`,
      });
      removed++;
    }
  });
  tx();
  if (removed > 0) {
    logger.info({ removed, asOf: todayStr }, 'pantry: expired items removed');
  }
  return removed;
}

module.exports = {
  addToPantry,
  correctQty,
  removeExpired,
  estimateShelfDays,
  calculateExpiresEst,
  CATEGORY_SHELF_DAYS,
};
