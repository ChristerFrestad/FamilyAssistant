# Frontend architecture

Last updated: 2026-08-15 (public marketing on listed hosts)

## Overview

FamilyAssistant has **one** product frontend: Vite + React + TypeScript in
`client/`. The production bundle is written to `public/v2/` (that
folder name is leftover from the coexistence era; it is **not** a
URL). `server/http/server.js` maps that folder onto `/login`,
`/dashboard`, and the other app routes.

There is a second, **optional** public surface: the Hverdagsplanleggeren
marketing site in `marketing/`. It is static HTML on the **same origin**
as `/login`. Empty `MARKETING_HOSTS` (the default) means every host
keeps serving the SPA at `/`. Self-hosters are unchanged. Operator
hostnames are env-only (`MARKETING_CANONICAL`); they are not in git.

The old vanilla-JS UI (`public/index.html`, `public/js/*`) was deleted
in Sprint 8 (2026-05-05).

## URL structure

| URL | Served as | Notes |
|---|---|---|
| `/` on a marketing host | `marketing/index.html` (or `public/www/`) | Crawlable landing |
| `/login`, `/dashboard`, … on that same host | `public/v2/index.html` | The app. Same origin as the landing. |
| `/` on LAN / unset `MARKETING_HOSTS` | `public/v2/index.html` | React shell. In `BOOTSTRAP_MODE` only, 302 → `/setup.html` |
| `/login`, `/dashboard`, `/invite/:token`, … | same `index.html` | SPA fallback for paths without a file extension |
| `/assets/main-XXX.js` | `public/v2/assets/…` | Vite chunks, CSS, fonts |
| `/v2`, `/v2/…` | **301** to the same path without `/v2` | Bookmarks and old emails |
| `/api/*` | `server/routes.js` | Backend |
| `/health`, `/ready`, `/metrics` | server | Ops |
| `/privacy.html`, `/terms.html`, `/setup.html` | `public/*.html` | Allowlisted static files |
| `/sw.js` | PWA worker from the bundle if present, else the v1 tombstone | |
| other `*.js` / `*.css` with no file | **404** | Missing assets do not fall back to HTML |

Vite `base` is `/`. React Router has no `basename`.

## Build

- **Source:** `client/src/`
- **Command:** `npm run build:client`
- **Output:** `public/v2/` (gitignored)
- **Image:** Dockerfile stage `frontend-builder` runs `npm ci` +
  `npm run build:client` and copies `/build/public/v2` into the
  runtime image.

## Server helpers (`server/http/server.js`)

0. **`tryHandleMarketing`** — if `Host` ∈ `MARKETING_HOSTS`, serve
   `marketing/` (or `public/www/`). `www.` 301s to `MARKETING_CANONICAL`.
   `/health` `/ready` `/metrics` `/api/*` still hit the app.
1. **`tryServeAppRobots`** — on non-marketing hosts, `/robots.txt` is
   `Disallow: /` plus `X-Robots-Tag: noindex, nofollow`.
2. **`tryRedirectLegacyV2`** — `GET/HEAD /v2` and `/v2/*` → 301.
3. **`tryServeSpaApp`** — files from `public/v2/` at the site root;
   HTML fallback for extensionless routes.
4. **`tryServePublicFile`** — allowlist: privacy, terms, setup.
5. **`tryServeSw`** — prefer the bundled PWA worker, else tombstone.

Auth middleware treats every non-`/api/*` path as public at the HTTP
layer so the shell can load. `PilotGuard`, `AuthGuard` and
`OnboardingGuard` enforce sign-in after mount.

## Service worker

`public/sw.js` is a **tombstone** for browsers that still have the
deleted v1 worker. Once the Vite PWA worker exists in the bundle it
is served at `/sw.js` instead. The tombstone can be deleted after
all old clients have visited once.
