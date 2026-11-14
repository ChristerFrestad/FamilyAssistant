'use strict';

// Kitchen units used when a recipe and the pantry disagree.
// Mass and volume convert. Spoons are millilitres (1 ss = 15 ml,
// 1 ts = 5 ml). Counts stay counts. A different dimension does not convert.

const MASS_TO_G = {
  g: 1,
  gr: 1,
  gram: 1,
  kg: 1000,
  kilogram: 1000,
};

const VOLUME_TO_ML = {
  ml: 1,
  milliliter: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  ts: 5,
  teskje: 5,
  teskjeer: 5,
  tsp: 5,
  ss: 15,
  spiseskje: 15,
  spiseskjeer: 15,
  tbsp: 15,
};

const COUNT_TO_STK = {
  stk: 1,
  stykk: 1,
  stykker: 1,
  pcs: 1,
};

/**
 * @param {unknown} unit
 * @returns {'g'|'ml'|'stk'|null}
 */
function canonicalUnit(unit) {
  const key = String(unit || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(MASS_TO_G, key)) return 'g';
  if (Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, key)) return 'ml';
  if (Object.prototype.hasOwnProperty.call(COUNT_TO_STK, key)) return 'stk';
  return null;
}

/**
 * @param {unknown} qty
 * @param {unknown} unit
 * @returns {{ qty: number, unit: 'g'|'ml'|'stk' }|null}
 */
function toCanonical(qty, unit) {
  const key = String(unit || '')
    .trim()
    .toLowerCase();
  const amount = Number(qty);
  if (!key || !Number.isFinite(amount)) return null;
  if (Object.prototype.hasOwnProperty.call(MASS_TO_G, key)) {
    return { qty: amount * MASS_TO_G[key], unit: 'g' };
  }
  if (Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, key)) {
    return { qty: amount * VOLUME_TO_ML[key], unit: 'ml' };
  }
  if (Object.prototype.hasOwnProperty.call(COUNT_TO_STK, key)) {
    return { qty: amount * COUNT_TO_STK[key], unit: 'stk' };
  }
  return null;
}

/**
 * Convert qty from one unit to another. Returns null when the units
 * are not the same kind of measure.
 * @param {unknown} qty
 * @param {unknown} fromUnit
 * @param {unknown} toUnit
 * @returns {number|null}
 */
function convertQuantity(qty, fromUnit, toUnit) {
  const from = toCanonical(qty, fromUnit);
  const one = toCanonical(1, toUnit);
  if (!from || !one || from.unit !== one.unit || one.qty === 0) return null;
  return from.qty / one.qty;
}

module.exports = { canonicalUnit, toCanonical, convertQuantity };
