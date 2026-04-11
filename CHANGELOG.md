# Changelog

Alle endringer i dette prosjektet dokumenteres her.
Formatet følger [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
og versjonering følger [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v1.3.0 (ISO/IEC 25010 forbedringsplan)

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
