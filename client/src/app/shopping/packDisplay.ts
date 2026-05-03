// Format helpers for the shopping-row pack-aware display (pilot
// 2026-05-03). Pure functions, no React dependencies, so they are
// trivially unit-tested and can be reused if other surfaces need the
// same formatting.
//
// Backend already populates pack_size / pack_unit / pack_count /
// est_price on every meal_ingredient and consumable row. The frontend
// previously rendered only `qty + unit` ("220 g"); the pilot needs the
// pack framing ("1 pakke (500 g) · 89 kr · Du trenger 220 g") so the
// user sees what to grab from the shelf vs what the recipe actually
// uses, which makes the leftover-into-pantry flow visible.
//
// All functions are tolerant of partial data: when pack_size is
// missing, the helpers fall back to plain qty/unit and the row stays
// readable.

export interface PackDisplayInput {
  /** What the recipe actually consumes — null for manual/extra rows. */
  qty: number | null;
  unit: string | null;
  /** Vendor pack size for one unit at the store (e.g., 500 g). */
  packSize: number | null;
  /** Pack unit (g, kg, ml, l, stk, pk, ...). */
  packUnit: string | null;
  /**
   * Number of packs to buy = ceil(stillNeed / packSize). 0 when the
   * pantry already covers the recipe and we don't need to buy any.
   */
  packCount: number | null;
  /** Total estimated price for the row (already pack-multiplied). */
  estPrice: number | null;
}

const WEIGHT_UNITS = new Set(['g', 'gram']);
const HEAVY_WEIGHT_UNITS = new Set(['kg']);
const VOLUME_UNITS = new Set(['ml', 'cl', 'dl']);
const HEAVY_VOLUME_UNITS = new Set(['l', 'liter']);
const COUNT_UNITS = new Set(['stk', 'pk', 'fedd', 'boks', 'pose']);

/**
 * Round a numeric value for human display. Strips floating-point
 * artifacts (220.00000000000003 → 220) and chooses sensible precision
 * per unit family:
 *   - count units (stk, pk, fedd): integer
 *   - small weight (g): integer
 *   - heavy weight (kg): up to 2 decimals, trailing zeros stripped
 *   - small volume (ml, cl, dl): integer
 *   - heavy volume (l): 1 decimal, trailing zero stripped
 *   - other (ss, ts, klyper): 1 decimal, trailing zero stripped
 */
export function formatNumberForUnit(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) return '';
  const u = (unit || '').toLowerCase().trim();

  if (COUNT_UNITS.has(u)) {
    return String(Math.round(value));
  }
  if (WEIGHT_UNITS.has(u)) {
    return String(Math.round(value));
  }
  if (HEAVY_WEIGHT_UNITS.has(u)) {
    return stripTrailingZero(value.toFixed(2));
  }
  if (VOLUME_UNITS.has(u)) {
    return String(Math.round(value));
  }
  if (HEAVY_VOLUME_UNITS.has(u)) {
    return stripTrailingZero(value.toFixed(1));
  }
  // Tablespoons, teaspoons, pinches, etc. — keep one decimal but
  // collapse 1.0 → "1".
  return stripTrailingZero(value.toFixed(1));
}

function stripTrailingZero(decimalStr: string): string {
  if (!decimalStr.includes('.')) return decimalStr;
  return decimalStr.replace(/\.?0+$/, '');
}

/**
 * Cross-unit-family conversion to a single display unit when it makes
 * sense. The shopping list mixes recipe qty (often small g) and pack
 * size (often kg). We coerce to the larger unit when the recipe value
 * is ≥1000 g, so "1.2 kg" reads better than "1200 g".
 *
 * Returns the value paired with the unit string to display. The caller
 * is responsible for placing them in the localised template.
 */
export function normaliseQtyForDisplay(
  value: number,
  unit: string | null
): { value: number; unit: string } {
  const u = (unit || '').toLowerCase().trim();
  if (WEIGHT_UNITS.has(u) && value >= 1000) {
    return { value: value / 1000, unit: 'kg' };
  }
  if (VOLUME_UNITS.has(u) && u === 'ml' && value >= 1000) {
    return { value: value / 1000, unit: 'l' };
  }
  return { value, unit: u };
}

/**
 * Optional translator for unit labels (g/kg/ml/l/stk/ss/ts/fedd/pk/...).
 * The component layer passes a callback that wraps i18next's `t()` so
 * this module stays free of React/i18n imports.
 *
 * Falls back to the unit string itself when no translator is provided
 * — keeps the helpers easy to test and preserves legacy behavior for
 * any caller that does not need localisation.
 */
export type UnitFormatter = (rawUnit: string) => string;

/**
 * Format a (qty, unit) tuple for display. Returns the empty string
 * when both inputs are null/empty. Pass `unitFormatter` to localise
 * the unit (e.g., "stk" → "pcs" on English).
 */
export function formatQtyWithUnit(
  qty: number | null,
  unit: string | null,
  options: { unitFormatter?: UnitFormatter } = {}
): string {
  const fmt = options.unitFormatter;
  if (qty == null && !unit) return '';
  if (qty == null) return fmt ? fmt(unit || '') : unit || '';
  const norm = normaliseQtyForDisplay(qty, unit);
  const num = formatNumberForUnit(norm.value, norm.unit);
  const finalUnit = fmt ? fmt(norm.unit) : norm.unit;
  return num && finalUnit ? `${num} ${finalUnit}` : num || finalUnit;
}

/**
 * Whether the pack/qty data warrants a "you need X" sub-line. Returns
 * false when:
 *   - the pack covers the recipe exactly (pack_size === recipe qty)
 *   - we have no recipe qty to compare against
 *   - the source is not a recipe-driven row (manual/extra/consumable)
 */
export function shouldShowYouNeedLine(item: PackDisplayInput, sourceType: string): boolean {
  if (sourceType !== 'meal_ingredient') return false;
  if (item.qty == null || !Number.isFinite(item.qty)) return false;
  if (item.packSize == null || !Number.isFinite(item.packSize) || item.packSize <= 0) return false;
  // If the recipe needs ~one full pack (within 1% rounding), the
  // sub-line is redundant — the user is buying the exact amount.
  const ratio = item.qty / item.packSize;
  if (Math.abs(ratio - 1) < 0.01) return false;
  // Multi-pack purchases where packs * size ~= qty are also a no-op
  // ("Du trenger 1000 g" alongside "2 pakker (500 g)" carries info
  // about the recipe even at the boundary, so we keep it).
  return true;
}

/**
 * Whether a pack-info line should render at all. Manual/extra rows
 * have no pack metadata; consumables sometimes do, sometimes do not.
 */
export function hasUsablePackInfo(item: PackDisplayInput): boolean {
  return (
    item.packCount != null &&
    item.packCount > 0 &&
    item.packSize != null &&
    item.packSize > 0 &&
    !!item.packUnit
  );
}
