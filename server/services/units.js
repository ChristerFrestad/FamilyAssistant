/**
 * Fase F2 – Units-validator og pantry-ratio-beregning.
 *
 * Whitelist av enheter som støttes i pantry/progress-bar.
 * Alt annet avvises med klar feilmelding.
 */

const ALLOWED_UNITS = ['g', 'kg', 'ml', 'dl', 'l', 'stk'];

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

function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'stk';
  const lower = unit.toLowerCase().trim();
  return UNIT_ALIASES[lower] || lower;
}

function validateUnit(unit) {
  const norm = normalizeUnit(unit);
  if (!ALLOWED_UNITS.includes(norm)) {
    throw new Error(
      `Ugyldig enhet '${unit}'. Tillatt: ${ALLOWED_UNITS.join(', ')}`
    );
  }
  return norm;
}

function isAllowedUnit(unit) {
  try {
    validateUnit(unit);
    return true;
  } catch {
    return false;
  }
}

/**
 * Beregn forhold mellom gjenstående og total.
 * Returnerer null hvis total mangler eller er 0.
 */
function calculateRatio(qty, total) {
  const q = parseFloat(qty);
  const t = parseFloat(total);
  if (!Number.isFinite(q) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(1, q / t));
}

/**
 * Sjekker om varen er under lav-terskel (default 15%).
 * Returnerer:
 *   null  — ingen total satt, kan ikke vurderes
 *   false — over terskel
 *   true  — under terskel (→ bør legges til handleliste)
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
