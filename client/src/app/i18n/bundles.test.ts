// Smoke tests for the i18n setup itself: every namespace resolves
// in both bundles, and key parity holds across NO and EN. These
// tests guard against drift — if someone adds a key to no/auth.json
// but forgets to mirror it in en/auth.json, the matching test
// fails before review.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import i18n, { NAMESPACES, SUPPORTED_LANGUAGES } from './config';

import noCommon from './locales/no/common.json';
import noAuth from './locales/no/auth.json';
import noDashboard from './locales/no/dashboard.json';
import noFamily from './locales/no/family.json';
import noMeals from './locales/no/meals.json';
import noRecipes from './locales/no/recipes.json';
import noShopping from './locales/no/shopping.json';
import noCalendar from './locales/no/calendar.json';
import noSettings from './locales/no/settings.json';
import noPantry from './locales/no/pantry.json';
import noAdmin from './locales/no/admin.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';
import enFamily from './locales/en/family.json';
import enMeals from './locales/en/meals.json';
import enRecipes from './locales/en/recipes.json';
import enShopping from './locales/en/shopping.json';
import enCalendar from './locales/en/calendar.json';
import enSettings from './locales/en/settings.json';
import enPantry from './locales/en/pantry.json';
import enAdmin from './locales/en/admin.json';

const NO_BUNDLES: Record<string, unknown> = {
  common: noCommon,
  auth: noAuth,
  dashboard: noDashboard,
  family: noFamily,
  meals: noMeals,
  recipes: noRecipes,
  shopping: noShopping,
  calendar: noCalendar,
  settings: noSettings,
  pantry: noPantry,
  admin: noAdmin,
};

const EN_BUNDLES: Record<string, unknown> = {
  common: enCommon,
  auth: enAuth,
  dashboard: enDashboard,
  family: enFamily,
  meals: enMeals,
  recipes: enRecipes,
  shopping: enShopping,
  calendar: enCalendar,
  settings: enSettings,
  pantry: enPantry,
  admin: enAdmin,
};

// Recursively flatten a nested translation object to dot-paths so
// we can compare the *shape* of two bundles. Values are deliberately
// dropped — we only care that every key on the NO side has a
// corresponding key on the EN side, and vice versa.
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

describe('i18n setup', () => {
  test('config exports both supported languages and all eleven namespaces', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['no', 'en']);
    expect(NAMESPACES.length).toBe(11);
    expect(new Set(NAMESPACES)).toEqual(
      new Set([
        'common',
        'auth',
        'dashboard',
        'family',
        'meals',
        'recipes',
        'shopping',
        'calendar',
        'settings',
        'pantry',
        'admin',
      ])
    );
  });

  test.each(NAMESPACES)('NO and EN bundles have identical key shape: %s namespace', (ns) => {
    const noKeys = flattenKeys(NO_BUNDLES[ns]);
    const enKeys = flattenKeys(EN_BUNDLES[ns]);
    // Symmetric difference — every key must exist on both sides.
    const onlyNo = noKeys.filter((k) => !enKeys.includes(k));
    const onlyEn = enKeys.filter((k) => !noKeys.includes(k));
    expect(onlyNo, `Keys present in NO but missing in EN (${ns})`).toEqual([]);
    expect(onlyEn, `Keys present in EN but missing in NO (${ns})`).toEqual([]);
  });
});

describe('i18n runtime resolution', () => {
  beforeEach(() => {
    // Default: Norwegian. Individual tests below opt into English.
    i18n.changeLanguage('no');
  });
  afterEach(() => {
    i18n.changeLanguage('no');
  });

  test('common.actions.close resolves to "Lukk" in Norwegian', () => {
    expect(i18n.t('common:actions.close')).toBe('Lukk');
  });

  test('common.actions.close resolves to "Close" after switching to English', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('common:actions.close')).toBe('Close');
  });

  test('family.portion.label interpolates the role parameter (NO)', () => {
    expect(i18n.t('family:portion.label', { role: 'voksen' })).toBe('voksenporsjon');
  });

  test('family.portion.label interpolates the role parameter (EN)', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('family:portion.label', { role: 'adult' })).toBe('adult portion');
  });

  test('unknown keys fall back to the key name (default i18next behavior)', () => {
    expect(i18n.t('common:actions.does_not_exist')).toBe('actions.does_not_exist');
  });
});
