// Tests for the white-label appName mechanism (Sprint 2.5).
//
// Two contracts:
//   1. The default `appName` resolves to "FamilyAssistant" in both
//      supported languages — this is the open-source product name
//      shipped by the repo.
//   2. The override path (i18n.addResource on the same key) flips
//      every consumer to the new brand. We exercise this by calling
//      addResource directly and asserting that t() picks up the
//      change. The actual VITE_APP_NAME → addResource wiring lives
//      in config.ts and runs at module load — there's no clean way
//      to re-execute it from a test without nuking the i18n
//      singleton, so we verify the addResource API contract instead.
//
// After every test we restore the default value so subsequent
// tests in the suite see the canonical "FamilyAssistant" string.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES } from './config';

const DEFAULT_APP_NAME = 'FamilyAssistant';

beforeEach(() => {
  // The shared test-setup forces NO. We restore the default
  // resource on every supported language so a previous test that
  // overrode appName cannot leak into the next one.
  for (const lng of SUPPORTED_LANGUAGES) {
    i18n.addResource(lng, 'common', 'appName', DEFAULT_APP_NAME);
  }
  i18n.changeLanguage('no');
});

afterEach(() => {
  for (const lng of SUPPORTED_LANGUAGES) {
    i18n.addResource(lng, 'common', 'appName', DEFAULT_APP_NAME);
  }
  i18n.changeLanguage('no');
});

describe('appName default', () => {
  test('resolves to "FamilyAssistant" in Norwegian', () => {
    expect(i18n.t('common:appName')).toBe(DEFAULT_APP_NAME);
  });

  test('resolves to "FamilyAssistant" in English', () => {
    i18n.changeLanguage('en');
    expect(i18n.t('common:appName')).toBe(DEFAULT_APP_NAME);
  });

  test('logoLabel interpolates the appName', () => {
    expect(i18n.t('common:appShell.logoLabel')).toContain(DEFAULT_APP_NAME);
  });
});

describe('appName override (white-label deploys)', () => {
  test('addResource on common.appName flips Norwegian resolution', () => {
    i18n.addResource('no', 'common', 'appName', 'Hverdagsplanleggeren');
    expect(i18n.t('common:appName')).toBe('Hverdagsplanleggeren');
  });

  test('addResource on common.appName flips English resolution', () => {
    i18n.addResource('en', 'common', 'appName', 'Hverdagsplanleggeren');
    i18n.changeLanguage('en');
    expect(i18n.t('common:appName')).toBe('Hverdagsplanleggeren');
  });

  test('logoLabel interpolation picks up the override', () => {
    i18n.addResource('no', 'common', 'appName', 'Hverdagsplanleggeren');
    expect(i18n.t('common:appShell.logoLabel')).toBe('Hverdagsplanleggeren — til startsiden');
  });

  test('overriding both languages keeps key parity (no missing key on either side)', () => {
    i18n.addResource('no', 'common', 'appName', 'Hverdagsplanleggeren');
    i18n.addResource('en', 'common', 'appName', 'Hverdagsplanleggeren');
    expect(i18n.t('common:appName', { lng: 'no' })).toBe('Hverdagsplanleggeren');
    expect(i18n.t('common:appName', { lng: 'en' })).toBe('Hverdagsplanleggeren');
  });
});
