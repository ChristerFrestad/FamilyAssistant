# Release v1.3.0 — ISO/IEC 25010 kvalitetsløft

**Release-dato:** 2026-04-11
**Base-versjon:** v1.2.0 (produksjons-hardening)
**Plan-dokument:** `Familieassistenten_ISO25010_v1_2_0.pdf`

---

## TL;DR

v1.3.0 er resultatet av en strukturert 10-ukers ISO/IEC 25010-forbedringsplan
som løftet samlet kvalitetsscore fra **7.33** til **~8.55**, og brakte
**alle 9 karakteristikker** over mål-terskelen på 8.0 for første gang.

| Metrikk | v1.2.0 | v1.3.0 | Endring |
|---|---|---|---|
| Tester | 408 | **732** | +324 (+79%) |
| LOC | 16 811 | 28 902 | +12 091 |
| ESLint errors | N/A | **0** | ny gate |
| Typecheck errors | N/A | **0** | ny gate |
| Coverage lines | ukjent | **84.03%** | ny metrikk |
| CI-plattformer | 0 | **3** (Linux/macOS/Win) | ny |
| ISO-karakteristikker ≥ 8.0 | 3 av 9 | **9 av 9** | +6 |
| Samlet ISO-score | 7.33 | **~8.55** | +1.22 |

---

## Uke-for-uke leveranser

### Uke 1 — CI/CD-fundament
- GitHub Actions CI/CD (test, coverage, security)
- Dependabot weekly updates
- ESLint v9 flat config + Prettier
- Coverage-gate via native Node `--experimental-test-coverage`
- `CI.md` (132 linjer) utviklings-dokumentasjon
- **ISO-effekt:** Vedlikeholdbarhet +1.0

### Uke 2 — Supply chain + SBOM
- CycloneDX 1.6 SBOM ved hver push
- OSV-Scanner (Google OSV database)
- SLSA Level 3 keyless provenance (release-workflow)
- Token-rotation warning i `/ready`
- Audit-log migrasjon 012 + `withAudit`-wrapper + `/api/audit`
- `SECURITY.md §4 Supply-chain policy`
- **ISO-effekt:** Sikkerhet +0.4

### Uke 3 — Frontend-modularisering
- `public/index.html`: 3939 → 215 linjer (-94%)
- 14 JS-moduler i `public/js/` (1988 linjer totalt)
- 4 CSS-filer i `public/css/` (1761 linjer)
- Service worker pre-caching alle statiske filer
- Defensive test-endringer (scanner `public/js/*` konkatenert)
- **ISO-effekt:** Vedlikeholdbarhet +0.6

### Uke 4 — Frontend UX + a11y
- `showConfirm()` utility (Promise-basert, ARIA, fokus-trap)
- `removeFromPantry/removeRecipeSource/notifications` bruker showConfirm
- Global Esc-handler for `modalBg`
- Onboarding-wizard 4 steg med localStorage-flagg
- `BRUKERGUIDE.md` 330+ linjer norsk
- `addShoppingItem()` bugfix (pre-eksisterende fra v1.2)
- **ISO-effekt:** Usability +1.2

### Uke 5 — Ytelse + SLO
- `perf-baseline.json` committed (96 759 req, p95=1.5ms, RSS=129MB)
- `scripts/load-baseline.js` utvidet med `--output`, `--compare`
- `.github/workflows/performance.yml` nightly + PR-trigger
- `docs/DB_INDEXES.md` EXPLAIN QUERY PLAN-audit
- **PERF-3 fix:** `audit_log.getRecent` bruker nå `timestamp DESC, id DESC`
- `MEMORY_BUDGET_MB` env + `/ready` RSS-warnings
- `POST /api/llm/warm` + `GET /api/llm/cache/stats`
- `RUNBOOK.md §10 SLO` (120+ linjer)
- **ISO-effekt:** Ytelse +1.0

### Uke 6 — Observabilitet + drift
- `docs/monitoring/grafana-dashboard.json` 10 paneler
- `docs/monitoring/alert-rules.yml` 11 Prometheus alerts
- Structured session-correlation (`X-Session-Correlation-Id`, `X-User-Hint`)
- `docs/monitoring/logrotate.conf`
- **Chaos-testing** — 7 tester verifiserer breaker-recovery
- `.github/workflows/backup-restore.yml` ukentlig restore-test
- `RUNBOOK.md §11 Alert runbooks` (8 subkapitler, ~300 linjer)
- **ISO-effekt:** Reliability +0.2, Sikkerhet +0.1

### Uke 7 — Portabilitet (Docker + cross-platform)
- `Dockerfile` multi-stage (bookworm-slim builder + distroless runtime)
- `docker-compose.yml` med app + caddy + memory limits
- `.github/workflows/docker.yml` multiarch GHCR (amd64 + arm64)
- **CI OS-matriks** Ubuntu + macOS + Windows
- `.gitattributes` tvinger LF line-endings
- `package.json` engines + os + cpu
- `install.sh --docker` nye args
- `DEPLOY.md §14` Docker-guide (140+ linjer)
- **Cross-platform matriks fanget 3 bugs** som ikke synes på Linux
- **ISO-effekt:** Portability +1.0

### Uke 8 — Type-sikkerhet + refactor-gate
- `tsconfig.json` opt-in modell (`checkJs: false` default)
- `types/openapi.d.ts` 1177 linjer auto-generert
- `// @ts-check` + JSDoc på 10 stabile filer
- `npm run typecheck` CI-gate (Ubuntu Node 20)
- `docs/TYPE_COVERAGE.md` full strategi
- **TS-5 refactor-proof-test** beviser at gaten fanger reelle feil
- **ISO-effekt:** Vedlikeholdbarhet +0.2

### Uke 9 — Safety + allergi-garantier
- `server/services/allergy-filter.service.js` 330 linjer
- `ALLERGY_TRIGGERS` tabell med ~80 triggere for 12 kategorier
- Automatisk annotering på alle recipe-endepunkter
- `POST /api/profile/check-recipe` eksplisitt sjekk-endepunkt
- Rødt `safety-warning`-kort i meal-view
- `showConfirm`-dialog ved recipe-import med allergi-treff
- `docs/RISK_REGISTER.md` FMEA-light med 12 risks
- `docs/SAFETY_CASE.md` formell safety-erklæring
- **180 nye tester** (25 unit + 148 regresjon + 7 API/integration)
- **ISO-effekt:** Safety +1.0

---

## Cross-platform matriksen — tre bugs fanget

Uke 7 PORT-4 introduserte CI-matriks på 3 OS + 2 Node-versjoner. Denne
investeringen betalte seg umiddelbart ved å fange tre reelle
portability-bugs som ikke synes på Linux:

1. **CRLF line-endings på Windows** (uke 7)
   - 81 filer feilet Prettier-check
   - Fix: `.gitattributes` + pre-checkout git-config

2. **PowerShell glob-expansion** (uke 7)
   - `npm test` feilet med "Could not find 'tests/*.test.js'"
   - Fix: `scripts/run-tests.js` ren-Node wrapper

3. **peer-dep konflikt med legacy-peer-deps** (uke 8)
   - `typescript@6` lokalt vs `openapi-typescript@7` som krevde `^5.x`
   - `npm ci` i CI feiler strengt mens lokal `npm install --legacy-peer-deps`
     maskerte problemet
   - Fix: Downgrade `typescript@^5.9.3`

Alle tre bugs er **bekreftet rettet** gjennom grønne CI-runs på alle 3
plattformer etter follow-up-commits.

---

## CI-pipeline final state

### 5 workflows

1. **CI** — `.github/workflows/ci.yml`
   - Test matriks: ubuntu/20, ubuntu/22, macos/20, windows/20
   - Coverage gate
   - Security audit (npm audit + OSV-Scanner)
   - SBOM generation (CycloneDX)
   - Typecheck (tsc --noEmit) — Linux Node 20
   - **Trigger:** push til main, PR

2. **Docker** — `.github/workflows/docker.yml`
   - Multiarch build (linux/amd64 + linux/arm64)
   - Publiser til `ghcr.io/christerfrestad/familyassistant`
   - BuildKit provenance + SBOM
   - **Trigger:** push til main, tag v*

3. **Performance** — `.github/workflows/performance.yml`
   - Nightly 02:30 UTC
   - Load-baseline + regression check (50% buffer)
   - **Trigger:** nightly, workflow_dispatch, PR

4. **Backup Restore Test** — `.github/workflows/backup-restore.yml`
   - Weekly mandag 03:15 UTC
   - Seed + backupNow + restore + verify canary
   - **Trigger:** weekly, PR

5. **Release** — `.github/workflows/release.yml`
   - SLSA Level 3 keyless provenance
   - GitHub Release med tarball + SBOM + SHA256SUMS
   - **Trigger:** tag v*

---

## Gjenstående tekniske gjeld

Selv med alle ISO-karakteristikker over 8.0 er det områder som kan
forbedres i v1.4+:

1. **Type-coverage 10 filer → 30+** — opt-inn flere service-filer når de
   likevel endres. Mål: 80% av public exports har jsdoc-typer.

2. **ESLint warnings → 0** — 67 warnings i dagens baseline (primært
   ubrukte `err`-variabler i catch-blocks). Ikke-blokkerende, men bør
   ryddes.

3. ~~**`@eslint/js v10`** — utsatt fra uke 1 fordi den introduserer to
   nye error-regler som krever ~5-6 kode-fixes.~~
   **Løst 2026-04-16** (branch `claude/next-natural-step-KrjXT`):
   oppgradert til `@eslint/js@^10.0.1`. De to nye `recommended`-reglene
   viste seg å være `no-useless-assignment` (4 treff) og
   `preserve-caught-error` (4 treff) — 8 totalt, fikset uten
   `eslint-disable`.

4. **Regenerere `perf-baseline.json` på ubuntu-runner** for å fjerne
   50%-bufferen og strammere gate.

5. **Ekstern penetrasjonstest** — dagens safety-case er skrevet internt,
   ikke revidert av tredjepart.

6. **Real brukertest** med familie over 30 dager for å bekrefte
   Usability-scoren empirisk.

---

## Statistikk på arbeidsmengden

- **13 commits** over 9 uker + follow-ups
- **~12 000 LOC nye** (kode + tester + docs)
- **+324 tester** (79% økning)
- **5 workflows** (fra 0)
- **7 nye docs** (`CI.md`, `DB_INDEXES.md`, `TYPE_COVERAGE.md`,
  `BRUKERGUIDE.md`, `RISK_REGISTER.md`, `SAFETY_CASE.md`, `RELEASE_V1_3_0.md`)
- **8 Dependabot-PRs merget** (inkl. major-bumps zod 4, pino 10, eslint 10)
- **1 planlagt utsettelse** (`@eslint/js` v10)
