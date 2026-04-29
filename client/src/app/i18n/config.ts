// i18next configuration for the v2 frontend.
//
// Default language is Norwegian (no). English (en) is wired up but the
// pilot ships in Norwegian; the LanguageSwitcher lets users opt in to
// English. Persistence uses localStorage under the key `fa:language`,
// scoped so the rest of the localStorage namespace stays predictable.
//
// Eight namespaces map to product surfaces — common (cross-cutting
// actions/status), auth (login flow), dashboard, family, meals,
// shopping, calendar, settings. Each namespace lives as its own JSON
// file under locales/{lang}/ so the bundle ships small chunks rather
// than one monolithic dictionary.
//
// Keys never appear bare in JSX; the `t()` hook resolves them at render
// time. See CLAUDE.md DEL 7.11 for the full policy.
//
// Test note: this module imports from JSON files via Vite/Vitest's
// JSON-resolution. Tests that exercise translated components import
// the same module so the language detector and resource bundles match
// production.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import noCommon from './locales/no/common.json';
import noAuth from './locales/no/auth.json';
import noDashboard from './locales/no/dashboard.json';
import noFamily from './locales/no/family.json';
import noMeals from './locales/no/meals.json';
import noShopping from './locales/no/shopping.json';
import noCalendar from './locales/no/calendar.json';
import noSettings from './locales/no/settings.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';
import enFamily from './locales/en/family.json';
import enMeals from './locales/en/meals.json';
import enShopping from './locales/en/shopping.json';
import enCalendar from './locales/en/calendar.json';
import enSettings from './locales/en/settings.json';

export const SUPPORTED_LANGUAGES = ['no', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'family',
  'meals',
  'shopping',
  'calendar',
  'settings',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

const resources = {
  no: {
    common: noCommon,
    auth: noAuth,
    dashboard: noDashboard,
    family: noFamily,
    meals: noMeals,
    shopping: noShopping,
    calendar: noCalendar,
    settings: noSettings,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    family: enFamily,
    meals: enMeals,
    shopping: enShopping,
    calendar: enCalendar,
    settings: enSettings,
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // Norwegian is the pilot launch language. English entries exist as
    // ground-truth translations but the user must opt in via the
    // LanguageSwitcher.
    fallbackLng: 'no',
    supportedLngs: ['no', 'en'],
    defaultNS: 'common',
    ns: NAMESPACES as unknown as string[],
    interpolation: {
      // React already escapes interpolated values, so disabling
      // i18next's escaper avoids double-encoding.
      escapeValue: false,
    },
    detection: {
      // Try the persisted choice first, then fall back to navigator
      // language. Without persistence we'd reset to navigator-default
      // every load, which surprises pilot users on shared machines.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'fa:language',
    },
    // Disable suspense so React Testing Library and the dev preview
    // page don't need a Suspense boundary just to render translated
    // text. Resources are loaded synchronously above, so suspense adds
    // nothing here anyway.
    react: { useSuspense: false },
  });

export default i18n;
