/// <reference types="vite/client" />

// Project-specific extension of Vite's ambient ImportMetaEnv.
//
// Vite already exposes the standard fields (MODE, BASE_URL, PROD,
// DEV, SSR) via the triple-slash reference above; this block adds
// our own VITE_*-prefixed env vars so `import.meta.env.VITE_APP_NAME`
// is fully typed instead of falling back to `any`.
//
// Add new entries here when introducing additional VITE_*-vars so
// every consumer keeps strict typing under TypeScript's
// noUncheckedIndexedAccess + exactOptionalPropertyTypes.

interface ImportMetaEnv {
  /**
   * White-label override for the application's user-facing brand
   * name. When set at build time, replaces the default
   * `common:appName` translation ("FamilyAssistant") in both
   * supported languages. See CLAUDE.md DEL 7.12.
   */
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
