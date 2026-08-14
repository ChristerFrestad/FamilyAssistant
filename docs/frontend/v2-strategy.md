# Frontend v2 — strategy and route design

**Status (2026-08-14):** The React app is the only UI. It is served at
the site root (`/login`, `/dashboard`). `public/v2/` is the build
folder only. `/v2/*` 301s to the same path without the prefix.

**Status:** Phase 1a completed 2026-04-23. Updated after each subphase.

**Relevant:** `design/2026-04-redesign/extracted/locked-decisions.md`
(THE REFERENCE for all design decisions).

---

## What and why

FamilyAssistant is building a new frontend from the ground up in **Vite + React 18 +
TypeScript (strict) + Tailwind v3 + React Router**. The source code lives in
`client/`; the build output ends up in `public/v2/` (gitignored).

The backend remains unchanged. The old app (vanilla JS in `public/*`)
continues to work byte-identical on `/`. The new app runs on
**`/v2/*`**.

When the redesign is complete (likely week 8-10), the roles swap:
`/v2/*` becomes `/`, and the old app moves to `/v1/*` during a
transition period before being removed.

---

## Route strategy

### What is served from where?

| URL pattern | Source | Served by |
|---|---|---|
| `/api/*` | Express routes in `server/routes.js` + `server/auth/*` | Existing backend |
| `/metrics`, `/health`, `/ready` | Existing backend | Existing backend |
| `/v2` | `public/v2/index.html` | New `tryServeV2App` handler |
| `/v2/` | `public/v2/index.html` | New `tryServeV2App` handler |
| `/v2/<filename>` | `public/v2/<filename>` | New `tryServeV2App` handler (direct hit) |
| `/v2/<client-side-route>` | `public/v2/index.html` (fallback) | New `tryServeV2App` handler (SPA fallback) |
| `/` | `public/index.html` | Existing `tryServeSpaFallback` |
| `/<asset>` | `public/<asset>` (if it exists) | Existing `tryServeSpaFallback` |
| Unknown path | `public/index.html` (legacy) | Existing `tryServeSpaFallback` |

### The `tryServeV2App` handler

Defined in `server/http/server.js`. Called **before** `tryServeSpaFallback`
in the request flow. Matches **ONLY** `/v2` and `/v2/*` — no generic
prefix matching. When we later add `/v3`, it gets its own handler.

```js
// Pseudocode
function tryServeV2App(pathname, res) {
  if (pathname !== '/v2' && !pathname.startsWith('/v2/')) return false;
  if (!fs.existsSync('public/v2')) return false;

  // Direct file hit for assets (e.g. /v2/assets/main.js)
  // → serve file
  // Fallback to public/v2/index.html
  // → let React Router take over
}
```

### Why explicit over generic?

Christer chose (2026-04-23) a dedicated handler instead of extending
the existing `tryServeSpaFallback` with generic sub-app logic. Three
reasons:

1. **Explicit over implicit:** Generic prefix matching is "magical"
   — anyone who creates `public/foo/index.html` would accidentally
   create a new sub-app.
2. **Minimal regression risk:** The existing `tryServeSpaFallback`
   is unchanged. The test suite for legacy serving is not affected.
3. **Easy test isolation:** The new test `tests/v2-app-serving.test.js`
   tests only `tryServeV2App` + coexistence with legacy. No
   cross-couplings.

---

## Development flow

### Starting frontend work?

```bash
# Backend (separate terminal)
npm start                    # Express on :7777

# Frontend (new terminal)
npm run dev:client           # Vite dev server on :7778 with /api proxy
```

Open `http://localhost:7778/v2/` — Vite serves HMR with automatic
re-rendering. API calls to `/api/*` are proxied to the backend on 7777.

> Vite port `7778` (not the default `5173`) was chosen to sit right
> next to the backend on `7777`. The full port matrix for the developer
> machine is documented in `AGENTS.md` PART 7.8.

### Want to see what the prod build looks like?

```bash
npm run build:client         # builds public/v2/
npm start                    # Express on :7777
# Open http://localhost:7777/v2/
```

### Typecheck

```bash
npm run typecheck:client     # tsc --noEmit for client/
npm run typecheck            # tsc --noEmit for server/ (as before)
```

---

## Where do you put things?

```
client/
  index.html                  # Vite entry HTML
  vite.config.ts              # Vite config (base: '/v2/', outDir: ../public/v2)
  tsconfig.json               # TS config for client (strict mode)
  tailwind.config.ts          # Tailwind v3 config (filled in during Phase 1b)
  postcss.config.js           # Tailwind + Autoprefixer

  src/
    main.tsx                  # React entry + BrowserRouter(basename="/v2")
    App.tsx                   # Router + Routes (placeholder for now)
    index.css                 # Tailwind base/components/utilities
    screens/                  # Top-level route components (coming)
    components/               # Reusable UI components (coming)
    lib/                      # Utilities, hooks, services (coming)
```

**Rules:**

- Import relative to the `@/` alias (`@/components/Button`) — configured in `tsconfig.json`
- Tailwind utilities in JSX; custom CSS only for tokens/keyframes
- Design tokens from `design/2026-04-redesign/extracted/design-system.md` §13 — coming in Phase 1b
- **No inline styles** in production components — only in placeholder code or highly dynamic mappings

---

## Coexistence period

| Phase | Old app on `/` | New app on `/v2/` |
|---|---|---|
| Phase 1 (toolchain, design system, shell) | Full functionality | "Hello v2" + design tokens + shell |
| Phase 2 (screens against existing backend) | Full functionality | Dashboard, Meals, Shopping, Chores basic |
| Phase 3 (extensions) | Full functionality | Pantry location, unpreferred, Settings |
| Phase 4 (new features) | Full functionality | Calendar, achievements, week goals |
| **Transition** | Moved to `/v1/` temporarily | Becomes `/` |
| **Decommissioning** | Removed | Is the app |

This structure lets us gradually test the new app with pilot families
(they get the `/v2/` link) while production usage continues on `/`.

---

## What is NOT in Phase 1a

- Design tokens (OKLCH colors, typography, glassmorphism) — coming in Phase 1b
- i18n setup — coming in Phase 1c
- Responsive navigation (bottom menu on mobile, side menu on desktop) — coming in Phase 1d
- Screens (Dashboard, Meals, ...) — coming in Phase 2+
- Auth flow — waiting on claude.ai/design follow-up (D1)

---

## References

- `client/vite.config.ts` — Vite setup
- `server/http/server.js` — `tryServeV2App` + `tryServeSpaFallback`
- `tests/v2-app-serving.test.js` — serving tests
- `design/2026-04-redesign/extracted/locked-decisions.md` — locked choices (D1-D6)
- `design/2026-04-redesign/extracted/architecture-fit.md` — run-anywhere requirements
- `docs/vision/integration-platform-future.md` — post-pilot vision
