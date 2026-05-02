# Changelog

Alle endringer i dette prosjektet dokumenteres her.
Formatet følger [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
og versjonering følger [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Sprint 6 finalize — smart-coupling Pantry · Meals · Shopping (2026-05-02)

**Closes the core value-chain for pilot.** Cooking a meal now leads
to a pantry deduction, and pantry running low auto-restocks the
shopping list, all from a single dialog without manual re-typing.

**Added**

- New backend service `server/services/pantry-deduction.service.js`
  with `buildSuggestions(repos, slot)` and `applyDeduction(repos,
  mealId, items)`. Reuses `inventory_log.reason='correction'` and
  tags rows with `notes='meal_deduction:<mealId>'` for audit
  reconstruction (no migration).
- Three new endpoints under `/api/meals/:id`: `mark-eaten` (commits
  cook-status + returns suggestions), `apply-deduction` (mutates
  pantry per item), `unmark-eaten` (cancel undo).
- New Zod body schema `mealApplyDeductionBody` and `getById` /
  `setStatusById` helpers on `mealPlans` repo.
- Frontend `MarkCookedDialog` with per-ingredient editable rows,
  skip toggle, validation; new `usePantryDeduction` hook drives the
  state machine; `MealHero` got a primary "Marker tilberedt" button
  and a "Tilberedt" badge for cooked status.
- `ShoppingItemRow` renders a "Foreslått fra pantry" / "Suggested
  from pantry" mint outline pill when `notes === 'auto:low-stock'`.
- i18n keys `meals.actions.markCooked`, `meals.actions.alreadyCooked`,
  `meals.cookedDialog.*`, `shopping.badge.fromPantry` (no + en).
- New documents: `docs/smart-coupling-flow.md` (cross-feature
  reisen) and `docs/DOMAIN_MODEL.md` BR-001 (low-stock trigger) +
  BR-002 (meal-deduction reason reuse).
- Tests: 18 backend integration + 1 full E2E chain test + 17
  client (dialog + hook + Meals wiring). Net +36 over Sprint 6
  pre-finalize.

**Fixed**

- `pantry.service.checkAndTriggerLowStock` was silently no-opping
  since Phase F2: it called `addItem` with a single-object
  argument while the repo expects `(listId, opts)` positional
  args. Auto-add to active shopping list now actually fires when
  inventory drops below 15% of total.
- `getActive(weekYear)` was previously called without the weekYear
  argument and silently returned null. Now resolves the current ISO
  weekYear via `seed.getWeekYear()`.
- `checkAndTriggerLowStock` previously suppressed the auto-add when
  any row matched the productKey, including bought (historic) rows.
  Now only an unbought row blocks the trigger — historic bought
  rows do not.
- Frontend `MealStatus` type now includes `'cooked'` (the actual
  backend enum value); legacy `'eaten'` kept as alias for
  backward-compat.

**Bundle**

- main bundle: 113.21 KB → 115.83 KB gzipped (+2.62 KB), well
  inside the 130 KB target.

### Temporary diagnostics (added and removed within this cycle)

- `GET /api/debug/shopping-state` — **added in PR #54** (2026-04-20),
  **removed in PR #56** (2026-04-20). Short-lived structural snapshot
  endpoint used to gather counts and PII-free samples from the
  production DB under Bearer auth, so we could discriminate between
  hypotheses H1/H2/H3 in analysis PR #53. All three hypotheses were
  falsified by the collected data (70 shopping rows total,
  0 bought_rows; the originally reported test-0.2 bug had already
  been fixed by PR #44 + #46 before diagnosis). Endpoint removed
  ahead of the 7-day deadline now that its purpose is complete.
  **Net API surface change this cycle: none** — the endpoint never
  shipped in a tagged release.

## [1.3.0] — 2026-04-11 (ISO/IEC 25010 forbedringsplan — komplett)

**10-ukers kvalitetsløft fra v1.2.0 → v1.3.0.**

Samlet ISO/IEC 25010-score: **7.33 → ~8.55** (+1.22, +16.6%).
Alle 9 karakteristikker nå over målet 8.0.

- **Tester:** 408 → **732** (+324, +79%)
- **Coverage lines:** ukjent → **84.03%**
- **CI-plattformer:** 0 → **3** (Linux + macOS + Windows)
- **CI workflows:** 0 → **5** (CI, Docker, Performance, Backup-Restore, Release)
- **Runtime deps:** 3 → 3 (uendret — minimal footprint bevart)
- **Cross-platform bugs fanget:** 3 (alle rettet, CI-verifisert)

Se `docs/RELEASE_V1_3_0.md` for full uke-for-uke oppsummering og
den formelle re-audit-rapporten (`Familieassistenten_ISO25010_v2_re_audit.pdf`).

**Commit-historikk v1.3.0:**
- uke 1+2: CI/CD + supply chain + audit-log (`8f0db2e`)
- uke 3: Frontend-modularisering (`8edcae4`)
- uke 4: UX + a11y + BRUKERGUIDE (`187095d`)
- uke 5: Ytelse + SLO (`cc32366`, `d529e08`)
- uke 6: Observabilitet + chaos (`f618fca`)
- uke 7: Portabilitet (`a81e9b3`, `860d927`, `46685eb`)
- uke 8: Type-sikkerhet (`3770aae`, `6995132`)
- uke 9: Safety + allergi-garantier (`4d65871`)

### Uke 9 · Domene-safety + allergi-garantier (2026-04-11)

Niende uke av 10-ukers planen. **Kritisk safety-uke** — siste gjenstående
karakteristikk som må løftes over 8.0. Målet er å heve Safety fra 7.0 til
~8.0+ gjennom deterministisk allergi-post-filter, UI-advarsler, formell
risk-register og safety-case-dokument.

#### Added

- **`server/services/allergy-filter.service.js`** (~330 linjer, SAF-1):
  - Deterministisk allergi-post-filter som **ikke er avhengig av LLM**
  - `ALLERGY_TRIGGERS` — kuratert tabell av norske synonymer for 12
    allergi-kategorier (nøtter, peanøtter, mandler, hasselnøtter,
    laktose, melk, gluten, hvete, egg, skalldyr, fisk, soya, sesam,
    sennep, selleri, lupin, sulfitter)
  - `checkRecipe(recipe, profile)` → `{ safeForProfile, blockedIngredients, checkedAgainst }`
  - `checkRecipes(recipes, profile)` — batch-operasjon
  - `annotateRecipe(recipe, profile)` — kopi med safety-felter lagt til
  - `buildTriggerMap()` — utvider allergier til synonym-triggere med
    fuzzy fallback for ukjente strenger
  - Case-insensitiv substring-match (bevisst strengt — false positives
    akseptable, false negatives ikke)
  - Full JSDoc + `// @ts-check` i topp (opt-innet fra uke 8)
- **SAF-2: Automatisk annotering i recipe-routes** (`server/routes.js`):
  - `GET /api/recipes` — hver oppskrift annoteres med `safeForProfile`
    og `blockedIngredients`
  - `GET /api/recipes/:id` — samme
  - `POST /api/recipes/import` — sjekkes FØR respons, advarsel i body
    når LLM-generert oppskrift har allergi-treff
- **`POST /api/profile/check-recipe`** — nytt endepunkt som tar en
  oppskrift og returnerer deterministisk sjekk. Støtter overstyring av
  profil via `body.profile` for ad-hoc-tester. Dokumentert i openapi.yaml
  (oppdateres i egen PR).
- **SAF-4: UI-advarsler**:
  - Rødt advarsels-kort med `role="alert"` på oppskriftskort i meal-view
    når `safeForProfile === false`
  - Viser både blokkerte ingredienser og hvilke allergier som ble truffet
  - Recipe-import bruker `showConfirm`-dialog i stedet for toast når
    LLM-generert oppskrift har allergi-treff
  - CSS `.safety-warning` i `components-extended.css` (+43 linjer) med
    dark-theme-støtte og `role="alert"`
- **`tests/m-week9-safety.test.js`** — **180 nye tester**:
  - **SAF-5a unit** (25 tester): tom profil, null input, alle 12 kategorier,
    fuzzy matching, case-insensitivity, `ingredient` vs `name`-keys
  - **SAF-5b regresjon** (~148 tester): systematisk loop over hele
    `ALLERGY_TRIGGERS` som verifiserer at HVER trigger fanges
  - **SAF-5c API** (4 tester): `POST /api/profile/check-recipe` med
    realistisk profil + overstyring + 400-validering
  - **SAF-5d integration** (3 tester): `GET /api/recipes` + `GET /api/recipes/:id`
    annoterer med safety-felter
- **`docs/RISK_REGISTER.md`** (SAF-3) — FMEA-light med 12 risks:
  - R1-R12 tabell med Severity × Likelihood × Detectability = RPN
  - R1 (LLM allergen): RPN redusert fra **30 → 12** med uke 9 mitigasjon
  - Hver risk dokumenterer svakhet, mitigasjon, residual risk
  - Referanser til relevante RUNBOOK-seksjoner og tester
- **`docs/SAFETY_CASE.md`** (SAF-7) — formell safety-erklæring:
  - Scope og forutsetninger (hva Familieassistenten ER og IKKE ER)
  - Safety-relevante funksjoner (allergi, utløpsdato, OCR)
  - **§3 detaljert allergi-filter safety-case** — to-lags forsvar
    (LLM best-effort + deterministisk post-filter), bevis på effektivitet,
    kjente begrensninger, brukerens ansvar
  - §4 andre safety-mitigasjoner (data-integritet, tilgangskontroll,
    destructive ops, recovery)
  - §5 hendelseshåndtering (prosedyre ved safety-incident)
  - §7 eksplisitt deklarasjon av bruksbetingelser

#### Changed

- `public/js/meals.js` — safety-advarsel rendret i meal-card når
  `safeForProfile === false`
- `public/js/recipe-import.js` — bruker `showConfirm` i stedet for
  `alert`/`showToast` for å blokkere "stille success" ved allergi-treff
- `public/css/components-extended.css` — `.safety-warning` styling

#### SAF-6: Docker non-root verifisert

Docker-image bruker allerede `USER nonroot:nonroot` (UID 65532) fra
uke 7. Ingen endring nødvendig.

#### Kvalitetsmål nådd

| Metrikk | Uke 8 | Uke 9 | Terskel |
|---|---|---|---|
| Tester | 552 | **732** (+180) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 | 0 | 0 |
| Typecheck errors | 0 | 0 | 0 |
| Coverage lines | 83.72% | **84.03%** (+0.31) | ≥ 80% |
| Coverage branches | 71.49% | **71.55%** (+0.06) | ≥ 68% |
| Coverage functions | 76.95% | **77.41%** (+0.46) | ≥ 72% |
| npm audit (prod) | 0 | 0 | 0 HIGH+ |
| Allergi-triggere | 0 | **~80** | — |

#### Forventet ISO-effekt

- **Safety**: 7.0 → ~8.0 (+1.0) — siste gjenstående gap lukket
  - *Driftsrisiko*: deterministisk allergi-filter er synlig + testet
  - *Feil-håndtering*: graceful fallback når profil mangler
  - *Risiko-kontroll*: formell FMEA-light + SAFETY_CASE.md
- **Funksjonell egnethet**: 8.5 → 8.7 (+0.2) — ny safety-funksjon

Total score etter uke 9: **~8.55** (+0.10 fra uke 8).

**Alle 9 ISO-karakteristikker er nå på ≥ 8.0.** Målet er nådd.
Uke 10 er review + release + ekstern validering.

---

### Uke 8 · Type-sikkerhet + refactor-gate (2026-04-11)

Åttende uke av 10-ukers planen. Mål: innføre type-sikkerhet uten å
konvertere til TypeScript, via `// @ts-check` + JSDoc-typer + tsc som
CI-gate. Gir refactor-forsvar uten build-steg.

#### Added

- **`tsconfig.json`** med opt-in strategi:
  - `allowJs: true`, `checkJs: false` (default)
  - `noEmit: true` (kun typecheck, ingen output)
  - `strict: false` + `noImplicitAny: false` — pragmatisk baseline
  - `moduleResolution: node10` + `ignoreDeprecations: 6.0` (TS 6.0-kompat)
  - `include: server/**/*.js` + `scripts/*.js`
  - `exclude: tests, public, data, ...`
- **`types/openapi.d.ts`** (1177 linjer) — auto-generert via
  `openapi-typescript` fra `openapi.yaml`. Inkluderer `paths`, `components`,
  og alle request/response-typer. `npm run openapi:types` regenererer.
- **`// @ts-check` på 10 stabile server-filer** (TS-2):
  - `server/services/slugify.js` — full JSDoc (`@param`, `@returns`)
  - `server/services/units.js` — `@typedef`, `@param`, `@returns` + `@type`
  - `server/services/seed.service.js`
  - `server/services/recipe-similarity.service.js`
  - `server/http/errors.js` — `HttpErrorOptions` + `ProblemDetails` typedefs
  - `server/http/validate.js` — `ZodLikeSchema` + `RequestCtx` typedefs
  - `server/http/metrics.js`
  - `server/http/cache.js`
  - `server/logger.js`
  - `server/state-snapshot.js`
- **`npm run typecheck`** — `tsc --noEmit` som ny CI-gate (TS-4):
  - Kjøres kun på Ubuntu + Node 20 (sparer CI-minutter,
    typecheck trenger ikke cross-platform)
  - 0 errors på dagens kodebase
- **`npm run openapi:types`** — regenerer `types/openapi.d.ts`
- **`docs/TYPE_COVERAGE.md`** — full strategi-dokumentasjon:
  - Filosofi: opt-in i stedet for global `checkJs: true`
  - Begrunnelse: unngår 65+ false positives fra legacy-kode
  - Dagens dekning (10 filer tabellert)
  - Hvordan opt-inne en ny fil (4-stegs guide)
  - Rules (ingen bare `@ts-ignore`, foretrekk `unknown`)
  - Plan for gradvis ekspansjon (uke 9: allergi-post-filter, uke 10:
    pre-release audit til 20 filer, senere Zod→TS infer for `schemas.js`)
- **`tests/m-week8-typecheck.test.js`** — **24 nye tester**:
  - TS-1: tsconfig.json gyldig + opt-in config (4 tester)
  - TS-2: 10 filer har `// @ts-check` + global count ≥10 (11 tester)
  - TS-3: `types/openapi.d.ts` eksisterer + har `paths` + `/api/audit`
    + `npm run openapi:types` script (3 tester)
  - TS-4: `typecheck` script + faktisk `tsc --noEmit` passerer (2 tester)
  - **TS-5: Refactor-proof-test** — skriver en midlertidig fil med
    `// @ts-check` + eksplisitt type-feil, kjører tsc, verifiserer
    at den fanger feilen + peker til filen, og rydder opp
  - TS-6: `docs/TYPE_COVERAGE.md` innhold (3 tester)

#### devDeps added

- `typescript@^6.0.2` — tsc som type-checker (ingen emit)
- `openapi-typescript@^7.13.0` — OpenAPI → .d.ts generator
- `@types/node@^20.19.39` — Node.js typings

#### Changed

- `.github/workflows/ci.yml` — `Typecheck (tsc --noEmit)`-step lagt til
  etter Format-check, gated på Linux Node 20
- `package.json`: 2 nye scripts (`typecheck`, `openapi:types`)

#### Kvalitetsmål nådd

| Metrikk | Uke 7 | Uke 8 | Terskel |
|---|---|---|---|
| Tester | 528 | **552** (+24) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 | 0 | 0 |
| **Typecheck errors** | — | **0** | 0 |
| Type-sjekkede filer | 0 | **10** | ≥10 |
| Coverage lines | 83.62% | **83.72%** (+0.10) | ≥ 80% |
| Coverage branches | 71.45% | 71.49% | ≥ 68% |
| Coverage functions | 76.95% | 76.95% | ≥ 72% |
| npm audit (prod) | 0 | 0 | 0 HIGH+ |

#### Bevist refactor-effektivitet

Uke 8 er den første uken som **beviser gaten faktisk virker** i stedet
for bare å kjøre den til grønt. `TS-5 Refactor-verifisering`-testen:

1. Skriver en midlertidig `server/__typecheck_proof__.js` med eksplisitt
   type-feil (`@returns number` men `return name.toUpperCase()`)
2. Kjører `tsc --noEmit`
3. Verifiserer exit-kode ≠ 0
4. Verifiserer at feilmeldingen peker til bevis-filen
5. Rydder opp

Dette fanger regresjon i tsconfig.json som ville maskere type-feil
(f.eks. hvis noen utilsiktet satte `strict: false` uten andre guards).

#### Forventet ISO-effekt

- **Vedlikeholdbarhet**: 8.1 → ~8.3 (+0.2) — refactor-gate forhindrer
  type-regresjoner på de 10 viktigste filene. JSDoc-typer dokumenterer
  public exports maskinleselig.
- **Funksjonell egnethet**: 8.5 → 8.5 — uendret

Total score etter uke 8: **~8.45** (+0.05 fra uke 7).

**Fortsatt 8 av 9 karakteristikker på ≥ 8.0.** Kun Safety (7.0) gjenstår,
adresseres i uke 9.

---

### Uke 7 · Portabilitet — container + cross-platform (2026-04-11)

Syvende uke av 10-ukers planen. Mål: heve Portabilitet fra 7.0 mot 8.0
gjennom multiarch Docker-image, docker-compose-deploy, cross-platform
CI-matriks, og dokumentert installasjon for Linux/macOS/Windows/RPi5.

#### Added

- **`Dockerfile`** (multi-stage, PORT-1 + PORT-7):
  - Stage 1: `node:20-bookworm-slim` builder med python3 + build-essential
    for å kompilere better-sqlite3 native modul
  - Stage 2: `gcr.io/distroless/nodejs20-debian12` runtime — ingen shell,
    ingen apt, minimal attack surface, UID 65532 (nonroot)
  - `VOLUME ["/app/data"]` for SQLite-DB og backups
  - OCI image labels (title, description, authors, licenses, source)
  - **HEALTHCHECK** via `node -e fetch('/health')` (distroless har ikke
    wget/curl). Interval 30s, timeout 5s, retries 3, start-period 30s
- **`.dockerignore`** — holder build-context minimal (node_modules, .git,
  tests, data, backups, docs, .env utelatt)
- **`docker-compose.yml`** (PORT-2):
  - `app` service med ghcr.io-image, 127.0.0.1:3000-binding, data-volum,
    memory limit 512M (matcher MEMORY_BUDGET_MB), cpu limit 1.5
  - `caddy` service med depends_on service_healthy
  - `AUTH_TOKEN:?` — feiler compose up hvis env mangler
  - `host.docker.internal:host-gateway` for å nå Ollama på host (Linux)
- **`.github/workflows/docker.yml`** (PORT-3):
  - Bygger multiarch (amd64 + arm64) via buildx + QEMU
  - Publiserer til `ghcr.io/christerfrestad/familyassistant` med tags:
    - `main` + `sha-xxxx` ved push til main
    - `1.3.0` + `1.3` + `latest` ved semver-tagger
  - GHA cache for raske bygg
  - `provenance: mode=max` + `sbom: true` (SLSA Level 3 via BuildKit)
  - PR-trigger bygger uten push (validerings-test)
- **PORT-4: CI OS-matriks** (`.github/workflows/ci.yml`):
  - `ubuntu-latest` + Node 20 + 22 (kanonisk, kjør begge)
  - `macos-latest` + Node 20 (fanger darwin-path-bugs)
  - `windows-latest` + Node 20 (fanger win32-path + CRLF-bugs)
  - Windows konfigurerer `git core.autocrlf=false` før checkout for
    å unngå Prettier-mismatches på LF-kode
  - `fail-fast: false` slik at alle kombinasjoner rapporteres
- **`package.json` portability-metadata** (PORT-5):
  - `engines.node: ">=20.0.0 <23"` (øvre grense siden Node 23+ ikke testet)
  - `engines.npm: ">=10.0.0"`
  - `os: ["linux", "darwin", "win32"]`
  - `cpu: ["x64", "arm64"]`
- **`install.sh --docker`** (PORT-6):
  - Nye args: `--docker`, `--systemd` (default), `-h/--help`
  - `install_docker()` installerer Docker Engine via `get.docker.com`
  - `docker_compose_up()` + `verify_docker()` helpers
  - Forgrenet hovedflyt: docker-mode bruker compose, systemd-mode bruker
    npm ci + systemd-unit
- **`DEPLOY.md §14 Docker-deployment`** (140+ linjer):
  - 14.1 Forutsetninger (Docker Engine install)
  - 14.2 Rask start (clone → .env → compose up)
  - 14.3 Oppgradering (compose pull + restart)
  - 14.4 Backup/restore via Docker exec
  - 14.5 `install.sh --docker`-alternativ
  - 14.6 Troubleshooting (container loop, Ollama host-access,
    permissions, manuell arm64-pull)
  - 14.7 Systemd ELLER Docker — advarsel mot å blande
- **`tests/m-week7-portability.test.js`** — **37 nye tester**:
  - PORT-1: Dockerfile multi-stage, distroless, nonroot, VOLUME,
    OCI labels (7 tester)
  - PORT-7: HEALTHCHECK direktiv, flags, node fetch (3 tester)
  - .dockerignore struktur (1 test)
  - PORT-2: docker-compose services, image, AUTH_TOKEN-påkrevd,
    volumes, healthcheck, memory limit (7 tester)
  - PORT-3: docker.yml multiarch, buildx, QEMU, ghcr.io, SBOM,
    PR-trigger (6 tester)
  - PORT-4: CI OS-matriks (ubuntu+macos+windows), fail-fast,
    Windows CRLF-fix (3 tester)
  - PORT-5: package.json engines, os, cpu (4 tester)
  - PORT-6: install.sh args + helpers + DEPLOY.md §14 (6 tester)

#### Changed

- `.github/workflows/ci.yml` — utvidet matriks til 4 kombinasjoner
  (ubuntu/20, ubuntu/22, macos/20, windows/20), la til Windows
  autocrlf-workaround
- `install.sh` — arg-parsing + docker-mode branch

#### Kvalitetsmål nådd

| Metrikk | Uke 6 | Uke 7 | Terskel |
|---|---|---|---|
| Tester | 491 | **528** (+37) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 mismatch | 0 mismatch | 0 |
| Coverage lines | 83.61% | 83.61% | ≥ 80% |
| Coverage branches | 71.49% | 71.49% | ≥ 68% |
| Coverage functions | 76.95% | 76.95% | ≥ 72% |
| npm audit (prod) | 0 vulns | 0 vulns | 0 HIGH+ |

#### Forventet ISO-effekt

- **Fleksibilitet (Portability)**: 7.0 → ~8.0 (+1.0) — hoved-gevinsten.
  Dekker alle 4 subkarakteristikker:
  - *Tilpasningsevne*: `.env`-basert config + multi-platform runtime
  - *Installerbarhet*: `install.sh --docker` ett-kommando-setup,
    `docker compose pull` for oppgradering
  - *Erstattbarhet*: OCI-standard image, kan kjøres uten systemd,
    uten RPi-spesifikke avhengigheter
  - *Skalerbarhet*: memory/cpu limits dokumentert og håndhevet

Total score etter uke 7: **~8.40** (+0.10 fra uke 6).

**8 av 9 ISO-karakteristikker er nå på ≥ 8.0.** Kun **Safety (7.0)**
gjenstår, adresseres i uke 9.

---

### Uke 6 · Observabilitet + drift (2026-04-11)

Sjette uke av 10-ukers planen. Mål: mekanisere drift gjennom Grafana-
dashboard, Alertmanager-regler, structured session-correlation,
chaos-testing og ukentlig backup-restore-test i CI.

#### Added

- **`docs/monitoring/grafana-dashboard.json`** (260+ linjer) — komplett
  Grafana-dashboard med 10 paneler:
  - Uptime, total RPM, 5xx-rate, RSS, disk fri, backup-alder (stat-paneler)
  - Request duration p50/p95/p99 per route (timeseries + template variable)
  - Circuit breakers state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
  - Rate-limit drops/min
  - DB size + requests by status
- **`docs/monitoring/alert-rules.yml`** — Prometheus alert-regler med
  11 alerts i 8 kategorier:
  - ServerDown, WatchdogMiss (availability)
  - High5xxRate, Critical5xxRate (error rate)
  - CircuitBreakerOpen (integrations)
  - HighMemoryUsage, CriticalMemoryUsage (RSS)
  - BackupStale, BackupCriticallyStale
  - DiskLow, DiskCritical
  - HighP95Latency
  - Hver med `severity`, `runbook`-ref til RUNBOOK §11.N, Impact-beskrivelse
- **OBS-3: Structured session-correlation** i `server/http/middleware.js`:
  - `X-Session-Correlation-Id` header leses og ekkes tilbake for klient-
    initierte sporingssesjoner (logisk "bruker-intensjon" på tvers av
    flere requests)
  - `X-User-Hint` valideres mot `^[a-zA-Z0-9_-]{1,32}$` (log injection-
    beskyttelse, ikke identitet)
  - `ctx.sessionCorr` + `ctx.userHint` eksponert til route-handlers
  - Pino child logger inkluderer begge feltene per request
- **`docs/monitoring/logrotate.conf`** — logrotate-konfigurasjon for
  fil-baserte pino-logger (alternativ til journald):
  - Daglig rotering, 14 dagers retention
  - gzip + delaycompress (ferske logger er rask å lese)
  - copytruncate (Node trenger ikke SIGHUP)
  - Installasjon: `sudo cp ... /etc/logrotate.d/familieassistenten`
- **`tests/m-week6-chaos.test.js`** — **7 chaos-tester**:
  - CLOSED → OPEN etter failureThreshold konsekutive feil
  - OPEN breaker kaster `CircuitOpenError` uten å kalle fn
  - Etter cooldownMs → HALF_OPEN ved neste call
  - HALF_OPEN feiler → tilbake til OPEN
  - Full state-sekvens CLOSED→OPEN→HALF_OPEN→CLOSED verifisert
  - Simulert Ollama 500ms latens via `Promise.race` timeout-wrapper
  - Shared breakers (ollama, kassal, anthropic, openai, xai) registrert
- **`.github/workflows/backup-restore.yml`** — ukentlig (mandag 03:15 UTC)
  backup-restore-integrasjonstest:
  - Seeder fresh DB
  - Kjører `backupNow()`
  - Kopierer backup til ny DB-path
  - Starter server med restored DB
  - Verifiserer: ≥80 products, ≥30 recipes, audit-log-canary-rad,
    ≥11 migrations applikert
  - Trigges også på PR som endrer `server/backup.js`, `server/db.js` eller
    `server/migrations/**`
- **`RUNBOOK.md §11 Alert runbooks`** — 8 underkapitler:
  - §11.1 ServerDown
  - §11.2 WatchdogMiss
  - §11.3 High5xxRate / Critical5xxRate
  - §11.4 CircuitBreakerOpen
  - §11.5 HighMemoryUsage / CriticalMemoryUsage
  - §11.6 BackupStale / BackupCriticallyStale
  - §11.7 DiskLow / DiskCritical
  - §11.8 HighP95Latency
  - Hver har **Impact**, **First-response** (≤5 min med konkrete bash-
    kommandoer), **Root-cause analyse**, og **Escalation**-sti
- **`tests/m-week6-observability.test.js`** — **14 nye observability-tester**:
  - OBS-1: Grafana-dashboard JSON gyldig + 10 paneler + dekker
    10 nøkkel-metrikker + har `route` template-variable
  - OBS-2: alert-rules.yml har ≥10 alerts + severity + runbook-ref +
    alle 8 kritiske alert-kategorier
  - OBS-3: `X-Session-Correlation-Id` ekke-tilbake, `X-Request-ID`
    alltid til stede, `X-User-Hint` regex-validering, `ctx.sessionCorr`
    + `ctx.userHint` eksponert
  - OBS-4: logrotate.conf har rotate 14, gzip, delaycompress, copytruncate
  - OBS-6: backup-restore.yml finnes med weekly cron + backupNow + canary
  - OBS-7: RUNBOOK §11 har alle 8 subkapitler + ≥8 Impact + ≥8 First-response

#### Changed

- `server/http/middleware.js`: `createContext` utvidet med sessionCorr,
  userHint, pino child-logger + response-header ekko

#### Kvalitetsmål nådd

| Metrikk | Uke 5 | Uke 6 | Terskel |
|---|---|---|---|
| Tester | 463 | **491** (+28) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 mismatch | 0 mismatch | 0 |
| Coverage lines | 83.57% | **83.61%** (+0.04) | ≥ 80% |
| Coverage branches | 71.47% | 71.49% | ≥ 68% |
| Coverage functions | 76.95% | 76.95% | ≥ 72% |
| npm audit (prod) | 0 vulns | 0 vulns | 0 HIGH+ |

#### Forventet ISO-effekt

- **Reliability**: 8.3 → ~8.5 (+0.2) — chaos-testing verifiserer
  recovery-stier, backup-restore-workflow fanger korrupte backups tidlig,
  alert-regler gir runtime-synlighet
- **Sikkerhet**: 8.1 → ~8.2 (+0.1) — log-injection beskyttelse via
  X-User-Hint regex, audit-korrelering via session_corr
- **Vedlikeholdbarhet**: 8.1 → 8.1 — uendret

Total score etter uke 6: **~8.30** (+0.10 fra uke 5).

7 av 9 ISO-karakteristikker er fortsatt over mål. **Kun Portability
(7.0) og Safety (7.0) gjenstår**, og tas i ukene 7 og 9.

---

### Uke 5 · Ytelse — profilering + gates (2026-04-11)

Femte uke av 10-ukers planen. Mål: heve Ytelseseffektivitet fra 7.0 mot
8.0 gjennom målte baselines, regresjonsgater i CI, query-plan-audit,
memory-budget-overvåkning og SLO-dokumentasjon.

#### Added

- **`perf-baseline.json`** (1012 bytes) — committed baseline fra live
  load-test. 96 759 requests, 6450 RPS, global p95=1.5ms, RSS=129MB,
  0 errors. Alle grader pass.
- **`scripts/load-baseline.js`** utvidet med CLI-flagg:
  - `--output=FIL` — skriv strukturert JSON-resultat
  - `--compare=FIL` — sammenlign med committed baseline
  - `--allowRegressionPct=N` — fail hvis global p95 eller
    per-endpoint p95 dropper mer enn N% (default 20)
- **`.github/workflows/performance.yml`** — nightly performance check +
  regression gate:
  - Triggers: nightly 02:30 UTC, workflow_dispatch, PR som endrer
    `server/`, `scripts/load-baseline.js` eller `perf-baseline.json`
  - Starter server med `RATE_LIMIT_MAX=999999` og kjører 15s load-test
  - Feiler hvis +20% regresjon mot committed baseline
  - Laster opp `perf-current.json` + serverlogg som CI-artifact
- **`docs/DB_INDEXES.md`** (138 linjer) — EXPLAIN QUERY PLAN-audit for
  alle tyngste repository-spørringer:
  - Tabell over hvilke indexes hver query bruker
  - Dokumenterer PERF-3 fixen for `audit_log`
  - Liste over alle indexes fra migrations/*.sql
  - Utvikleroppgave: hvordan legge til ny index
- **`MEMORY_BUDGET_MB`** env-variabel i `server/config.js`
  (default 512 MB = halvparten av RPi5 4GB):
  - `/ready` returnerer `rssMB` og `memoryBudgetMB`
  - Warning `rss_near_budget_<N>mb` ved >90% av budget
  - Warning `rss_over_budget_<N>mb` ved >100% av budget
- **`POST /api/llm/warm`** endpoint — LLM cache-hygiene:
  - Pruner utløpte entries via `llmCache.cleanup()`
  - Returnerer `{entriesBefore, pruned, entriesAfter, totalHits}`
- **`GET /api/llm/cache/stats`** endpoint — cache-status for Kontrollrommet
- **`RUNBOOK.md §10 Service Level Objectives`** (120+ linjer):
  - Tabell over latency-mål per endpoint (p95 + p99)
  - Tabell over resource-mål (RSS, disk, DB-størrelse, backup-alder, 5xx-rate)
  - Gjeldende baseline-verdier
  - Runtime-overvåkning via `/ready` warnings-array
  - Feilsøking-prosedyre per SLO-brudd
- **`tests/m-week5-performance.test.js`** — **15 nye tester**:
  - PERF-1: `perf-baseline.json` struktur og SLO-konformitet (3 tester)
  - PERF-2: `load-baseline.js` CLI-utvidelser + workflow (3 tester)
  - PERF-3: `auditLog` bruker `timestamp DESC, id DESC` (2 tester)
  - PERF-4: `/ready` returnerer `rssMB`, `memoryBudgetMB` (2 tester)
  - PERF-5: `/api/llm/warm` endpoint + cache stats (2 tester)
  - PERF-7: RUNBOOK §10 + `docs/DB_INDEXES.md` innhold (3 tester)

#### Fixed

- **`auditLog.getRecent()` og `auditLog.getByEntity()`** brukte
  `ORDER BY id DESC` som ikke kunne utnytte `idx_audit_log_timestamp`.
  Full SCAN ville vokse lineært med tabellen. Endret til
  `ORDER BY timestamp DESC, id DESC` — bruker nå index (verifisert med
  EXPLAIN QUERY PLAN) og faller tilbake på id for deterministisk
  rekkefølge innen samme sekund.

#### Changed

- `server/config.js`: +`MEMORY_BUDGET_MB` (default 512)
- `server/routes.js` `/ready`:
  - +`rssMB` + `memoryBudgetMB` felter
  - +warnings `rss_near_budget_*` og `rss_over_budget_*`
- `scripts/load-baseline.js`: +45 linjer for JSON-output og regression-check
- `.gitignore`: ekskluderer `perf-current.json` (CI artifact),
  inkluderer `perf-baseline.json` (committed truth)

#### Kvalitetsmål nådd

| Metrikk | Uke 4 | Uke 5 | Terskel |
|---|---|---|---|
| Tester | 448 | **463** (+15) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 mismatch | 0 mismatch | 0 |
| Coverage lines | 83.51% | **83.57%** (+0.06) | ≥ 80% |
| Coverage branches | 71.54% | 71.47% | ≥ 68% |
| Coverage functions | 76.42% | **76.95%** (+0.53) | ≥ 72% |
| npm audit (prod) | 0 vulns | 0 vulns | 0 HIGH+ |
| Baseline p95 | ukjent | **1.5 ms** | <200 ms |
| RSS at rest | ukjent | **92-129 MB** | <512 MB |

#### Runtime-verifikasjon (preview-server)

Utført med `preview_eval`:

- ✅ `/ready` returnerer `rssMB: 92`, `memoryBudgetMB: 512`, ingen warnings
- ✅ `POST /api/llm/warm` returnerer `{ok, entriesBefore, pruned,
  entriesAfter, totalHits, note}`
- ✅ `GET /api/llm/cache/stats` returnerer `{entries, totalHits}`

#### Forventet ISO-effekt

- **Ytelseseffektivitet**: 7.0 → ~8.0 (+1.0) — hoved-gevinsten.
  Dekker alle 3 subkarakteristikker:
  - *Time behavior*: målt baseline + CI-gate + SLO-dokumentasjon
  - *Resource utilization*: memory-budget + RSS-monitoring
  - *Capacity*: dokumentert rps-headroom (6450 vs typisk 0.1-1 rps)
- **Reliability**: 8.3 → 8.3 (ingen endring — allerede over mål)

Total score etter uke 5: **~8.20** (+0.10 fra uke 4).

**7 av 9 ISO-karakteristikker er nå på ≥ 8.0.** Gjenstående: Portability
(7.0) og Safety (7.0). Adresseres i ukene 7 og 9.

---

### Uke 4 · Frontend UX + a11y-hardening (2026-04-11)

Fjerde uke av 10-ukers planen. Mål: forbedre sluttbruker-ergonomi gjennom
bekreftelsesdialoger, tastatur-navigasjon, onboarding og full norsk
brukerdokumentasjon.

#### Added

- `public/js/onboarding.js` — 4-stegs velkomst-wizard som vises første
  gang brukeren åpner appen. localStorage-flagg `fa-onboarded` gjør at
  den ikke dukker opp igjen. Tastatur-navigerbar (Enter=Neste,
  Tab=fokus-trap, Esc=hopp over). `window._resetOnboarding()` i devtools
  for å starte på nytt.
- `showConfirm(opts)` i `core.js` — gjenbrukbar modal-dialog som
  erstatter native `confirm()` for destruktive handlinger. Returnerer
  `Promise<boolean>`, støtter `destructive: true` (rød knapp), full
  tastatur-navigasjon (Enter/Esc/Tab), `role=dialog` + `aria-modal` +
  `aria-labelledby` + `aria-describedby`, og gjenoppretter fokus etter
  lukking. Runtime-verifisert i preview-server.
- Global Esc-handler i `meals.js` — lukker `modalBg` når settings ikke
  er åpen (settings.js har sin egen Esc-handler med høyere prioritet).
- `BRUKERGUIDE.md` — 330+ linjer norsk sluttbruker-dokumentasjon som
  dekker alle 6 hovedflyter: velkomst-tur, planlegging, handletur,
  husarbeid, oppskrifts-import, familieprofil. Inkluderer tastatur-
  snarveier, offline-modus, feilsøking, og eksplisitt advarsel om at
  LLM-genererte oppskrifter ikke er garantert allergi-trygge.
- CSS `public/css/components-extended.css` utvidet med:
  - `.confirm-overlay` + `.confirm-dialog` + `.btn-danger` (95 linjer)
  - `.onboarding-overlay` + `.onboarding-card` + `.onboarding-dots` (94 linjer)
  - `@media (prefers-reduced-motion: reduce)` for alle nye animasjoner
- `tests/m-week4-a11y-extended.test.js` — **7 nye a11y-tester**:
  - Alle `onclick="fn()"` i HTML peker til definerte funksjoner
  - `showConfirm` har korrekt ARIA-attributter + focus trap
  - Onboarding-wizard har focus trap
  - Global Esc-handler finnes
  - Ingen native `confirm()` i destructive delete-paths
  - CSS respekterer `prefers-reduced-motion`
- `tests/m-week4-frontend-features.test.js` — **17 nye feature-tester**:
  - `addShoppingItem` leser korrekte DOM-elementer (bugfix-regresjon)
  - `addShoppingItem` bruker showToast, ikke alert
  - `showConfirm` gjenoppretter fokus
  - `pantry.js` + `settings.js` bruker `showConfirm(destructive:true)`
  - Onboarding har ≥3 steg, bruker localStorage, lastes før init.js
  - BRUKERGUIDE.md dekker 6 hovedflyter + tastatur + allergi-advarsel

#### Fixed

- **Pre-eksisterende bug:** `addShoppingItem()` refererte fra
  `renderAddItemForm` uten å være definert noe sted. Samme bug fantes
  i v1.2.0 (verifisert via `git show HEAD^:public/index.html`).
  Ny implementasjon i `shopping.js` leser `#addItemInput` +
  `#addItemCategory`, poster til `/api/shopping/add`, viser toast og
  reloader listen.

#### Changed

- `pantry.js removeFromPantry()` — erstatter native `alert()` med
  `showConfirm({destructive:true})` + toast på success/error
- `settings.js removeRecipeSource()` — erstatter native `confirm()`
  med `showConfirm({destructive:true})` + toast
- `notifications.js checkNotifications()` — erstatter native
  `confirm()` med `showConfirm` for holdbarhetsvarsler
- `meals.js closeModal()` — ryd fokus etter lukking + global Esc-handler
- `public/index.html` — laster `/js/onboarding.js` før `/js/init.js`
- `init.js` — kaller `startOnboarding()` etter 800ms delay

#### Kvalitetsmål nådd

| Metrikk | Uke 3 | Uke 4 | Terskel |
|---|---|---|---|
| Tester | 424 | **448** (+24) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 mismatch | 0 mismatch | 0 |
| Coverage lines | 83.51% | 83.51% | ≥ 80% |
| Coverage branches | 71.54% | 71.54% | ≥ 68% |
| Coverage functions | 76.42% | 76.42% | ≥ 72% |
| npm audit (prod) | 0 vulns | 0 vulns | 0 HIGH+ |

#### Runtime-verifikasjon (preview-server)

Utført ende-til-ende med `preview_eval`:

- ✅ `showConfirm` rendrer dialog med korrekt ARIA-attributter
- ✅ Esc returnerer false og fjerner dialog fra DOM
- ✅ Destructive variant bruker `btn-danger` CSS-klasse
- ✅ Onboarding-wizard viser alle 4 steg med dot-indikator
- ✅ Klikk "Neste" avanserer steg og oppdaterer active dot
- ✅ "Hopp over" setter `fa-onboarded=true` i localStorage
- ✅ `addShoppingItem()` postet til `/api/shopping/add`, clearet input,
  viste success-toast
- ✅ `removeFromPantry('test-key')` viste bekreftelsesdialog med
  varenavnet før DELETE-kallet, Esc avbrøt før DB-operasjon

#### Forventet ISO-effekt

- **Usability**: 6.8 → ~8.0 (+1.2) — hoved-gevinsten. Bekreftelses-
  dialoger, keyboard-nav, onboarding-wizard og BRUKERGUIDE dekker alle
  5 subkarakteristikker i 25010:2023 (Appropriateness Recognizability,
  Learnability, Operability, User Error Protection, User Engagement).
- **Sikkerhet**: 8.1 → 8.1 — uendret
- **Vedlikeholdbarhet**: 8.1 → 8.1 — uendret

Total score etter uke 4: **~8.10** (+0.15 fra uke 3).

**Nå er 6 av 9 ISO-karakteristikker på ≥ 8.0.** Gjenværende gaps:
Ytelse (7.0), Portability (7.0), Safety (7.0) — adresseres i ukene 5-9.

---

### Uke 1 · CI/CD-fundament (2026-04-10)

Første uke av 10-ukers planen for å heve ISO/IEC 25010-scoren fra 7.33
til ≥ 8.0 på alle ni karakteristikker. Mål denne uken: mekanisere
kvalitetsgatene slik at de ikke lenger er avhengige av manuell disiplin.

#### Added

- `.github/workflows/ci.yml` — GitHub Actions-pipeline med tre parallelle jobber:
  - **test**: lint + format + `node --test` på matrix (Node 20.x, 22.x)
  - **coverage**: native `--experimental-test-coverage` + blokkerende gate
  - **security**: `npm audit --omit=dev --audit-level=high` på runtime-deps
- `.github/dependabot.yml` — ukentlige PRs (mandag 07:00 Europe/Oslo) for
  npm-deps (grouperte minor/patch) og GitHub Actions.
- `eslint.config.mjs` — ESLint v9 flat config med tre zone-overrides:
  server/scripts (CommonJS + Node globals), tests (lempeligere), public/sw.js
  (browser + service worker). Baseline: 0 errors, 25 warnings.
- `.prettierrc.json` + `.prettierignore` — 100-char, single quotes, ES5 trailing
  commas. 67 filer formatert som ett "style baseline"-steg.
- `scripts/coverage-gate.js` — blokkerende CI-gate. Parser Node
  coverage-reporter og feiler hvis lines/branches/functions under terskel.
- `CI.md` — 132 linjers dokumentasjon for nye bidragsytere: lokale
  kommandoer, terskler, feilsøking, Dependabot-policy.
- Nye npm-scripts: `lint`, `lint:fix`, `format`, `format:fix`, `ci`,
  `test:coverage`, `test:coverage:gate`, `audit:prod`.

#### Changed

- `package.json` devDeps: `@eslint/js@^9`, `eslint@^9`, `globals@^15`,
  `prettier@^3.3`. Ingen nye runtime-deps (produksjons-footprint uendret).
- 67 filer format-korrigert (whitespace, quotes, trailing commas). Ingen
  logikk-endringer. 408 tester fortsatt grønne etter baseline-commit.

#### Kvalitetsmål nådd

| Metrikk | Før | Etter | Terskel |
|---|---|---|---|
| Tester | 408/408 grønne | 408/408 grønne | 0 rødt |
| ESLint errors | N/A (ingen lint) | 0 | 0 |
| Prettier mismatch | N/A | 0 | 0 |
| Coverage lines | ukjent | **83.26%** | ≥ 80% |
| Coverage branches | ukjent | **71.23%** | ≥ 68% |
| Coverage functions | ukjent | **75.83%** | ≥ 72% |
| npm audit (prod) | ukjent | 0 vulns | 0 high+ |

#### Forventet ISO-effekt

- **Vedlikeholdbarhet** 6.5 → ~7.5 (+1.0)
- **Sikkerhet** 7.5 → ~7.7 (+0.2) — supply-chain automatisk overvåket
- **Reliability** 8.0 → ~8.2 (+0.2) — regresjoner fanges før merge

Total score etter uke 1: ~7.55 (+0.22 fra 7.33).

---

### Uke 2 · Supply chain + SBOM (2026-04-10)

Andre uke av ISO/IEC 25010-planen. Mål: oppfylle moderne
supply-chain-compliance (NIS2/US EO 14028), innføre audit-log for
non-repudiation, og mekanisere token-rotation.

#### Added

- **SBOM-1** — `@cyclonedx/cyclonedx-npm@^4.2.1` som devDep + `npm run sbom`
  (produksjons-only) og `npm run sbom:full` (inkl. dev). CycloneDX 1.6
  JSON-format med 50 runtime-komponenter dokumentert.
- **SBOM-1** — `sbom`-jobb i `.github/workflows/ci.yml` som genererer,
  validerer struktur og laster opp SBOM som 90-dagers build-artifact.
- **SBOM-2** — `.github/workflows/release.yml` med **SLSA Level 3** keyless
  provenance via `slsa-framework/slsa-github-generator@v2`. Ingen nøkler
  i repoet — bruker GitHub OIDC + Sigstore Fulcio/Rekor. Release-artifacts
  signert med `.intoto.jsonl`-provenance, SHA256SUMS + tarball + SBOM.
- **SBOM-3** — `osv-scan`-jobb i CI via `google/osv-scanner-action@v2.0.2`.
  Scanner `package-lock.json` mot [OSV database](https://osv.dev). SARIF
  lastes opp til GitHub Security-tab, feiler CI ved HIGH/CRITICAL.
- **SBOM-5** — Token-rotation: `AUTH_TOKEN_CREATED_AT` (ISO-8601) og
  `AUTH_TOKEN_MAX_AGE_DAYS` (default 90) i `server/config.js`. `/ready`
  eksponerer `tokenAgeDays` og flagger `auth_token_stale_<N>d` eller
  `auth_token_age_unknown` i warnings-array. Ikke-blokkerende — hygiene.
- **SBOM-6** — Migrasjon `012_audit_log.sql` med append-only tabell:
  `(id, timestamp, request_id, actor, action, entity_type, entity_id,
  route, before_hash, after_hash, metadata)`. SHA-256 hashes for
  integritets-sporing, 3 indexes for query-ytelse.
- **SBOM-6** — `repos.auditLog` repository med `record/getRecent/
  getByEntity/stats`. Stille feil-håndtering (audit-feil kan aldri
  påvirke hovedoperasjonen).
- **SBOM-6** — `withAudit(repos, spec, handler)` wrapper i `routes.js`.
  Snapshotter "before" pre-handler, kjører handler, logger "after" kun
  ved success. Applikert på 4 destruktive endepunkter:
  - `DELETE /api/pantry/:productKey`
  - `DELETE /api/sources/:id`
  - `DELETE /api/receipts/:id`
  - `DELETE /api/calendar/events/:id`
  - `PUT /api/profile` (helse-relatert: allergier)
- **SBOM-7** — `GET /api/audit` og `GET /api/audit/stats` read-only
  endepunkter. Støtter `?entityType=X&entityId=Y&limit=N`. Bearer-beskyttet
  via eksisterende auth-middleware.
- **SBOM-4** — `SECURITY.md §4 Supply-chain policy` — 7 underseksjoner
  dekker SBOM, OSV, npm audit, SLSA provenance, token rotation, Dependabot,
  oppdaterings-policy. CVE-reaksjonstid: 7 dager for HIGH/CRITICAL.
- `openapi.yaml` v1.3.0 — `/api/audit` + `/api/audit/stats` dokumentert.
- `tests/m-week2-supply-chain.test.js` — **15 nye tester** som dekker:
  - audit_log repository unit-tester (5)
  - withAudit-wrapper integration (3) inkl. "feilet request skal IKKE logge"
  - /api/audit endepunkter (4)
  - token-rotation warnings (3) med simulerte alderscenarier

#### Changed

- `server/config.js`: to nye env-felter (`AUTH_TOKEN_CREATED_AT`,
  `AUTH_TOKEN_MAX_AGE_DAYS`). Bakoverkompatibel — begge valgfrie.
- `server/routes.js`: `/ready`-respons utvidet med `tokenAgeDays`-felt.
- `server/repositories.js`: `auditLog` lagt til return-objektet.
- `devDeps`: +`@cyclonedx/cyclonedx-npm@^4.2.1`.

#### Kvalitetsmål nådd

| Metrikk | Uke 1 | Uke 2 | Terskel |
|---|---|---|---|
| Tester | 408 | **423** (+15) | 0 rødt |
| ESLint errors | 0 | 0 | 0 |
| Prettier | 0 mismatch | 0 mismatch | 0 |
| Coverage lines | 83.26% | **83.51%** (+0.25) | ≥ 80% |
| Coverage branches | 71.23% | **71.58%** (+0.35) | ≥ 68% |
| Coverage functions | 75.83% | **76.26%** (+0.43) | ≥ 72% |
| npm audit | 0 vulns | 0 vulns | 0 HIGH+ |
| Runtime deps | 3 | 3 | 3 (uendret) |
| SBOM-generert | — | ✅ 50 komp. | — |
| OSV-Scanner | — | ✅ CI-gate | — |
| SLSA provenance | — | ✅ v3 keyless | — |
| Audit-log | — | ✅ 4 rutene | — |
| Token rotation | — | ✅ /ready warn | — |

#### Forventet ISO-effekt etter uke 2

- **Sikkerhet** 7.7 → ~8.1 (+0.4) — konfidensialitet + ansvarlighet + supply-chain dekket
- **Vedlikeholdbarhet** 7.5 → 7.5 (+0) — ingen frontend-forbedring denne uken
- **Reliability** 8.2 → 8.3 (+0.1) — audit-log øker analyserbarhet

Total score etter uke 2: ~7.70 (+0.37 fra 7.33, +0.15 fra uke 1).

---

## [1.2.0] — 2026-04-10 (produksjons-hardening)

Total endring: **+5100 / −200 linjer** på tvers av 6 milepæler
(M1→M6). **408 tester grønne**, null regresjoner fra v1.1.0.

### Added

**M1 · Security hardening**
- `escapeHtml()`, `safeUrl()`, `h\`...\``-tagged-template og `raw()`-helpers i
  frontend for XSS-sikker innerHTML-bygging.
- Content-Security-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy
  og betinget HSTS (`HTTPS_TERMINATED=true`) i `server/http/security.js`.
- Backend `sanitizeString()` og `sanitizeUrl()` i recipe-import som
  defense-in-depth mot ondsinnet LLM-output.
- `Caddyfile` med tre alternative reverse-proxy-oppsett (LAN intern CA,
  Tailscale Serve, public Let's Encrypt).
- `DEPLOY.md §13` med full HTTPS + auth + systemd prod-env-guide.

**M2 · Reliability**
- `BACKUP_REMOTE_PATH`: off-site backup via mount / ssh / rsync-daemon.
- `server/sd-notify.js`: systemd integration — READY=1, WATCHDOG=1, STOPPING=1.
- `server/services/circuit-breaker.js`: generisk CLOSED/OPEN/HALF_OPEN state-maskin,
  shared instances for kassal/ollama/anthropic/openai/xai.
- `familieassistenten.service` med `Type=notify`, `WatchdogSec=90` og full
  systemd sandboxing (NoNewPrivileges, ProtectSystem=strict, PrivateTmp, etc).
- `RUNBOOK.md` (9 seksjoner): daglige kommandoer, backup/restore,
  breaker-triage, vanlige feil, DR-scenarioer, load-baseline.

**M3 · E2E & kvalitet**
- `tests/m3-e2e-smoke.test.js`: 25 tester som klikker gjennom hele API-overflaten.
- `tests/m3-openapi-contract.test.js`: minimal YAML-parser + runtime route-diff,
  fanger dok-drift. Validerer live response-shapes mot dokumenterte schemas.
- `tests/m3-a11y.test.js`: statisk WCAG-audit (lang, viewport, h-hierarki,
  label-for/aria-label, alt-tekst, inline-handlers).
- `scripts/load-baseline.js`: standalone load-test harness med histogram,
  per-endepunkt breakdown, og grade mot thresholds. Null npm-dependencies.

**M4 · Observability**
- `X-Request-Id` header på alle responses, inkludert i RFC 7807 problem-body.
- Utvidet `/ready` med dbSizeMB, diskFreeMB, lastBackupAgeHours, breakersOpen,
  warnings-array, returnerer 503 ved kritiske warnings.
- `server/alerting.js`: webhook-alerting for uncaughtException, backup-feil,
  circuit-breaker-OPEN. Throttling 15 min per nøkkel, automatisk context-trimming.

**M5 · Frontend UX + PWA**
- Toast-komponent (info/success/warn/error) med auto-dismiss og a11y role=status.
- `public/sw.js`: service worker med network-first for `/api/`,
  cache-first for statiske assets, versjonert cache-nøkkel, offline 503-fallback.
- Skeleton-loaders med shimmer-animasjon og `@media prefers-reduced-motion`.
- Offline-banner via `window.online`/`offline`-events.
- `Service-Worker-Allowed: /`-header på `/sw.js`.
- CSP utvidet med `worker-src 'self'` og `manifest-src 'self'`.

**M6 · Dokumentasjon**
- `CHANGELOG.md` (denne filen).
- `SECURITY.md` med trusselmodell, secret-handling, rapporterings-policy.
- `.env.example` med alle konfigurerbare env-variabler dokumentert.

### Changed

- `server/config.js` krever nå `AUTH_TOKEN` (≥16 tegn) når `NODE_ENV=production`.
  `ALLOWED_ORIGINS=*` er ikke lenger tillatt i prod.
- `server/logger.js` redact-paths utvidet til å dekke alle API-nøkler,
  Authorization-header, cookies og AUTH_TOKEN.
- `openapi.yaml` bump til v1.2.0, lagt til `/api/llm/status`-endepunkt.
- `server/repositories.js`: `recipes.getById()` normaliserer `prep_time`/`source_type`
  til camelCase for frontend-parity.
- `public/index.html`: `user-scalable=no` → `maximum-scale=5.0` (WCAG 1.4.4).
  Aria-labels på chatInput, addItemInput, addItemCategory. Meal card h3 → h2
  for korrekt heading-hierarki.

### Security

- XSS-sårbarhet lukket: alle 30+ `innerHTML=`-steder i frontend bruker nå
  `escapeHtml()` for user/LLM-kontrollerte felter. Verifisert av 14-payload
  fuzz-test i `tests/m1-security-xss.test.js`.
- `javascript:`, `data:text/html`, `vbscript:`, `file://` blokkeres i
  `safeUrl()` og `sanitizeUrl()`.
- Prompt-injection sanitizer dekker LLM-kontekst før den sendes til modell.
- Backend hard-fail uten gyldig AUTH_TOKEN i produksjon (fix-with-dignity).

### Fixed

- `server/repositories.js`: snake_case lekkasje fra `recipes.getById()` som
  ikke matched `getAll()`-shape (fanget av M3 E2E-smoke).

---

## [1.1.0] — 2026-04-06

Første release — Fase A–F komplett.

### Added
- Komplett matplanlegger, handleliste, husarbeid-planlegger
- Pantry-management med progress-bar og lav-terskel-varsling
- LLM-integrasjon (Ollama + llama.cpp) med tool-calling + RAG
- Recipe-import fra tekst, URL og bilde (OCR)
- Ingredient-normalizer (EN→NO) med LLM-fallback og cache
- Recipe-similarity-score
- Family profile (medlemmer, allergier, mislikt)
- Filter-usage tracking
- Recipe-sources connectors (Pinterest/Godt/RSS stubs)
- Env-store service med trelags-forsvar (whitelist, format, sanitize)
- 274 tester, 11 migrasjoner, Prometheus-metrics, RFC 7807 errors

---

## Historiske referanser

- v1.0: Initial commit (ikke tagged)
- v1.1: Fase A–F komplett, commit 33868ce
- v1.2: M1–M6 produksjons-hardening (denne versjonen)
