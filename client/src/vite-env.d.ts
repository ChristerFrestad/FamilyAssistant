/// <reference types="vite/client" />

// Project-specific extension of Vite's ambient ImportMetaEnv.
//
// Vite exposes the standard fields (MODE, BASE_URL, PROD, DEV, SSR)
// via the triple-slash reference above. As of Sprint 10 the app no
// longer reads any custom VITE_* env-vars at build time — brand-config
// flows through GET /api/config at runtime so the same image can serve
// any white-label brand. See client/src/main.tsx and
// client/src/app/hooks/useBrandConfig.ts.
//
// Add new entries here only when introducing additional VITE_*-vars
// that have to be baked into the bundle at build time (rare).
//
// The interface stays declared (rather than removed entirely) so any
// future build-time env-var has an obvious place to land. Type-only
// — disable the empty-interface lint rule until a field gets added.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
