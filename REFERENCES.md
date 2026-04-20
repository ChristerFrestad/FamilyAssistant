# REFERENCES.md – Bakgrunn, konvensjoner, godkjente verktøy

> Stabil informasjon. Oppdateres sjelden. Claude leser denne ved behov,
> ikke nødvendigvis ved hver oppgave.

---

## STACK (sannheten er i `package.json`)

### Runtime
- Node.js ≥20 <23
- npm ≥10

### Runtime-dependencies
- `better-sqlite3` – primær database-driver
- `pino` – logging
- `zod` – validering

### Optional
- `sql.js` – fallback når better-sqlite3 ikke kan kompileres
- `@sentry/node` – observability (Railway-modus, frosset)

### Frontend
- Plain HTML/CSS/JS
- Service Worker (`public/sw.js`)
- Ingen build-step. Ingen React, Vue, Tailwind, shadcn.

### Testing
- `node:test` (native)
- `node:assert/strict`
- Ingen Jest, Mocha, Vitest, eller andre test-rammeverk

### Dev-tooling
- ESLint 10 med flat config (`eslint.config.mjs`)
- Prettier 3 (`.prettierrc.json`)
- TypeScript 5 for typecheck via JSDoc (`tsconfig.json`)
- openapi-typescript – genererer `types/openapi.d.ts`
- @cyclonedx/cyclonedx-npm – SBOM
- husky + lint-staged – pre-commit hooks

**Nye avhengigheter krever STOPP og godkjenning.**

---

## MAPPESTRUKTUR

### `server/`

Toppnivå-filer (infrastruktur):

- `index.js` – oppstartssekvens
- `config.js` – env-validering, hard-fail ved ugyldig prod-config
- `db.js` – better-sqlite3 + sql.js-fallback
- `db-sqljs-adapter.js` – adapter for sql.js
- `routes.js` – alle HTTP-routes
- `repositories.js` – data-access layer (`repos.<entity>.<op>()`)
- `schemas.js` – Zod-schemas for validering
- `logger.js` – pino med redact-paths
- `llm.js` – LLM-abstraksjon (Ollama, llama.cpp, Anthropic, OpenAI, xAI)
- `stt.js` – speech-to-text (whisper.cpp)
- `backup.js` – SQLite online backup
- `cron.js` – schedulerte jobber
- `alerting.js` – webhook-alerting
- `seed.js` – initial data
- `sd-notify.js` – systemd integration
- `state-snapshot.js`

Undermapper:

- `server/services/` – forretningslogikk, `<name>.service.js`-mønster
- `server/http/` – HTTP-infrastruktur (router, middleware, errors,
  validate, metrics, cache, security, bootstrap)
- `server/auth/` – multi-tenant auth (**FROSSET**, se CLAUDE.md DEL 6)
- `server/migrations/` – SQL-migrasjoner, nummerert
- `server/observability/` – Sentry-integrasjon
- `server/llm/` – LLM-backend-adaptere
- `server/data/` – statiske seed-data
- `server/repositories/` – utvidelser av hoved-repositories.js

### `public/`

Frontend-assets. Plain HTML/CSS/JS uten build-step.

### `docs/`

- `DB_INDEXES.md` – EXPLAIN QUERY PLAN-audit
- `TYPE_COVERAGE.md` – JSDoc + @ts-check-strategi
- `RISK_REGISTER.md` – FMEA-light (R1-R12)
- `SAFETY_CASE.md` – safety-erklæring
- `DOMAIN_MODEL.md` – **NYTT, vedlikeholdes av Claude** – entiteter,
  forretningsregler, edge-cases på tvers
- `analyses/YYYY-MM-DD-<slug>.md` – **NYTT** – ANALYSE-dokumenter
  per oppgave
- `monitoring/` – Grafana-dashboard, alert-rules, logrotate

### `tests/`

Konvensjoner (matcher nærmeste eksisterende):

- `<feature>.test.js` – domene-tester
- `fase-f<N>-<navn>.test.js` – historiske fase-tester (ikke bruk for ny)
- `m-week<N>-<tema>.test.js` – ISO-plan uke-arbeid
- `phase<N>-<navn>.test.js` – multi-tenant/Railway-faser
- `iteration<N>.test.js` – tidlige iterasjoner (ikke bruk for ny)

Helpers: `tests/helpers.js` eksporterer `startTestServer()` og `request()`.

### Toppnivå-dokumentasjon (i rot, ikke i docs/)

- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CI.md`, `DEPLOY.md`,
  `RUNBOOK.md`, `SECURITY.md`, `BRUKERGUIDE.md`
- `CLAUDE.md`, `CONTEXT.md`, `REFERENCES.md`, `AGENT_LOG.md` – nye

---

## GODKJENTE MØNSTRE

### Ny backend-service

Opprett `server/services/<name>.service.js`. Eksporter rene funksjoner
eller en factory. Ikke aksess DB direkte – gå via `repos`.

Se `server/services/pantry-coverage.service.js` som referanse-mønster.

### Nytt endepunkt

1. Zod-schema i `server/schemas.js` eller lokal
2. Route-handler i `server/routes.js` – bruker `validate` middleware
3. Service-kall – ingen SQL i handler
4. Hvis destruktiv: wrap i `withAudit()` (SBOM-6)
5. Dokumenter i `openapi.yaml`
6. Integrasjonstest

### Ny database-migrasjon

1. Opprett `server/migrations/<NNN>_<navn>.sql` (neste nummer)
2. Må være reversibel hvis mulig
3. Aldri slett kolonner uten to-fase deprecation
4. Test: legg til sjekk i `tests/` som verifiserer migrasjon kjører
5. **STOPP før merge** – skjema-endringer krever eksplisitt godkjenning

### Ny forretningsregel

1. Dokumenter i `docs/DOMAIN_MODEL.md` med neste BR-nummer
2. Referer BR-nummer i kommentarer i service-koden
3. Referer BR-nummer i tester

### JSDoc + @ts-check

Følg `docs/TYPE_COVERAGE.md`. Nye stabile service-filer bør opt-inne
med `// @ts-check` i topp og JSDoc på public exports.

---

## FORBUDTE MØNSTRE

- `any` i TypeScript / JSDoc
- `@ts-ignore` uten forklarende kommentar
- Direkte SQL i route-handlers
- Direkte `fetch` i frontend uten error-håndtering
- Inline styles i frontend
- `console.log` i produksjonskode (bruk `server/logger.js`)
- Native `alert()`/`confirm()`/`prompt()` i frontend (bruk `showToast`,
  `showConfirm` – se uke 4-arbeidet i CHANGELOG)
- Hex-farger i frontend (bruk CSS-variabler)
- British spelling i kode
- Emojis i kode, commits, eller PR-er
- Kommentarer som gjentar hva koden gjør
- Nye test-fil-konvensjoner (bruk eksisterende, se tests-seksjonen)
- Nye frontend-rammeverk (React/Vue/Tailwind/shadcn – ikke introduser)

---

## DATABASE-KONVENSJONER

- Tabellnavn: `snake_case`, engelsk, flertall (`shopping_lists`)
- Kolonner: `snake_case`, engelsk
- Primærnøkkel: `id`
- Tidsstempler: `created_at`, `updated_at` på alle tabeller
- Foreign keys: `<table>_id` (entall)
- Indexes dokumenteres i `docs/DB_INDEXES.md`

---

## API-KONVENSJONER

- REST
- Ressursnavn flertall: `/api/shopping-lists`
- kebab-case i URL, camelCase i JSON
- HTTP-koder brukt riktig (201, 204, 304, 404, 409, 422, 503)
- Feil: RFC 7807 Problem Details (`server/http/errors.js`)
- Headers: `X-Request-Id`, `X-Cache` (HIT/MISS), ETag hvor cachebart
- Destruktive endepunkter wrappet i `withAudit()`

---

## SIKKERHET OG PERSONVERN

- GDPR gjelder (alle brukere er i Norge/EU)
- Barnedata krever ekstra varsomhet – ikke logg, ikke lekk i feilmeldinger
- HTTPS overalt i produksjon (`HTTPS_TERMINATED=true`)
- AUTH_TOKEN minst 32 hex-tegn i produksjon
- Session-tokens: httpOnly, secure, sameSite=lax
- API-nøkler: AES-256-GCM-kryptert (ref `server/auth/crypto.js` –
  frosset kode men mønsteret er etablert)
- Logging: redact-paths i `server/logger.js` dekker alle sensitive felter
- Ingen tredjepartsanalyse uten godkjenning

---

## DEPLOYMENT (nåværende: Portainer)

- Portainer pull `ghcr.io/christerfrestad/familyassistant:main` automatisk
- Multi-arch image (amd64 + arm64)
- Distroless base (UID 65532)
- `bootstrap.json` persistert i `/app/data/`
- Auto-migrasjon ved oppstart
- Setup-wizard på `/setup.html` ved første boot
- Backup via `server/backup.js` (SQLite online)
- Dokumentert i `DEPLOY.md §14` og `§16`

**Railway-deploy (`DEPLOY.md §15`) er frosset – se CLAUDE.md DEL 6.**

---

## EKSTERN INTEGRASJON

### LLM-backends (per-familie-konfigurert, men i Portainer-modus felles)
- Ollama (default, local)
- llama.cpp (local, raskere)
- Anthropic API (krever nøkkel)
- OpenAI API (krever nøkkel)
- xAI API (krever nøkkel)

### Andre
- Kassal.app – produktkatalog for receipt OCR
- whisper.cpp – STT (local)

Alle eksterne kall beskyttet av `server/services/circuit-breaker.js`.

---

## NYTTIGE LENKER

- Repo: https://github.com/ChristerFrestad/FamilyAssistant
- Container registry: https://ghcr.io/christerfrestad/familyassistant
- CI: https://github.com/ChristerFrestad/FamilyAssistant/actions
- Issues: https://github.com/ChristerFrestad/FamilyAssistant/issues

---

## FAMILIE- OG BRUKERKONTEKST

- Christer Frestad – eier, produkteier, utvikler-proxy
- Martine Frestad – medeier domene, bruker
- Barn – brukere (barnedata = ekstra varsom)
- Andre familier via HAOS – kjører egen Portainer-instans av samme image
- Domene: `frestad.com` (ikke aktivt for app-deploy nå)
- Internett-deploy: utsatt, krever separat prosjekt når klar

---

## TING CLAUDE IKKE SKAL GJØRE

- Ikke legg til "AI-powered"-branding i UI uten eksplisitt bestilling
- Ikke foreslå eller aktivere betalte tjenester uten STOPP
- Ikke legg inn analytics, sporing, eller tredjepartsskript
- Ikke refaktorer kode som ikke er del av gjeldende oppgave
- Ikke oppgrader avhengigheter i feature-PR – egen `deps/`-PR
- Ikke endre i `server/auth/` uten godkjenning (frosset, se CLAUDE.md DEL 6)
- Ikke bruk emojis i kode eller commits
- Ikke skriv kommentarer som smisker med koden eller med Christer
- Ikke introduser nye test-fil-konvensjoner
- Ikke introduser nye frontend-rammeverk
- Ikke slett tester for å få grønt CI
- Ikke force-push