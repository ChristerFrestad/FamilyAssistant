// @ts-check
/**
 * Phase F2 — Units validator and pantry ratio calculation.
 *
 * Whitelist of units supported in pantry/progress-bar.
 * Anything else is rejected with a clear error message.
 */

/** @type {readonly string[]} */
const ALLOWED_UNITS = ['g', 'kg', 'ml', 'dl', 'l', 'stk'];

/** @type {Record<string, string>} */
// Conversion of compatible unit pairs (for ratio calculation qty and
// total must share the same unit)
const UNIT_ALIASES = {
  gr: 'g',
  gram: 'g',
  kilogram: 'kg',
  milliliter: 'ml',
  liter: 'l',
  stykker: 'stk',
  stk: 'stk',
  pcs: 'stk',
};

const LOW_THRESHOLD = 0.15; // Below 15% = low stock

/**
 * Normalise a unit string via the aliases mapping.
 * @param {unknown} unit
 * @returns {string} Normalised unit, or 'stk' as fallback
 */
function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'stk';
  const lower = unit.toLowerCase().trim();
  return UNIT_ALIASES[lower] || lower;
}

/**
 * Validate a unit against the whitelist. Throws on invalid.
 * @param {unknown} unit
 * @returns {string} Valid normalised unit
 * @throws {Error} If the unit is not in ALLOWED_UNITS
 */
function validateUnit(unit) {
  const norm = normalizeUnit(unit);
  if (!ALLOWED_UNITS.includes(norm)) {
    throw new Error(`Invalid unit '${String(unit)}'. Allowed: ${ALLOWED_UNITS.join(', ')}`);
  }
  return norm;
}

/**
 * @param {unknown} unit
 * @returns {boolean} True if the unit validates without throwing
 */
function isAllowedUnit(unit) {
  try {
    validateUnit(unit);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute the ratio between remaining and total (0-1 clamped).
 * @param {number|string} qty
 * @param {number|string} total
 * @returns {number|null} null if total is missing or zero
 */
function calculateRatio(qty, total) {
  const q = parseFloat(String(qty));
  const t = parseFloat(String(total));
  if (!Number.isFinite(q) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(1, q / t));
}

/**
 * Check whether the item is below the low-stock threshold (default 15%).
 * @param {number|string} qty
 * @param {number|string} total
 * @param {number} [threshold=0.15]
 * @returns {boolean|null} null = no total set, false = above threshold,
 *     true = below threshold
 */
function isLowStock(qty, total, threshold = LOW_THRESHOLD) {
  const ratio = calculateRatio(qty, total);
  if (ratio === null) return null;
  return ratio < threshold;
}

module.exports = {
  ALLOWED_UNITS,
  LOW_THRESHOLD,
  normalizeUnit,
  validateUnit,
  isAllowedUnit,
  calculateRatio,
  isLowStock,
};
