# Changelog

Alle endringer i dette prosjektet dokumenteres her.
Formatet følger [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
og versjonering følger [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v1.2.0 (produksjons-hardening)

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
