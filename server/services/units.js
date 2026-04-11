// @ts-check
/**
 * Fase F2 – Units-validator og pantry-ratio-beregning.
 *
 * Whitelist av enheter som støttes i pantry/progress-bar.
 * Alt annet avvises med klar feilmelding.
 */

/** @type {readonly string[]} */
const ALLOWED_UNITS = ['g', 'kg', 'ml', 'dl', 'l', 'stk'];

/** @type {Record<string, string>} */
// Konvertering av kompatible enhetspar (ved ratio-beregning må qty og total ha samme enhet)
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

const LOW_THRESHOLD = 0.15; // Under 15% = lav beholdning

/**
 * Normaliser enhet-streng via aliases-mapping.
 * @param {unknown} unit
 * @returns {string} Normalisert enhet, eller 'stk' som fallback
 */
function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'stk';
  const lower = unit.toLowerCase().trim();
  return UNIT_ALIASES[lower] || lower;
}

/**
 * Validerer enhet mot whitelist. Kaster Error ved ugyldig.
 * @param {unknown} unit
 * @returns {string} Gyldig normalisert enhet
 * @throws {Error} Hvis enheten ikke er i ALLOWED_UNITS
 */
function validateUnit(unit) {
  const norm = normalizeUnit(unit);
  if (!ALLOWED_UNITS.includes(norm)) {
    throw new Error(`Ugyldig enhet '${String(unit)}'. Tillatt: ${ALLOWED_UNITS.join(', ')}`);
  }
  return norm;
}

/**
 * @param {unknown} unit
 * @returns {boolean} True hvis enheten validerer uten å kaste
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
 * Beregn forhold mellom gjenstående og total (0-1 clamped).
 * @param {number|string} qty
 * @param {number|string} total
 * @returns {number|null} null hvis total mangler eller er 0
 */
function calculateRatio(qty, total) {
  const q = parseFloat(String(qty));
  const t = parseFloat(String(total));
  if (!Number.isFinite(q) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(1, q / t));
}

/**
 * Sjekker om varen er under lav-terskel (default 15%).
 * @param {number|string} qty
 * @param {number|string} total
 * @param {number} [threshold=0.15]
 * @returns {boolean|null} null = ingen total satt, false = over terskel, true = under terskel
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
