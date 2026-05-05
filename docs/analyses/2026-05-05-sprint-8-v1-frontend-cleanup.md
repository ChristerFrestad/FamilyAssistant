# Analysis: SPRINT 8 — V1 Frontend Cleanup

Date: 2026-05-05
Branch: `refactor/sprint-8-v1-cleanup`
Severity: **HIGH — pilot-quality / consistency**

## Background

After PR #114, #115, #116, #117 unblocked the pilot deploy, Christer
identified a class of subtle bugs caused by v1/v2 coexistence:

1. Logout flow could land users on `/login.html` (legacy v1)
2. Cached v1 service workers re-served stale content
3. `/index.html` still served the legacy SPA shell
4. Two parallel codebases meant two sources of truth for auth, settings,
   onboarding

Root cause: v1 and v2 frontends shipped side-by-side, with v2 as the
primary target but v1 still present and reachable through several
paths. Operators / browsers occasionally fell into the v1 codepath.

Christer's decision (2026-05-05): **delete v1 entirely**. V2 is the
pilot-target and the post-pilot-target. V1 has no further purpose.

Strategic alternative: **ALTERNATIVE B** (keep `/v2/`-prefix, delete v1).
Lower risk than full URL refactor (Alt A/C). Post-pilot can iterate to
clean URLs in a separate PR.

## Symptom (Christer's observation)

When a user clicks "logout" inside the v2 app (Settings → LogoutButton):
- v2's `LogoutButton.tsx` correctly redirects to `/v2/login`
- BUT if the browser had previously visited v1 and cached `sw.js`, the
  cached service worker could still intercept requests and present
  legacy v1 markup
- AND `public/js/auth.js` had `window.location.replace('/login.html')`
  in three places — any latent v1 trigger would force the user back to
  the legacy login page

## Root cause

Server `request → middleware → router` flow allowed two parallel
codepaths:

1. **`tryServeV2App(/v2/...)`** — served v2 React bundle from
   `public/v2/` ✓
2. **`tryServeSpaFallback(/...)`** — served legacy `public/index.html`
   for any non-API GET that did not start with `/v2/` ✗

`PUBLIC_PATHS` in `server/auth/middleware.js` included
`/login.html`, `/invite.html`, `/setup.html` — keeping legacy
unauthenticated entry-points alive.

Plus `public/js/*` and `public/css/*` shipped with the image and were
served as static assets via `tryServeSpaFallback`.

## The fix

Delete the entire v1 surface:
- All `public/*.html` except legal pages (privacy, privacy-en, terms)
- All `public/js/*` (18 files)
- All `public/css/*` (4 files)
- `public/manifest.json`, `public/icon-192.png` (legacy PWA)
- Replace `public/sw.js` with a **tombstone** that unregisters
  itself + reloads clients

Then update server:
- `server/http/server.js`: remove `tryServeSpaFallback()`; catch-all
  GET (non-API, non-static-legal) routes to `tryServeV2App()` with
  pathname forced to `/v2/`
- `server/auth/middleware.js`: `PUBLIC_PATHS` no longer includes
  `/login.html`, `/invite.html`, `/setup.html`

Delete tests for non-existent v1 surface:
- `tests/frontend-auth.test.js` (DEL 6.1-frozen, Christer DEL 6.5
  approved)
- `tests/phase14-sw-multitenant.test.js` (DEL 6.1-frozen, approved)
- `tests/family-ui-assets.test.js`
- `tests/m3-e2e-smoke.test.js`
- `tests/m3-a11y.test.js`
- `tests/m-week4-a11y-extended.test.js`
- `tests/m-week4-frontend-features.test.js`
- `tests/m5-frontend-pwa.test.js`
- `tests/m-week7-portability.test.js`
- `tests/static-pages.test.js` — split: keep privacy/terms tests, drop
  INDEX/LOGIN/SW assertions

## Why a tombstone for sw.js (not a delete)

Existing pilot/dev browsers may have v1's service worker installed.
The SW caches v1 content and intercepts requests — a plain delete of
`public/sw.js` would leave those browsers stuck serving stale cached
content for an indeterminate time (until their next SW update check,
which happens at the SW's pace, not ours).

The tombstone:
1. Is loaded by browsers that fetch `/sw.js`
2. On `install`, calls `skipWaiting()` to take control immediately
3. On `activate`, calls `self.registration.unregister()` to remove
   itself, then navigates all controlled clients to reload (which
   then runs without any SW)

After 3-6 months, when all pilot users have visited the app and had
their v1 SW unregistered, the tombstone file can be deleted entirely.
Tracked in post-pilot-code-debt-cleanup.md.

## The journey

1. Sprint 7 introduced v2 React app under `/v2/` while keeping v1
2. Pilot deploys hit incremental bugs (PR #114-117) that masked the
   underlying v1/v2 conflict
3. Christer reproduces logout-loops to v1; root cause is v1's auth.js
   redirects + cached SW
4. Decision: full v1 deletion. ALTERNATIVE B: keep `/v2/`-prefix,
   delete v1 completely. Lowest-risk path before pilot.

## Domain model impact

No domain entity changes. Pure frontend + routing cleanup. Files
touched:

- 28+ deletions in `public/`
- `public/sw.js` rewritten as tombstone
- `server/http/server.js` — remove tryServeSpaFallback, route
  catch-all to v2
- `server/auth/middleware.js` — clean PUBLIC_PATHS
- 10 test files deleted, 2-3 modified
- `CHANGELOG.md`, `docs/runbooks/deploy-portainer.md`,
  `docs/architecture/frontend.md` (NEW), `post-pilot-code-debt-cleanup.md`

DEL 6.1 approved by Christer 2026-05-05 (cited in PR body).

## Edge-cases

1. **Browser with cached v1 SW visits app post-deploy** — fetches
   `/sw.js` (tombstone), tombstone activates, unregisters, reloads.
   User sees v2 on first reload.
2. **Browser with NO SW visits app** — never fetches `/sw.js` (or
   fetches once and discards). v2 loads normally.
3. **Operator runs `curl /index.html` post-deploy** — 404. v1 markup
   no longer ships.
4. **Operator runs `curl /privacy.html`** — 200 (legal pages
   preserved).
5. **Bookmark to `https://app.../v2/dashboard`** — works as before
   (v2 is unchanged, only v1 is gone).
6. **Bookmark to `https://app.../login.html`** — 404. Acceptable;
   legacy URL has been deprecated since v2 launched.
7. **Old `/api/auth/google/start` redirect to `/v2/...`** — unchanged
   (Google OAuth is disabled in pilot anyway).
8. **`/sw.js` route — does it still work?** — yes, public/ static-
   serving handles it. Tombstone served as `text/javascript`.
9. **`tryServeV2App` invoked with `/`** — now serves `public/v2/index.html`.
   The catch-all uses pathname-forcing to make this work.
10. **`/api/*` 404** — unchanged. Catch-all only triggers on non-API
    GETs.

## Decisions

### BESLUTNING 1: ALTERNATIVE B vs A vs C
ANBEFALING: B (Christer-godkjent)
HVORFOR: Lavest risiko, fikser pilot-blocker, post-pilot kan iterere.

### BESLUTNING 2: sw.js tombstone vs delete
ANBEFALING: Tombstone (Christer påkrevd)
HVORFOR: Deterministisk SW-cleanup. Plain delete = stale content i
ukjent tidsrom for eksisterende brukere.

### BESLUTNING 3: Slett 2 frosne tester (DEL 6.1)
ANBEFALING: Slett (DEL 6.5 eksplisitt godkjent av Christer)
HVORFOR: Test-objektene (v1-frontend, v1 sw.js) slettes; tester for
ikke-eksisterende kode er meningsløse. Multi-tenant-coverage er
dekket av eksisterende DEL 14-tester for v2.

## ISO 25010 impact

- Reliability: 8.7 → 8.8 (+0.1) — én konsistent frontend-kodebase,
  ingen v1/v2-konflikt
- Maintainability: 8.6 → 8.8 (+0.2) — sletter ~50KB statisk + 22 JS/CSS
  filer + 10 test-filer; ett sannhets-sentrum for frontend
- Functional Suitability: 8.7 → 8.7 (uendret)
- Security: 8.2 → 8.2 (uendret) — slettet kode kan ikke ha sårbarheter
  (mindre attack surface, men for små filer er gevinsten marginal)

## Plan

1. Delete v1 files (28+ filer)
2. Replace sw.js with tombstone
3. Server routing — remove tryServeSpaFallback, catch-all to v2
4. PUBLIC_PATHS cleanup
5. Delete 10 tests, modify 2-3
6. CHANGELOG + runbook + new frontend.md + code-debt entries
7. Local verification
8. Push + PR

## Portainer-oppstartsrisiko (DEL 3 Steg 3b)

NO. Ingen Dockerfile-endring (slettede filer er allerede gitignored
implisitt fordi de er statiske; image bygger som før). Ingen
migrasjon. Ingen oppstart-sekvens-endring. Server boot-er identisk.

## Complexity assessment

LARGE in scope (delete 28+ files, modify server-routing) but LOW in
risk fordi vi sletter unused kode. Ingen ny logikk introduseres.
