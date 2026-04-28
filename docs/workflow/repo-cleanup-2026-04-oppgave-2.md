# Repo-tilstand-revisjon — 29. april 2026

Komprehensiv kartlegging av repo-tilstand utført dagen etter Fase
1b ble merget (PR #68) og branch-cleanup i Runde A+B+C var ferdig.
Ingen mutasjoner gjort under denne revisjonen — kun data-innsamling.

---

## Oversikt

| Felt | Verdi |
|------|-------|
| Dato | 2026-04-29 |
| Branch | `main` (rent etter Runde C) |
| Commits siden Fase 1b-merge | 2 (`fe4bdeb` + `7b59967` cleanup-rapport + PR #56-pending-decisions) |
| Working tree | clean |
| Lokale branches | 1 (`main`) |
| Remote branches | 8 (main + 6 dependabot/* + HEAD-pointer) |
| Stashes | 0 |
| Åpne PR-er | 3 (alle dependabot, ingen Christer-eide) |
| Sanity-check | ✅ alle tier 1+2+3 grønn |

---

## Funn

### 🟢 PUNKT 2.1 — Foreldreløse filer

**Server (89 JS-filer):** ingen foreldreløse. Heuristisk grep for
hver fil i `server/services/` viste 0 services uten kallere.

**Client/src (63 ts/tsx-filer):**

- 16 komponenter i `client/src/app/components/` er ikke importert
  fra `App.tsx` ennå (`App.tsx` er Fase 1b.1-placeholder med
  *"Kommer snart"*). Komponentene er ikke foreldreløse — de venter
  på Fase 1c (i18n) og Fase 1d (AppShell) hvor de tas i bruk via
  reelle sider. Verifisert at tree-shake fjerner dem fra prod-
  bundle (Fase 1b sluttverifisering).
- 16 preview-filer i `client/src/dev/preview/sections/components/`
  er alle registrert i `index.tsx` og rendres på `/v2/dev.html`.

**Public legacy (v1-frontend):** 19 JS-filer + 4 CSS-filer i
`public/js/` og `public/css/` — alle aktive i v1-routing. Levere
sammen med v2 til migration er ferdig.

**Konklusjon:** ingen reelle foreldreløse filer. Estimerte
ryddings-tid: 0 timer.

---

### 🟢 PUNKT 2.2 — Gamle eksperimenter / dead code

| Sjekk | Funn |
|-------|------|
| Mapper `old`/`deprecated`/`experimental`/`tmp`/`scratch`/`_old`/`backup` | **0** |
| Filer med `.bak` / `.old` / `.copy` | **0** |
| Kommentarer `TODO: remove` / `XXX: temp` / `@deprecated` / `to be removed` | **0** |
| Services uten kallere | **0** |
| Bredere "remove this"-pattern | 1 (kommentar i test som verifiserer at welcome-tour ble fjernet til fordel for family-onboarding — aktiv regression-test, ikke dead) |

**Konklusjon:** repo er bemerkelsesverdig fri for dead code.
Estimert ryddings-tid: 0 timer.

---

### 🟡 PUNKT 2.3 — Utdaterte dokumenter

#### Status-seksjoner som er utdaterte

| Fil | Hva er utdatert | Anbefaling |
|-----|------------------|------------|
| `CONTEXT.md` AKTIV OPPGAVE | Refererer til "Undersøke tom handlekurv-bug i frontend" (PR #59) som ble lukket. Aktiv oppgave er nå Fase 1c-forberedelse. | Oppdater AKTIV OPPGAVE til "Repo-cleanup → Fase 1c (i18n)" |
| `CONTEXT.md` PÅGÅR | Lister PR #59 (lukket) og PR #61 (lukket) som åpne. | Erstatt med faktisk status: 0 Christer-eide åpne PR-er |
| `CONTEXT.md` VENTER PÅ CHRISTER | Lister "5 spørsmål i PR #59" (lukket) og "GitHub Actions billing-fiks" (løst per fungerende CI på Fase 1b-PR). | Slett begge |
| `docs/workflow/pending-decisions.md` | "Batch 2 — venter push-klarsignal" — branchen `batch-2` er slettet i Runde C; PR #65 ble merget 2026-04-22. | Marker batch-2-seksjonen som "✅ Merget i PR #65" og flytt til arkiv-seksjon |
| `docs/workflow/pending-decisions.md` | "Sist oppdatert"-datoen er 2026-04-28 men flere entries har "Status (2026-04-22)" eller eldre dato-stempel. | Konsolider status-datoer ved neste oppdatering |
| `docs/workflow/pending-decisions.md` | "Blokker frontend-bug-fix: 5 spørsmål i PR #59" — PR #59 er lukket. | Marker som ✅ løst eller fjern |
| `AGENT_LOG.md` | Append-only-logg, eldste entries fra 2026-04-20. Trenger ikke "fjerne" gamle entries, men siste oppføring bør reflektere Fase 1b + Runde C-cleanup. | Oppdater hvis CLAUDE.md DEL 8 fortsatt krever slik logging; eller marker som "frosset etter Fase 1b" hvis logg-praksisen er forlatt |

#### Andre docs

- `README.md` — engelsk, beskrives på top-nivå. Sjekket for fil-
  referanser (ingen brutte funnet).
- `CONTRIBUTING.md` — eksisterer, ikke detaljert revidert.
- `CLAUDE.md` — autoritativt arbeidsinstruks, mange seksjoner
  inkluder kalibrering for v1; fungerer som basis for v2-arbeid.
- `docs/workflow/fase-1b-summary.md` (vår egen) — fersk og korrekt.
- `docs/workflow/repo-cleanup-2026-04-runde-c.md` (vår egen) — fersk
  og korrekt.
- `docs/analyses/*` — 6 analyse-dokumenter fra 2026-04-20 og -22.
  Alle er historiske referanser; ingen krever aktiv oppdatering.
- `design/2026-04-redesign/extracted/locked-decisions.md` — bør få
  link/ref fra fremtidige hybrid-modell-bekreftelser (kalender) når
  beslutninger låses (per pending-decisions.md krysslenker).

**Estimert ryddings-tid:** 1-2 timer for å oppdatere
`CONTEXT.md` + status-seksjoner i `pending-decisions.md`.

---

### 🟡 PUNKT 2.4 — Dependencies

#### Outdated (root)

| Pakke | Nåværende | Latest | Major-hopp? |
|-------|-----------|--------|-------------|
| `@sentry/node` | 8.55.1 | 10.50.0 | 2 majors (Dependabot PR #67 åpen) |
| `@types/react` | 18.3.12 | 19.2.14 | major |
| `@types/react-dom` | 18.3.1 | 19.2.3 | major |
| `@typescript-eslint/eslint-plugin` | 8.59.0 | 8.59.1 | patch |
| `@typescript-eslint/parser` | 8.59.0 | 8.59.1 | patch |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.1 | 2 majors |
| `autoprefixer` | 10.4.20 | 10.5.0 | minor |
| `eslint` | 10.2.0 | 10.2.1 | patch |
| `prettier` | 3.8.2 | 3.8.3 | patch |
| `react` | 18.3.1 | 19.2.5 | **major** |
| `react-dom` | 18.3.1 | 19.2.5 | **major** |
| `react-router-dom` | 6.30.3 | 7.14.2 | **major** |
| `tailwindcss` | 3.4.15 | 4.2.4 | **major (architecture-change)** |
| `typescript` | 5.9.3 | 6.0.3 | **major** |
| `vite` | 6.4.2 | 8.0.10 | **2 majors** |

**Notable:**
- 7 majors tilgjengelige, hvorav **Tailwind 4** er størst impact
  (full config-system-omforming) og **React 19** krever forsiktig
  migration (concurrent features, useActionState, etc.).
- 2 åpne Dependabot-PR-er: #67 (sentry/node), #69 (dev-minor group).
- Ingen sikkerhets-kritiske oppdateringer (`npm audit --omit=dev` =
  0 vulnerabilities).

#### Ubrukte runtime-deps

**0 funnet** via grep gjennom `server/` + `tests/` + `scripts/`. Alle
runtime og dev-dependencies blir importert et eller annet sted.

#### Eksakt-versjon-konsistens

Inkonsistent — noen pakker har `^`-prefix (better-sqlite3, pino,
zod, sql.js, globals, husky, lint-staged, openapi-typescript,
pino-pretty, eslint, prettier, typescript), andre har eksakt versjon.

**Anbefaling:** Bestem enhetlig policy. Hvis "alt eksakt" foretrekkes,
fix de 11 `^`-versjonene. Tilgjengelig som en separat "chore: pin
exact versions"-PR senere.

**Estimert ryddings-tid:**
- Eksakt-versjon-fix: 30 min (rene tekst-endringer)
- Patch-oppdateringer (eslint, prettier, autoprefixer): 30 min
- Major-oppdateringer: 1-3 dager hver, særlig Tailwind 4

---

### 🟢 PUNKT 2.5 — Konfigurasjons-revisjon

| Sjekk | Resultat |
|-------|----------|
| ESLint config | 1 (`eslint.config.mjs`, flat config) — ingen duplikat |
| TypeScript config | 2 (`tsconfig.json` + `client/tsconfig.json`) — forventet |
| Prettier config | `.prettierrc.json` + `.prettierignore` — clean |
| `.env.example` | eksisterer, sjekkes manuelt ved deploy |
| GitHub workflows | 7 stk (backup-restore, ci, deploy, docker, performance, rebaseline-perf, release) |
| Hardkodede ports | `localhost:11434` (Ollama), `localhost:8080` (LLaMA.cpp), `localhost:8787` (Faster-Whisper) — alle env-overstyrbare med korrekt fallback-pattern |
| Hardkodede stier | ingen |

**Konklusjon:** ren konfigurasjon. Estimert ryddings-tid: 0 timer.

---

### 🟢 PUNKT 2.6 — TODO-kommentar-revisjon

| Lokasjon | Antall TODO/FIXME/XXX/HACK |
|----------|---------------------------:|
| `client/src/` (ts/tsx) | **0** |
| `server/` (js) | **0** |
| `tests/` (js) | **0** |
| `scripts/` (js) | **0** |
| `**/*.md` (dokumenter, ikke kode) | 17 (over 7 filer) |

**Bemerkelsesverdig** — koden er **fri for TODO-markører**. De
17 forekomstene i `.md`-filer er dokumenterte fremtidsplaner
(`pre-deploy-cleanup-plan.md`, `batch-2-pr-description.md`, etc.),
ikke kode-TODOs. Dette er ønsket pattern.

**Estimert ryddings-tid:** 0 timer.

---

### 🔴 PUNKT 2.7 — Backend-arkitektur

#### API-endepunkter

| Felt | Verdi |
|------|-------|
| Total endepunkter | **261** |
| Route-filer | 11 (`server/routes.js` + 10 i `server/auth/` og `server/http/`) |
| Auth-middleware | `server/auth/middleware.js` (`requireAuth`, `requireAdult`-pattern) |

#### Database — KRITISK: ingen tradisjonell RLS

| Felt | Verdi |
|------|-------|
| DB-engine | **better-sqlite3** (SQLite, ikke PostgreSQL) |
| Migrations | 21 (001-020 + index.js) |
| `family_id`-mentions i migrations | 143 |
| RLS-policies | **0** — SQLite støtter ikke Row Level Security |
| Multi-tenant-isolasjon | App-lag via `getFamilyId()` + AsyncLocalStorage (131 bruks-steder over 16 repositories) |

**Hvilke tabeller har `family_id` (multi-tenant-scope):**
- `families` (root), `users`, `sessions`, `magic_link_tokens`,
  `family_invitations`, `family_profile`, `family_profile_members`,
  `family_llm_config` — alle nye-i-014/020-tabeller har det.
- 17 eksisterende tabeller fikk `family_id` lagt til via
  `ALTER TABLE` i migration 014: `audit_log`, `calendar_events`,
  `chore_schedules`, `chores`, `consumable_log`, `consumables`,
  `inventory_log`, `knowledge_base`, `llm_audit`, `meal_history`,
  `notifications`, `purchase_log`, `receipt_items`,
  `recipe_ingredients`, `recipes`, `shopping_extras`,
  `shopping_list_items`.
- Senere migrations: `chore_completions` (019), `member_diets`/
  `family_profile_members` (020), `product_shelf_observations` (017)
  — alle med `family_id`.

**Hvilke tabeller har IKKE `family_id` (delte ressurser):**
- `products`, `kassal_products`, `product_resolutions`,
  `kassal_cache` — globale produkt-katalog
- `llm_cache` — delt LLM-cache
- `recipes` — *vent, denne fikk family_id i 014*. Det betyr
  oppskrifter er per-familie (matcher Fase 1b-arkitektur for
  recipe-clone-on-edit).

**Status:** Multi-tenant-isolasjon er etablert via app-lag-mønsteret,
**ikke via DB RLS**. Dette er et arkitektonisk valg som er
**dokumentert i `pending-decisions.md`** under "Sikkerhetsarkitektur"-
entryen, og er kjent. Det er IKKE en sikkerhets-bug, men det
betyr at:
1. Hver fremtidig query MÅ gå gjennom repository-laget med
   `getFamilyId()` for at isolasjonen skal håndheves.
2. Vi mangler **negative tester** som verifiserer at familie A
   får 403/404 når de prøver å lese familie B-data — noe som
   er anbefalt eksplisitt i pending-decisions-entryen.

#### Test-coverage per modul (server)

**Total:** 83.06% lines / 73.5% branches / 80.46% functions
(`coverage-gate` baseline 80% / 68% / 72% — alle over).

**Auth-moduler (sikkerhets-kritiske):**

| Modul | Lines | Branches | Functions |
|-------|------:|---------:|----------:|
| `auth/cookies.js` | 96.88% | 81.82% | 100.00% |
| `auth/crypto.js` | 93.85% | 87.50% | 100.00% |
| `auth/family-context.js` | 82.35% | 92.31% | **60.00%** |
| `auth/family-routes.js` | 89.72% | **54.40%** | 97.50% |
| `auth/gdpr-routes.js` | 91.19% | 80.95% | 90.32% |
| **`auth/google.js`** | **🚨 32.64%** | 100.00% | **🚨 0.00%** |
| `auth/llm-routes.js` | 86.00% | 61.54% | 100.00% |
| `auth/magic-link.js` | 97.04% | 87.80% | 100.00% |
| `auth/middleware.js` | 96.91% | 91.49% | 90.91% |
| `auth/onboarding-routes.js` | 95.00% | 83.33% | 100.00% |
| `auth/sessions.js` | 100.00% | 60.00% | 100.00% |
| `http/middleware.js` | 89.81% | 76.74% | 100.00% |
| `repositories/auth.repo.js` | 96.58% | 81.08% | 91.67% |

**Andre lave coverage-områder (ikke sikkerhets-kritiske):**

| Modul | Lines | Notat |
|-------|------:|-------|
| `routes.js` | 71.09% / 58.28% branches | Stor route-fil, error-paths udekt |
| `state-snapshot.js` | 64.95% | Backup/snapshot-modul |
| `stt.js` | **26.69%** | Speech-to-text, deaktivert i de fleste deployments |

#### Middleware-stack

- **Auth:** `auth/middleware.js` (requireAuth, requireFamily) +
  `http/middleware.js` (cookies, body parsing)
- **Validering:** Zod via `server/schemas.js` (per Fase 1a-disiplin)
- **Rate-limiting:** **IKKE IMPLEMENTERT** — flagget i pending-
  decisions sikkerhetsarkitektur som pre-pilot-arbeid
- **Logging:** Pino logger via `server/logger.js`

#### Pre-eksisterende tech debt

- 3 ESLint-warnings i `server/routes.js` (linje 562, 654, 709) —
  unused `blockedFor`-callback-arg fra B7 per-medlem-diett-arbeidet.
  Pre-existing fra før Fase 1b. Ikke blokkerende, men trygt å
  rydde med en `_blockedFor`-prefix.

---

### 🟡 PUNKT 2.8 — Norsk-tekst-omfang

#### Kategorisert inventering

| Kategori | Lokasjon | Antall | Status |
|----------|----------|-------:|--------|
| **Kommentarer** (skal til engelsk pre-deploy) | `client/src/` (ts/tsx) | 12 linjer | Lite — Fase 1b-koden er allerede engelsk |
| **Kommentarer** (skal til engelsk pre-deploy) | `server/` (js) | 351 linjer | Hovedmasse |
| **Kommentarer** (skal til engelsk pre-deploy) | `tests/` (js) | 209 linjer | Hovedmasse |
| **Total kommentarer** | | **572 linjer** | over **104 filer** |
| **Variable/funksjons-navn** | overalt | **0** | Allerede engelsk ✓ |
| **Bruker-vendt strenger** (i18n NO/EN i Fase 1c, IKKE konverter til engelsk) | client `*.preview.tsx` + tester | ~10 forekomster | Eksempler: "Mørk modus", "Familienavn", "Nøtter", "Snart utgått" — disse er bruker-vendt og skal ligge i lokaliseringssystemet, ikke konverteres |
| **Server-strenger** (logger + feilmeldinger + seed-data) | `server/` | 413 forekomster | Krever klassifisering: noen er logger (skal til engelsk), andre er seed-data (kategorier, produktnavn) som er bruker-vendt og skal ligge i i18n |

#### Estimert konverterings-tid (per kategori)

| Kategori | Anbefalt timing | Estimert tid |
|----------|------------------|-------------:|
| Kommentarer 572 linjer over 104 filer | Pre-deploy uke 10-11 | **1-2 dager** (kontekst-bevarende oversettelse, særlig server/) |
| Variable/funksjons-navn | Allerede gjort | 0 |
| Bruker-vendt tekst (i UI + seed-data) | Fase 1c (i18n m/ react-i18next) | **3-5 dager** (ekstrahere strenger, NO/EN-kataloger, hooks-integrering) |
| Logger/feilmeldinger | Pre-deploy uke 10-11 | **0.5-1 dag** (fanget i samme pass som kommentarer) |
| **Total estimert pre-deploy + Fase 1c** | | **5-8 dager** |

**Notat:** seed-data (kategorier som `Kjøtt & fisk`, produktnavn som
`Kjøttdeig`) er **bruker-vendt** og skal til i18n, ikke konverteres
til engelsk på server-siden. En produktdatabase med engelske
kategorier ville være feil i en norsk pilot.

---

## Anbefalinger

### 🔴 Må fikses før Fase 1c (kritisk)

**Ingen.** Fase 1c (i18n) kan starte med nåværende repo-tilstand.

### 🟡 Bør adresseres mellom Fase 1c og Fase 1e (auth)

1. **Test-coverage på `auth/google.js`** — 32.64% lines / 0%
   functions er for lavt for en sikkerhets-kritisk OAuth-modul.
   Skriv dedikerte tester for:
   - PKCE-pair-generering (`generatePkcePair`)
   - Authorization URL-bygging (`buildAuthorizationUrl`)
   - JWT-signature/claims-validering (`verifySignatureAndClaims`)
   - JWK→PEM-konvertering (`jwkToPem`)
   - Token-exchange-feilstier (network errors, expired tokens, bad signatures)
   
   **Estimert tid:** 2-3 dager.

2. **Negative multi-tenant-tester** — som anbefalt i pending-
   decisions sikkerhetsarkitektur-entry. Verifiser eksplisitt at:
   - Familie A med `family_id=1` får 403/404 når de prøver å
     lese family_id=2-data
   - Hver av de 261 endepunktene som tar ID-er som path-param
     verifiseres
   
   **Estimert tid:** 1 dag (eksisterende test-helpers gjør dette
   relativt rimelig).

3. **Oppdater `CONTEXT.md` + `pending-decisions.md` status-
   seksjoner** — utdaterte referanser til lukkede PR-er (#59, #61)
   og merget batch-2.
   
   **Estimert tid:** 1-2 timer.

### 🟢 Bør adresseres i pre-deploy-cleanup (uke 10-11)

1. **Engelsk-konvertering av kommentarer** (572 linjer, 104 filer).
2. **Logger/feilmeldinger til engelsk**.
3. **Eksakt-versjon-konsistens i package.json** (11 deps med `^`-
   prefix).
4. **3 ESLint-warnings i routes.js** (unused `blockedFor`-args).

### 🟢 Bør vurderes post-pilot

1. **Major dependency-oppdateringer:** Tailwind 4 (config-omforming),
   React 19, Vite 8, react-router-dom 7. Ingen blokkerende, men
   bør planlegges.
2. **Rate-limiting-implementasjon** (per pending-decisions
   sikkerhetsarkitektur).

---

## Konkret opprydnings-plan (hvis Christer vil rydde nå)

| Prioritet | Item | Tid | Risiko |
|-----------|------|----:|--------|
| 1 | Oppdater CONTEXT.md status-seksjoner | 30 min | Trivielt |
| 2 | Oppdater pending-decisions.md (markér batch-2 som merget, PR #59 som lukket) | 30 min | Trivielt |
| 3 | Fix 3 ESLint-warnings i routes.js (rename `blockedFor` → `_blockedFor`) | 15 min | Trivielt |
| 4 | Bestem eksakt-versjon-policy + fix package.json hvis "alt eksakt" foretrekkes | 30 min | Trivielt |
| 5 | Patch-oppdateringer (eslint, prettier, autoprefixer, @typescript-eslint) | 30 min | Lavt — patch-only |
| **Sub-total** | **Quick wins** | **~2 timer** | |
| 6 | Skriv tester for `auth/google.js` (PKCE, URL-bygging, JWT-validering) | 2-3 dager | Middels — krever forståelse av OAuth-flyten |
| 7 | Skriv negative multi-tenant-tester | 1 dag | Lavt-middels — eksisterende test-pattern |
| **Sub-total** | **Sikkerhetstester** | **3-4 dager** | |

**Anbefaling for prioritering:** Quick wins (1-5, ~2 timer) før Fase
1c starter. Sikkerhetstester (6-7) kan kjøres parallelt med Fase 1c
eller som dedikert "fase 1b.5"-arbeid.

---

## Klar for Fase 1c?

**JA.** Repo-tilstanden er ren nok til å starte Fase 1c (i18n) uten
forkleven. Ingen blokkerende issues, ingen aktive sårbarheter,
ingen dead code, ingen ubrukte dependencies.

De flagete bekymringene (`auth/google.js` test-coverage,
multi-tenant negative-tester) handler om sikkerhetstester som vi
bør adressere før Fase 1e (auth) lander pilot, men de hindrer ikke
Fase 1c-arbeid.

### Forslag til neste steg

1. **Quick wins (2 timer)** — oppdater status-docs + lint-fix +
   patch-oppdateringer. Lavrisiko-cleanup som baner Fase 1c-veien.
2. **Start Fase 1c (i18n)** — react-i18next, NO/EN-kataloger,
   ekstrahere bruker-vendt tekst fra preview-filer + seed-data til
   lokaliseringssystem.
3. **Parallelt eller etter Fase 1c:** sikkerhetstester for
   `auth/google.js` + negative multi-tenant-tester. Sikrer at Fase
   1e (auth) lander mot et godt fundament.

Ingen blokkere oppdaget. Repo er klar.
