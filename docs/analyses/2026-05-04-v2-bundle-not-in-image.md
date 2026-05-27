# Analysis: V2 frontend bundle not built in Docker image

Date: 2026-05-04
Branch: `fix/dockerfile-build-v2-frontend`
Severity: **CRITICAL — pilot-launch blocker**

## Symptom

After PR #114 merged, Christer deployed `:main` to RPi5 via Portainer
and visited `http://&lt;rpi-lan-ip&gt;:7777/v2/`. He expected to see the
PilotPasswordGate UI rendered by the v2 React app. Instead he saw the
legacy v1 frontend (Chat / Ukesmeny / Handletur / Husarbeid /
Kontrollrommet).

Container log shows only `/health` requests — no `/v2/` requests.

Verification on RPi5 confirmed:

```
$ docker exec familieassistenten ls -la /app/public/v2/
ls: cannot access '/app/public/v2/': No such file or directory
```

## Root cause

The v2 React bundle is **never built when the production Docker image
is assembled**. Three facts compound:

1. **`public/v2/` is gitignored** (`.gitignore:67`). The folder holds
   the output of `npm run build:client` and is intentionally not
   committed. Comment in `client/vite.config.ts` says *"CI rebuilds it
   before serving"*.

2. **The Dockerfile does not run `npm run build:client`**. It copies
   `server/`, `public/`, and `scripts/load-baseline.js` into the
   builder stage and proceeds straight to runtime. `client/` is never
   copied. Vite is never invoked. Hence `/app/public/v2/` is empty in
   the resulting image.

3. **`.github/workflows/docker.yml` does not build the frontend
   either**. It runs `actions/checkout` (which respects `.gitignore`)
   and feeds the result to `docker buildx build`. No `setup-node`, no
   `npm ci`, no `build:client` step. The intent was for the Dockerfile
   to handle it — but it doesn't.

So the production image has a Dockerfile that expects bundle to be
present, a workflow that does not build it, and a `.gitignore` that
prevents it from being committed. The bundle exists only on developer
machines after a manual `npm run build:client`.

### Why the SPA-fallback hides the bug instead of surfacing it

`server/http/server.js` request flow for a GET to `/v2/`:

1. `tryServeV2App('/v2/', res)` runs first
2. It checks `if (!fs.existsSync(public/v2/)) return false;`
3. Returns false → falls through
4. `tryServeSpaFallback('/v2/', res)` runs
5. `public/v2` doesn't exist → falls back to `public/index.html`
6. Serves legacy v1

If `tryServeV2App` had thrown 404 when the v2 folder was missing, the
bug would have been obvious from day one. Silent fallback to v1 made
it invisible until production deploy.

### Why PR #114 didn't catch this

PR #114 fixed the auth middleware so `/v2/` is in `isPublicPath()`
(reachable without auth). It was tested locally where
`public/v2/index.html` was present from a previous `npm run
build:client`. The fix is correct, but the production image never had
those files in the first place — so visitors hit /v2/ → auth lets it
through → no bundle → fallback to v1.

This is two bugs, not one:
- Bug A (fixed in #114): `/v2/` was not public → 401-loop
- Bug B (this PR): `/v2/` bundle not built → fallback to v1

Both had to be fixed before pilot-launch could succeed.

## The journey (from CLAUDE.md DEL 3 perspective)

1. Pilot user visits app domain
   1.1. CDN → Cloudflare Tunnel → RPi5 → container
   1.2. Container handles GET / → 302 to /v2/
   1.3. Container handles GET /v2/
2. Container processes /v2/
   2.1. `tryServeV2App('/v2/')` checks for `public/v2/` directory
   2.2. Directory does not exist (image never built it)
   2.3. Returns false → falls through to legacy SPA fallback
   2.4. Legacy `public/index.html` served instead
3. User sees v1
   3.1. v1 has no PilotGuard → no password prompt
   3.2. v1 attempts to call /api/* without pilot-cookie
   3.3. Backend returns 403 pilot_required, but v1 doesn't render
        the gate UI — it shows legacy "ikke autentisert" message
   3.4. User confused, can't proceed

## Domain model impact

No domain entity changes. This is purely a build-pipeline fix. Files
touched:

- `Dockerfile` — add frontend-builder stage, copy v2 bundle into
  backend builder
- `.dockerignore` — already excludes `client/` indirectly via lack of
  positive include? Verify and update if needed
- `docs/runbooks/deploy-portainer.md` — document new build step in
  troubleshooting
- `CHANGELOG.md` — log the fix
- `docs/workflow/post-pilot-code-debt-cleanup.md` — Entry 10:
  consider moving Vite build to GitHub Actions cache for faster CI

## Edge-cases considered

1. **`client/node_modules/` leaking into image** — `.dockerignore`
   has `node_modules` blanket-rule, so neither root nor client
   node_modules ship. Frontend-builder runs its own `npm ci`.
2. **Stale bundle from previous build** — `emptyOutDir: true` in
   `vite.config.ts` ensures `public/v2/` is wiped before write. Each
   image build starts clean.
3. **Sourcemaps in production** — `sourcemap: true` in vite config
   means `.js.map` ships. Acceptable for pilot; can be tightened
   post-pilot to reduce bundle size.
4. **arm64 build of Vite** — Vite is pure-JS, runs on any node
   platform. `@vitejs/plugin-react` uses esbuild which has prebuilt
   arm64 binaries. Multiarch build via QEMU on Actions handles this.
5. **Build-cache invalidation** — frontend-builder stage caches per
   `package-lock.json` + `client/` content. Backend changes that
   don't touch `client/` reuse cached frontend bundle. Saves rebuilds.
6. **Image size growth** — bundle ~500-700 KB, sourcemaps ~1 MB,
   fonts ~200 KB. Total +1.5-2 MB on a ~250 MB base image. Negligible
   for pilot, log as code-debt for post-pilot bundle-size budget.
7. **Build-time growth** — Vite build adds ~60-90 sec. CI runs
   sequentially: frontend (60-90s) → backend deps (45s) → COPY +
   validate (5s). Total ~3-4 min vs. previous ~2 min. Acceptable.
8. **Workflow `paths:` filter** — `.github/workflows/docker.yml`
   triggers on `public/**` but not `client/**`. After this fix,
   `client/**` changes must trigger image rebuild too. Add to
   workflow.
9. **devDependencies in frontend-builder** — `@vitejs/plugin-react`,
   `vite`, `tailwindcss`, etc. are all in devDeps. Frontend-builder
   does full `npm ci` (no `--omit=dev`). These don't ship to runtime.
10. **public/v2/ contents survive --omit=dev later?** — frontend-
    builder writes to its own `/build/public/v2/`. Backend builder
    COPYs `--from=frontend-builder /build/public/v2 ./public/v2`.
    The backend builder's `npm prune` (if any) doesn't touch
    `public/`. Verified safe.

## Decisions

### BESLUTNING 1: Where to build v2?
ANBEFALING: In Dockerfile (multistage)
HVORFOR: Hermetic. Same input → same output regardless of who runs
the build. No CI-cache dependency. Local docker-compose can rebuild
without external state.
ALTERNATIVER:
- Build in GitHub Actions before docker buildx: faster cached builds
  but two divergent build paths (local vs CI). Risk of "works in CI,
  fails locally".
- Commit `public/v2/` to git: bundle diffs in every PR, maintainer
  forgets to rebuild, defeats `client/` as source-of-truth.
KONSEKVENS HVIS ANNERLEDES: Need to add setup-node + npm ci +
build:client to docker.yml workflow. More YAML to maintain.

### BESLUTNING 2: Separate frontend-builder stage or inline in
existing builder?
ANBEFALING: Separate stage `frontend-builder`
HVORFOR: Cache invalidation is cleaner. Frontend-builder's cache key
is `package-lock.json` + `client/**`. Backend builder's cache key is
`package-lock.json` + `server/**`. Independent invalidation = faster
incremental builds.
ALTERNATIVER:
- Inline in builder: simpler Dockerfile but every server-side change
  triggers full Vite rebuild. Slower iteration.
KONSEKVENS HVIS ANNERLEDES: 60-90 sec extra on every CI build that
only touches server code. Adds up over time.

### BESLUTNING 3: Update workflow `paths:` filter for
`client/**`?
ANBEFALING: Yes
HVORFOR: Without this, a PR that only changes `client/src/*.tsx`
won't trigger a docker rebuild — image stays stale.
ALTERNATIVER:
- Always rebuild on every push: more CI minutes but simpler.
KONSEKVENS HVIS ANNERLEDES: Stale bundle in image after frontend-only
PRs. Fixable later but harder to notice.

## Cross-cutting impact

- Backend services: untouched
- HTTP routes: untouched (server.js already has `tryServeV2App`)
- Database: untouched
- Tests: existing tests pass. No new test infrastructure needed —
  the fix is verified by CI building the image successfully and the
  `/v2/` route serving the bundle in a smoke-test.

## Portainer-oppstartsrisiko (DEL 3 Steg 3b)

YES — Dockerfile change. Christer has explicitly approved per the
2026-05-04 instruction:

> "DIAGNOSE 100% BEKREFTET. Implementer Alt 1 (Multistage Dockerfile-
> fix). Christer godkjenner endringen."

Affected startup path:
1. `docker pull ghcr.io/...:main` (unchanged)
2. Container creates from new image with `public/v2/` populated
3. `docker-entrypoint.sh` (unchanged) runs as root, fixes ownership,
   gosu-drops to node user
4. `node server/index.js` boots
5. `server/http/bootstrap.js` runs migrations (unchanged)
6. HTTP server starts on :7777
7. `/health` returns 200 (unchanged)
8. **NEW:** `/v2/` returns built React bundle (was: 404 fallback to
   v1)

Rollback strategy: revert the Dockerfile commit, push to main. CI
rebuilds image without the frontend-builder stage. Portainer pulls
new `:main`, container restarts, `/v2/` falls back to v1 again. Time
to rollback: ~3-4 min from `git revert` to fresh image deployed.

What can go wrong:
- **Vite build fails in CI** — image build fails, no broken image
  shipped. CI red. Fix and retry.
- **Bundle has a runtime error in browser** — visitor sees blank
  screen at /v2/. Backend keeps working. Workaround: pilot-flag
  fallback or revert.
- **Bundle size unexpectedly huge** — slows pilot user's first
  load. Acceptable for pilot scale (5 users). Monitor.
- **arm64 emulated Vite build OOMs on Actions runner** — 7 GB RAM
  on standard runner. Vite build typically <500 MB peak. Low risk.

## ISO 25010 impact

- Reliability: 8.4 → 8.5 (+0.1) — fixes a pilot-launch blocker, the
  app is more reliably deployable
- Functional Suitability: 8.7 → 8.7 (unchanged) — feature exists,
  this just makes it actually reach users
- Maintainability: 8.6 → 8.5 (-0.1) — Dockerfile gains a stage,
  slightly more cognitive overhead. Acceptable trade.
- Security: 8.2 → 8.2 (unchanged)
- Performance Efficiency: 8.3 → 8.3 (build-time longer; runtime
  unchanged)

## Plan

1. Add `frontend-builder` stage to `Dockerfile` that runs
   `npm run build:client` and produces `/build/public/v2/`
2. In existing `builder` stage, COPY the bundle from frontend-builder
   into `./public/v2`
3. Update `.github/workflows/docker.yml` `paths:` filter to include
   `client/**`
4. Verify locally: `npm run build:client` succeeds, output is in
   `public/v2/`
5. Commit + push, let GitHub Actions build the image
6. CHANGELOG entry under [Unreleased] → "Fixed"
7. Runbook update — document `public/v2/` is built by Docker, not
   committed
8. Code-debt entry — consider GitHub Actions caching of frontend
   build (post-pilot)

## Complexity assessment

This is a high-risk fix in scope (touches Dockerfile + CI workflow)
but small in code (~30 lines added). Christer flagged
PORTAINER-RISIKO and pre-approved.
