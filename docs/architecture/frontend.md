# Frontend Architecture

Last updated: 2026-05-05 (Sprint 8 — v1 cleanup)

## Overview

FamilyAssistant ships a single React-based frontend (v2) built with Vite.
The frontend is bundled to `public/v2/` and served via `tryServeV2App()`
in `server/http/server.js`.

Prior to Sprint 8 (2026-05-05), a parallel legacy v1 frontend lived in
`public/index.html` + `public/js/*` + `public/css/*`. That codebase was
deleted; this document describes the post-cleanup state.

## URL structure

| URL pattern | Served by | Notes |
|---|---|---|
| `/` | 302 redirect → `/v2/` | `server/http/server.js` early intercept (PR #117) |
| `/v2/` | `public/v2/index.html` | React shell loaded; React Router takes over |
| `/v2/login`, `/v2/dashboard`, … | `public/v2/index.html` (SPA fallback) | Client-side routing under `BrowserRouter basename="/v2"` |
| `/v2/assets/main-XXX.js` | `public/v2/assets/…` | Vite-built chunks + sourcemaps + fonts |
| `/api/*` | `server/routes.js` | Backend API |
| `/health`, `/ready`, `/metrics` | server middleware | Operational endpoints |
| `/privacy.html`, `/privacy-en.html`, `/terms.html` | `public/*.html` direct | Legal pages — static HTML |
| `/sw.js` | `public/sw.js` (tombstone) | Unregisters cached v1 service workers |
| any other path | 404 | No silent SPA-fallback to v1 |

The `/v2/` URL prefix is technical debt: the React app builds with
`base: '/v2/'` in Vite and its router uses `basename="/v2"`. Removing
the prefix is tracked in
`docs/workflow/post-pilot-code-debt-cleanup.md`.

## Build

- **Source:** `client/src/`
- **Build command:** `npm run build:client` (runs `vite build`)
- **Output:** `public/v2/` (gitignored — generated per build)
- **CI build:** Dockerfile stage `frontend-builder` runs `npm ci`
  (incl. devDependencies) + `npm run build:client` and copies the
  bundle into the runtime stage. See `Dockerfile`.

## Server-side serving

`server/http/server.js` has two helpers responsible for static content:

1. **`tryServeV2App(pathname, res)`** — handles `/v2` and `/v2/*`. For
   asset paths it serves the file directly; for any other `/v2/...`
   path it falls back to `public/v2/index.html` so client-side routing
   works on hard reloads of e.g. `/v2/dashboard`.

2. **`tryServePublicFile(pathname, res)`** — handles a small allowlist:
   `/privacy.html`, `/privacy-en.html`, `/terms.html`, `/sw.js`. Any
   other path under `public/` is **not** served — the allowlist exists
   to prevent accidental surface growth as new files are dropped into
   the directory.

The catch-all in `createServer()` runs (1) then (2). If neither
matches and the request was a non-API GET, the catch-all returns 404.

## Authentication surface

`server/auth/middleware.js` `PUBLIC_PATHS`:

```
/health, /ready, /metrics, /privacy.html, /privacy-en.html,
/terms.html, /sw.js
```

Plus the `isPublicPath()` function additionally treats `/v2`, `/v2/`,
`/v2/index.html`, and `/v2/assets/*` as public so the React shell can
load before any auth state is known. Once the shell loads, frontend
guards (`PilotGuard`, `AuthGuard`, `OnboardingGuard`) handle auth UX.

## Service worker tombstone

`public/sw.js` was the v1 service worker that pre-cached HTML/JS/CSS.
Sprint 8 replaced it with a **tombstone**: a minimal worker whose only
job is to unregister itself on activation, drop all caches, and force
controlled clients to reload (which then runs without a SW intercept).

The tombstone exists because browsers that visited the app pre-Sprint 8
have v1's SW installed. A plain delete of `public/sw.js` would leave
those browsers stuck with stale cached content for an indeterminate
time. The tombstone guarantees deterministic cleanup on the next visit.

After 3-6 months when all pilot users have visited the app and had
their v1 SW unregistered, the tombstone file can be deleted entirely
along with the `/sw.js` PUBLIC_PATHS entry. Tracked in
`docs/workflow/post-pilot-code-debt-cleanup.md`.

## Post-pilot considerations

- **Remove `/v2/`-prefix:** the React app could serve from root
  (`base: '/'`, `basename` removed, outDir under `client/dist/`).
  Cleaner URLs (`/dashboard` instead of `/v2/dashboard`) but requires
  Dockerfile + server-routing + Vite-config changes.
- **Delete sw.js tombstone:** safe after 3-6 months of pilot operation.
- **Re-implement bootstrap-flow on v2:** the original setup wizard in
  `public/setup.html` was deleted with v1. The backend handler
  (`server/http/bootstrap.js`) still exists but its `setupUrl` points
  to the deleted page. Pilot deploys do not use bootstrap-mode.

All three are tracked as code-debt entries.
