// Unit tests for packDisplay helpers. Pure functions — no React, no
// i18n. We test the rounding rules, edge cases, and the predicates
// that drive the row layout.

import { describe, test, expect } from 'vitest';
import {
  formatNumberForUnit,
  normaliseQtyForDisplay,
  formatQtyWithUnit,
  shouldShowYouNeedLine,
  hasUsablePackInfo,
} from './packDisplay';

describe('formatNumberForUnit', () => {
  test('strips floating-point artifacts on grams', () => {
    expect(formatNumberForUnit(220.00000000000003, 'g')).toBe('220');
    expect(formatNumberForUnit(110.00000000000001, 'g')).toBe('110');
  });

  test('rounds count units to integer', () => {
    expect(formatNumberForUnit(1, 'stk')).toBe('1');
    expect(formatNumberForUnit(2.4, 'stk')).toBe('2');
    expect(formatNumberForUnit(3.6, 'stk')).toBe('4');
    expect(formatNumberForUnit(1, 'fedd')).toBe('1');
    expect(formatNumberForUnit(1, 'pk')).toBe('1');
  });

  test('rounds small weights (g) to integer', () => {
    expect(formatNumberForUnit(220, 'g')).toBe('220');
    expect(formatNumberForUnit(220.5, 'g')).toBe('221');
  });

  test('formats heavy weights (kg) with up to 2 decimals, no trailing zeros', () => {
    expect(formatNumberForUnit(1, 'kg')).toBe('1');
    expect(formatNumberForUnit(1.5, 'kg')).toBe('1.5');
    expect(formatNumberForUnit(1.2, 'kg')).toBe('1.2');
    expect(formatNumberForUnit(1.25, 'kg')).toBe('1.25');
    expect(formatNumberForUnit(1.0, 'kg')).toBe('1');
  });

  test('rounds small volumes (ml) to integer', () => {
    expect(formatNumberForUnit(220, 'ml')).toBe('220');
    expect(formatNumberForUnit(220.5, 'ml')).toBe('221');
  });

  test('formats heavy volumes (l) with 1 decimal, no trailing zero', () => {
    expect(formatNumberForUnit(1, 'l')).toBe('1');
    expect(formatNumberForUnit(1.5, 'l')).toBe('1.5');
    expect(formatNumberForUnit(0.5, 'l')).toBe('0.5');
  });

  test('formats tablespoons/teaspoons with 1 decimal stripped', () => {
    expect(formatNumberForUnit(1, 'ss')).toBe('1');
    expect(formatNumberForUnit(1.1, 'ss')).toBe('1.1');
    expect(formatNumberForUnit(1.5, 'ts')).toBe('1.5');
  });

  test('returns empty string for non-finite values', () => {
    expect(formatNumberForUnit(NaN, 'g')).toBe('');
    expect(formatNumberForUnit(Infinity, 'g')).toBe('');
  });
});

describe('normaliseQtyForDisplay', () => {
  test('keeps small weights in grams', () => {
    expect(normaliseQtyForDisplay(220, 'g')).toEqual({ value: 220, unit: 'g' });
  });

  test('promotes ≥1000 g to kg', () => {
    expect(normaliseQtyForDisplay(1500, 'g')).toEqual({ value: 1.5, unit: 'kg' });
    expect(normaliseQtyForDisplay(1000, 'g')).toEqual({ value: 1, unit: 'kg' });
  });

  test('promotes ≥1000 ml to l', () => {
    expect(normaliseQtyForDisplay(1500, 'ml')).toEqual({ value: 1.5, unit: 'l' });
  });

  test('lowercases the unit', () => {
    expect(normaliseQtyForDisplay(220, 'G')).toEqual({ value: 220, unit: 'g' });
  });
});

describe('formatQtyWithUnit', () => {
  test('combines qty and unit', () => {
    expect(formatQtyWithUnit(220, 'g')).toBe('220 g');
    expect(formatQtyWithUnit(1500, 'g')).toBe('1.5 kg');
    expect(formatQtyWithUnit(1, 'stk')).toBe('1 stk');
  });

  test('returns empty for null inputs', () => {
    expect(formatQtyWithUnit(null, null)).toBe('');
  });

  test('falls back to unit only when qty is null', () => {
    expect(formatQtyWithUnit(null, 'kg')).toBe('kg');
  });

  test('falls back to qty only when unit is missing', () => {
    expect(formatQtyWithUnit(3, null)).toBe('3');
  });
});

describe('hasUsablePackInfo', () => {
  test('true when pack_count, pack_size, pack_unit are all set', () => {
    expect(
      hasUsablePackInfo({
        qty: 220,
        unit: 'g',
        packSize: 500,
        packUnit: 'g',
        packCount: 1,
        estPrice: 89,
      })
    ).toBe(true);
  });

  test('false when packCount is 0 (pantry already covers it)', () => {
    expect(
      hasUsablePackInfo({
        qty: 220,
        unit: 'g',
        packSize: 500,
        packUnit: 'g',
        packCount: 0,
        estPrice: null,
      })
    ).toBe(false);
  });

  test('false when packSize is null (manual / extra row)', () => {
    expect(
      hasUsablePackInfo({
        qty: 3,
        unit: 'stk',
        packSize: null,
        packUnit: null,
        packCount: 3,
        estPrice: null,
      })
    ).toBe(false);
  });
});

describe('shouldShowYouNeedLine', () => {
  const target = {
    qty: 220,
    unit: 'g',
    packSize: 500,
    packUnit: 'g',
    packCount: 1,
    estPrice: 89,
  };

  test('true for meal_ingredient where recipe needs less than a pack', () => {
    expect(shouldShowYouNeedLine(target, 'meal_ingredient')).toBe(true);
  });

  test('false when source is manual', () => {
    expect(shouldShowYouNeedLine(target, 'manual')).toBe(false);
  });

  test('false when source is consumable', () => {
    expect(shouldShowYouNeedLine(target, 'consumable')).toBe(false);
  });

  test('false when qty == pack_size (no leftover)', () => {
    expect(shouldShowYouNeedLine({ ...target, qty: 500, packSize: 500 }, 'meal_ingredient')).toBe(
      false
    );
  });

  test('true when recipe needs more than a pack (multi-pack purchase)', () => {
    // 1.5 packs needed → ceil to 2; "Du trenger 750 g" still adds info
    // about the recipe vs the 1000 g being bought.
    expect(
      shouldShowYouNeedLine({ ...target, qty: 750, packSize: 500, packCount: 2 }, 'meal_ingredient')
    ).toBe(true);
  });

  test('false when packSize is null', () => {
    expect(shouldShowYouNeedLine({ ...target, packSize: null }, 'meal_ingredient')).toBe(false);
  });

  test('false when qty is null', () => {
    expect(shouldShowYouNeedLine({ ...target, qty: null }, 'meal_ingredient')).toBe(false);
  });
});
