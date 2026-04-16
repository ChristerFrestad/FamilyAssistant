// Pantry service (Iterasjon 1 + Fase F2)
//
// Ansvar:
//   1. Legge til varer i pantry manuelt med auto-beregnet holdbarhet
//   2. Justere mengde (korrigering) med audit-log
//   3. Fjerne utløpte varer med audit-log
//   4. (F2) Lagre total_size og trigge lav-beholdning til handleliste
//
// Alle endringer skriver en inventory_log-rad slik at vi kan svare på
// "hvorfor er det mel her?" og "hva har forsvunnet fra pantry uten at
// vi har kjøpt det på nytt?".
//
// Service er stateless — tar repos som parameter og returnerer objekt.

const { logger } = require('../logger');
const units = require('./units');

// ============================================================
// Holdbarhet-estimering
// ============================================================

/**
 * Heuristikk for auto-beregnet holdbarhet når brukeren ikke oppgir
 * en eksplisitt expires-dato. Primærkilde er products.shelf_days hvis
 * produktet eksisterer. Fallback er kategori-heuristikk.
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
  return 14; // sikker default
}

function calculateExpiresEst(product, providedDays, overrideCategory) {
  const days = providedDays ?? estimateShelfDays(product, overrideCategory);
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

// ============================================================
// Manual add
// ============================================================

/**
 * Legg til en vare i pantry manuelt. Brukes av "legg til i pantry"-UI
 * og av LLM-tool-call (add_to_pantry).
 *
 * @param {Object} repos
 * @param {Object} opts
 * @param {string} opts.productKey
 * @param {number} opts.qty
 * @param {string} [opts.unit]
 * @param {number} [opts.shelfDays]     — overstyr beregnet holdbarhet
 * @param {string} [opts.expiresEst]    — overstyr med eksplisitt dato
 * @param {string} [opts.category]      — fallback hvis produktet er ukjent
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
    throw new Error('productKey og positiv qty er påkrevd');
  }

  // Fase F2: valider enhet hvis oppgitt. Hvis ikke oppgitt, bruk product.unit eller 'stk'.
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
    // Hvis product.unit er et ugyldig format, fall tilbake til 'stk'
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
    // Fase F2: hvis total er oppgitt, lagre den. Ellers behold eksisterende total.
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
 * Korriger mengde (kan være positiv eller negativ). Skriver alltid
 * audit-logg med reason='correction'.
 */
function correctQty(repos, { productKey, newQty, newTotal, newUnit, notes }) {
  if (!productKey || !Number.isFinite(newQty) || newQty < 0) {
    throw new Error('productKey og non-negativ newQty er påkrevd');
  }

  // Fase F2: valider newUnit hvis oppgitt
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
    // Fase F2: oppdater total_size hvis oppgitt
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

  // Fase F2: sjekk lav-beholdning og trigger auto-add til handleliste
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
 * Fase F2 – Lav-beholdning-sjekk.
 *
 * Hvis qty/total < LOW_THRESHOLD og varen ikke allerede er på aktiv
 * handleliste, legg den til. Returnerer en liten rapport for audit.
 */
function checkAndTriggerLowStock(repos, productKey, qty, total) {
  if (!Number.isFinite(total) || total <= 0) return { triggered: false, reason: 'no-total' };
  const isLow = units.isLowStock(qty, total);
  if (!isLow) return { triggered: false, reason: 'above-threshold' };

  // Finn aktiv handleliste
  try {
    if (!repos.shoppingLists || typeof repos.shoppingLists.getActive !== 'function') {
      return { triggered: false, reason: 'no-shopping-list-repo' };
    }
    const active = repos.shoppingLists.getActive();
    if (!active) return { triggered: false, reason: 'no-active-list' };

    // Sjekk om varen allerede er på listen
    const existingItems = repos.shoppingLists.getItems(active.id) || [];
    const alreadyThere = existingItems.some(
      (i) => i.productKey === productKey || i.product_key === productKey
    );
    if (alreadyThere) return { triggered: false, reason: 'already-on-list' };

    // Legg til
    if (typeof repos.shoppingLists.addItem === 'function') {
      const product = repos.products.getByKey(productKey);
      repos.shoppingLists.addItem({
        listId: active.id,
        productKey,
        ingredientName: product?.product_name || productKey,
        quantity: 1,
        unit: product?.unit || 'stk',
        category: product?.category || null,
        source: 'low-stock-trigger',
        needsBuy: 1,
        pantryHas: 0,
      });
      logger.info(
        { productKey, qty, total, ratio: qty / total },
        'pantry: lav-beholdning → lagt til handleliste'
      );
      return { triggered: true, listId: active.id };
    }
    return { triggered: false, reason: 'no-addItem-method' };
  } catch (err) {
    logger.warn({ err: err.message, productKey }, 'pantry: lav-beholdning-trigger feilet');
    return { triggered: false, reason: 'error', error: err.message };
  }
}

/**
 * Fjern utløpte varer: sett qty_remaining=0 for alle med expires_est < dagens dato.
 * Skriver inventory_log med reason='shelf_life_expired'.
 * Returnerer antall fjernet.
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
