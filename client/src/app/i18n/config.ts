// i18next configuration for the v2 frontend.
//
// Default language is Norwegian (no). English (en) is wired up but the
// pilot ships in Norwegian; the LanguageSwitcher lets users opt in to
// English. Persistence uses localStorage under the key `fa:language`,
// scoped so the rest of the localStorage namespace stays predictable.
//
// Namespaces map to product surfaces — common (cross-cutting
// actions/status), auth (login flow), dashboard, family, meals,
// chores, recipes, shopping, calendar, settings, pantry, admin. Each
// namespace lives as its own JSON file under locales/{lang}/ so the
// bundle ships small chunks rather than one monolithic dictionary.
//
// Keys never appear bare in JSX; the `t()` hook resolves them at render
// time. See AGENTS.md DEL 7.11 for the full policy.
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
import noChores from './locales/no/chores.json';
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
import enChores from './locales/en/chores.json';
import enRecipes from './locales/en/recipes.json';
import enShopping from './locales/en/shopping.json';
import enCalendar from './locales/en/calendar.json';
import enSettings from './locales/en/settings.json';
import enPantry from './locales/en/pantry.json';
import enAdmin from './locales/en/admin.json';

export const SUPPORTED_LANGUAGES = ['no', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'family',
  'meals',
  'chores',
  'recipes',
  'shopping',
  'calendar',
  'settings',
  'pantry',
  'admin',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

const resources = {
  no: {
    common: noCommon,
    auth: noAuth,
    dashboard: noDashboard,
    family: noFamily,
    meals: noMeals,
    chores: noChores,
    recipes: noRecipes,
    shopping: noShopping,
    calendar: noCalendar,
    settings: noSettings,
    pantry: noPantry,
    admin: noAdmin,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    family: enFamily,
    meals: enMeals,
    chores: enChores,
    recipes: enRecipes,
    shopping: enShopping,
    calendar: enCalendar,
    settings: enSettings,
    pantry: enPantry,
    admin: enAdmin,
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
      // Make `{{appName}}` resolve automatically in every string
      // across the bundle without forcing call sites to pass
      // `{ appName }` explicitly. The getter reads directly from
      // the resource store (NOT via `t()`) to avoid infinite
      // recursion — interpolation runs as part of every t() call,
      // so calling t() inside a defaultVariables getter would
      // recurse on every translation. `getResource` returns the
      // raw stored value bypassing the interpolation pipeline.
      //
      // Reading dynamically each time means an `addResource(...)`
      // override (the VITE_APP_NAME white-label path) takes effect
      // immediately even on strings cached before the override
      // was applied. See AGENTS.md DEL 7.12.
      defaultVariables: Object.defineProperties(
        {},
        {
          appName: {
            enumerable: true,
            get: () => {
              const value = i18n.getResource(i18n.language, 'common', 'appName');
              return typeof value === 'string' ? value : 'FamilyAssistant';
            },
          },
        }
      ),
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

// Sprint 10 — runtime brand-config replaces the old build-time
// VITE_APP_NAME path. main.tsx fetches /api/config at startup and
// calls i18n.addResource(lng, 'common', 'appName', config.appName)
// for each supported language so every {{appName}} interpolation
// across the bundle picks up the active brand without rebuilding the
// image. The default 'FamilyAssistant' value in common.json is what
// renders for the open-source instance and during the brief cold-load
// window before /api/config resolves. See docs/BRAND_SYSTEM.md.

export default i18n;
