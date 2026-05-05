# Analysis: GET / leaks v1 OR 401s anonymous (BUG 2)

Date: 2026-05-04
Branch: `fix/root-redirect-to-v2`
Severity: **CRITICAL — pilot-launch blocker**

## Symptom

After PR #115 + #116 landed and Christer redeployed, two browsers
exhibited different but related failures on the bare root URL:

**Edge (with stale session-cookie from earlier sign-in):**
```
GET / → 200 OK (serves LEGACY v1 frontend — Chat / Ukesmeny / Handletur / Husarbeid / Kontrollrommet)
```
Pilot users land on legacy v1 instead of the v2 React app with
PilotGuard / AuthGuard / OnboardingGuard.

**Chrome (no cookies):**
```
GET / → 401 "Authentication required" instance="/"
```
Anonymous visitors hit a hard 401 with no obvious recovery path.

Both behaviours are visible on the same deploy; the difference is
which auth state the browser carries.

## Root cause

Server `request → middleware → router` flow for `GET /`:

1. `enforcePilotGate(ctx)` — when pilot-mode is on, redirects to
   `/v2/` only if no pilot-cookie. Edge had a stale fa_pilot, so
   it skipped this hop. (Pilot mode may also be off in the LAN
   deploy — same outcome.)
2. `isPublicPath('/')` → false (`/` is not in PUBLIC_PATHS)
3. Auth chain runs:
   - **Edge**: `fa_session` cookie matches a valid session → user
     attached → falls through
   - **Chrome**: no Bearer, no session, AUTH_TOKEN configured →
     `errors.unauthorized('Authentication required.')` → 401
4. **Edge only** continues: `router.dispatch('GET', '/')` → no route
5. `tryServeV2App('/')` → false (path doesn't match `/v2/*`)
6. `tryServeSpaFallback('/')` → serves `public/index.html` (legacy v1)

The result:
- Authenticated visitors leak through to the unintended v1 SPA
- Anonymous visitors get a useless 401 with no way forward

V2 has been the pilot frontend since Sprint 7. The legacy v1 SPA in
`public/index.html` is intentionally still in the image (operators may
need it for diagnostics, some `/js/*` and `/css/*` assets are still
referenced by it), but **no real visitor should ever reach v1
through the bare root**.

## The journey

1. Pilot user opens app domain
   1.1. Browser GET / through Cloudflare → RPi container
   1.2. Container processes / through full middleware chain
   1.3. Either lands on stale v1 (Edge) or hits 401 (Chrome)
2. User confused
   2.1. v1 has no PilotGuard → no password prompt → user assumes app
        is broken
   2.2. 401 has no link or message → user assumes app is broken
3. Onboarding fails before it starts

## Fix

`server/http/server.js` — intercept `GET /` before rate-limit and
auth, emit `302 Location: /v2/`, end response. Cookie-agnostic,
side-effect-free, only the bare root.

```js
if (pathname === '/' && req.method === 'GET') {
  res.writeHead(302, { Location: '/v2/' });
  res.end();
  // metrics + log
  return;
}
```

Plassering: rett før `rateLimit(ctx)` inni `try`. Reasoning:

- **Before rate-limit:** redirect costs nothing on the server, no
  reason to consume the visitor's per-IP budget for it
- **Before auth:** redirect must be cookie-agnostic (the bug-
  scenarios show that auth state was the deciding factor — both
  Edge with cookie and Chrome without cookie should be redirected)
- **Inside `try`:** keeps metrics + logRequest semantics consistent
  with other code paths

Why not in `server/auth/middleware.js`?

- middleware.js is under DEL 6.1b soft-thaw; touching it is more
  risky and would conflate this fix with auth-gate logic
- The redirect has nothing to do with auth — it's a pre-routing
  rewrite
- server.js handles all "before-routing" concerns already (CORS,
  security headers, rate-limit gate)

## Domain model impact

No domain entity changes. Pure routing rewrite. Files touched:

- `server/http/server.js` — add root-redirect block (~15 lines incl.
  comment)
- `tests/root-redirect.test.js` — NEW, 15 tests covering the matrix
- `tests/v2-app-serving.test.js` — update GET / expectation to 302,
  add new GET /index.html test
- `tests/m3-e2e-smoke.test.js` — split GET / into "GET / redirects"
  + new "GET /index.html serves legacy"
- `tests/family-ui-assets.test.js` — substitute GET / → GET /index.html
- `tests/frontend-auth.test.js` — substitute GET / → GET /index.html
  (DEL 6.1-frozen test; URL substitution preserves intent)
- `CHANGELOG.md`, `docs/runbooks/deploy-portainer.md` — docs

DEL 6.1b approved by Christer 2026-05-04 with explicit "Alle må
passere" instruction.

## Edge-cases considered

1. **POST/PUT/DELETE /** — not redirected. `req.method === 'GET'`
   guard ensures only GET hits the redirect. Other methods fall
   through to the router and get a normal 404.
2. **Bearer-authenticated operator on /** — redirected too. Even an
   admin should land on /v2/ first; they can navigate to /index.html
   manually if they need legacy diagnostics.
3. **Pilot-cookie holders on /** — redirected. Pilot-cookie semantics
   are about access to the v2 app, not about which path to serve.
4. **/index.html, /login.html, /privacy.html, etc.** — unchanged.
   The redirect targets ONLY the bare root. Explicit static-file
   paths are reachable for backwards compatibility.
5. **/v2/ itself** — unchanged. Root-redirect runs before any /v2/
   handling and the predicate `pathname === '/'` excludes it.
6. **GET / with query string (`/?utm=foo`)** — `pathname` from
   `URL` parsing is just the path component, so query strings are
   stripped before the comparison. Redirect target is `/v2/`
   without preserving the query — acceptable for pilot, can be
   refined later if marketing-attribution tracking matters.
7. **Service-worker GET /** — service workers in the v1 app fetch
   the bare root for the offline shell. After the fix they get
   a 302 to /v2/, which they should follow. v1 service worker is
   being phased out; v2 has its own SW story.
8. **CORS preflight OPTIONS /** — handled by `handleCorsPreflight`
   before the redirect block. Unaffected.
9. **HEAD /** — falls through to the router (not handled by the
   redirect since we only intercept GET). Acceptable; HEAD on the
   bare root has no defined behaviour in this app.

## Decisions

### BESLUTNING 1: Where to place the redirect?
ANBEFALING: server.js, before rate-limit and auth, inside try-catch
HVORFOR: Cookie-agnostic, no auth coupling, consistent with other
"before-routing" concerns
ALTERNATIVER:
- middleware.js before pilot-gate: couples redirect to auth chain,
  touches DEL 6.1b-thawed code unnecessarily
- New routes.js handler: would require auth chain to reach it, but
  the whole point is to redirect BEFORE auth
KONSEKVENS HVIS ANNERLEDES: middleware.js placement would force a
DEL 6.1b review for what is fundamentally a routing concern.

### BESLUTNING 2: GET only, or all methods?
ANBEFALING: GET only
HVORFOR: Per Christer's spec ("Kun GET"). POST/PUT/DELETE / have no
real use case in this app — let the router 404 them as before.
ALTERNATIVER:
- Redirect all methods: POST / → 302 /v2/ would surprise API
  clients that mistakenly hit / instead of /api/foo
KONSEKVENS HVIS ANNERLEDES: silently redirecting non-GET would
mask API-client bugs.

### BESLUTNING 3: Update DEL 6.1-frozen tests/frontend-auth.test.js?
ANBEFALING: Yes — minimal URL substitution (GET / → GET /index.html)
HVORFOR: Christer's explicit "Alle må passere" instruction includes
this test. Substitution preserves the test's INTENT (auth-gate on
legacy v1 entry-point) without altering assertions.
ALTERNATIVER:
- Skip the test: would actively hide the regression
- Duplicate test in unfrozen file: noise, two sources of truth
KONSEKVENS HVIS ANNERLEDES: The frozen test would fail every CI run
forever, eroding the value of the "frozen" signal across the entire
DEL 6.1 list.

## Cross-cutting impact

- Backend services: untouched
- HTTP routes: server.js gains 15 lines (early-return); router
  unchanged
- Database: untouched
- Auth middleware: untouched (DEL 6.1b code not modified)
- Tests: 1 new file (15 tests), 4 existing files updated (intent
  preserved)

## Portainer-oppstartsrisiko (DEL 3 Steg 3b)

NO. Pure routing change, no Dockerfile, no migrations, no startup
sequence change. Server boots identically.

## ISO 25010 impact

- Reliability: 8.6 → 8.7 (+0.1) — third pilot blocker gone, every
  pilot visitor lands on the right entry point
- Functional Suitability: 8.7 → 8.7 (uendret)
- Security: 8.2 → 8.2 (uendret) — redirect doesn't leak any state,
  no auth bypass
- Maintainability: 8.6 → 8.6 (uendret) — modest addition, well-
  commented, consistent with other "before-routing" concerns

## Plan

1. `server/http/server.js` — add root-redirect block ✅
2. `tests/root-redirect.test.js` — new test file with full matrix ✅
3. Update 4 existing tests that assumed GET / served HTML ✅
4. CHANGELOG entry under [Unreleased] ✅
5. Runbook update — document the redirect ✅
6. Code-debt entry — post-pilot v1 cleanup
