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
import noPantry from './locales/no/pantry.json';
import noAdmin from './locales/no/admin.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';
import enFamily from './locales/en/family.json';
import enMeals from './locales/en/meals.json';
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
      // was applied. See CLAUDE.md DEL 7.12.
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

// White-label override.
//
// The default `appName` resource is the open-source product name
// "FamilyAssistant". A deploy can override it by setting the build-time
// env var `VITE_APP_NAME` (Vite exposes any `VITE_*` var via
// `import.meta.env`). When set, we replace the appName resource on
// both supported languages so every `t('common:appName')` call and
// every `{{appName}}` interpolation across the bundle picks up the
// brand name without further code changes.
//
// We intentionally do this AFTER `i18n.init()` so the override sits
// on top of the loaded resource bundles. Doing it before init would
// require re-asserting the value into the `resources` object, which
// duplicates the override logic.
//
// Backend has its own equivalent flag `APP_NAME` (no VITE_ prefix —
// VITE_* is a frontend-only build-time concept) consumed by
// server/services/email.service.js. Keeping the two flags symmetric
// in name keeps Christer's deploy-config short. See CLAUDE.md DEL
// 7.12 for the full white-label policy.
applyAppNameOverride(i18n);

function applyAppNameOverride(instance: typeof i18n): void {
  const raw = import.meta.env.VITE_APP_NAME;
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  for (const lng of SUPPORTED_LANGUAGES) {
    instance.addResource(lng, 'common', 'appName', trimmed);
  }
}

export default i18n;
