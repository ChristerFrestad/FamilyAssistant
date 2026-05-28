## Sammendrag

Sprint 2.5 — kort arkitektur-fase mellom Fase 1d (App-shell) og Prompt 5 (Auth-flyt). Etablerer white-label-pattern slik at andre forks/deploys kan brand'e appen via to ENV-vars uten å røre kode. Default app-navn flytter fra "Familieassistenten" til **"FamilyAssistant"** (engelsk på begge språk — produktnavn er identitet, ikke beskrivelse).

## Hvorfor

FamilyAssistant er open-source. Forks som Christer's pilot på `familyassistant.com` skal kunne bytte ut produktnavnet i hver bruker-vendt streng (header, login-skjerm, magic-link-e-post, page-title) uten å vedlikeholde en patch-fork. Mønsteret må også sikre at framtidige feature-tekster bruker samme white-label-vei fra første commit.

## Hva — to ENV-vars

| Variabel | Lag | Når leses | Default |
|----------|-----|-----------|---------|
| `VITE_APP_NAME` | Frontend (Vite build-time) | `client/src/app/i18n/config.ts` etter `i18n.init()` | (uses i18n default) |
| `APP_NAME` | Backend (Node runtime) | `server/config.js` ved oppstart, Zod-validert | `"FamilyAssistant"` |

Begge skal settes til samme verdi i en deploy. Frontend leser sin egen via `import.meta.env`, backend leser sin egen via `process.env`.

## Hvor

### Frontend i18n

- **`client/src/app/i18n/locales/{no,en}/common.json`**: ny `appName: "FamilyAssistant"`-key. `appShell.logoLabel` bruker `{{appName}} — til startsiden`/`{{appName}} — back to home`.
- **`client/src/app/i18n/config.ts`**: 
  - `interpolation.defaultVariables.appName` getter som leser fra resource-store via `getResource()` (NOT via `t()` — det ville rekursere via interpolation-pipelinen).
  - `applyAppNameOverride()` etter `i18n.init()` — kaller `addResource(...)` på begge språk hvis `VITE_APP_NAME` er satt og non-empty.
- **`client/src/vite-env.d.ts`** (ny): typer `VITE_APP_NAME?: string` på `ImportMetaEnv`.

### Frontend komponenter

- **`AppShell.tsx`** brand-link: `{t('appName')}`
- **`Login.tsx`** heading: `{t('common:appName')}`
- **Dev preview** (`PreviewPage.tsx`, `Typography.tsx`): hardkodet "FamilyAssistant" (dev-only, ikke white-labelable)
- **`client/index.html` + `client/dev.html`**: hardkodet "FamilyAssistant" i title/meta (HTML-title-interpolering krever separat build-time-wiring; deferred — ikke blokkerende, kan stryke senere hvis ønsket)

### Backend

- **`server/config.js`**: ny `APP_NAME: z.string().default('FamilyAssistant')` i `envSchema`.
- **`server/services/email.service.js`**: `sendMagicLinkEmail` interpolerer `config.APP_NAME` i subject + text-body + html-body. HTML-body bruker `escapeHtml(appName)` som defense-in-depth mot XSS hvis en operatør setter `APP_NAME='<script>'`.

### Konfig + docs

- **`.env.example`**: ny "White-label (valgfritt)"-seksjon med begge variabler + Husby-eksempel. Også `ALLOWED_ORIGINS`-eksempel oppdatert fra `familieassistenten.local` til `familyassistant.local`.
- **`.env.local`** (gitignored, ikke i PR): Christer's instans-config:
  ```
  VITE_APP_NAME=Husby
  APP_NAME=Husby
  ```
- **`CLAUDE.md` DEL 7.12** (ny): full white-label-policy med scope-tabell.
- **`README.md`**: ny "Branding (white-label)"-seksjon med peker til CLAUDE.md.

## Tester

| Fil | Tester | Tema |
|-----|-------:|------|
| `client/src/app/i18n/app-name.test.ts` | **7** | Default i NO + EN + logoLabel-interpolering, override via `addResource` på begge språk + parity |
| `tests/email-service-app-name.test.js` | **3** | Default subject "Logg inn på FamilyAssistant", override "Logg inn på Husby", HTML-escape som defense-in-depth |
| `AppShell.test.tsx`, `screens.test.tsx` | (oppdatert) | Resolved appName "FamilyAssistant" i test-env |

**Sum:** +10 nye tester. Klient: 250 → **257**. Server: 1306 → **1309**.

## Hvordan teste

**Lokalt uten override (default brand):**
```bash
npm run dev:client
# Naviger til /v2/dashboard — header skal vise "FamilyAssistant"
# Bytt språk via LanguageSwitcher — fortsatt "FamilyAssistant"
```

**Lokalt med override (.env.local satt):**
```bash
# .env.local inneholder VITE_APP_NAME=Husby
npm run dev:client
# Header skal vise "Husby"
# Bytt språk — fortsatt "Husby"
```

**Backend e-post-test:**
```bash
APP_NAME=Husby npm test -- email-service-app-name
# Verifiserer at sendMagicLinkEmail bruker overstyrt APP_NAME
```

## Lokal CI

- [x] `npm run lint` — clean
- [x] `npm run typecheck` — clean
- [x] `npm run typecheck:client` — clean (etter `vite-env.d.ts` for `import.meta.env`-typer)
- [x] `npm run test` (server) — **1309/1311** (1306 før + 3 nye)
- [x] `npm run test:client` — **257/257** (250 før + 7 nye)
- [x] `npm run audit:prod` — 0 vulnerabilities
- [x] `npm run build:client` — clean (253.28 kB JS / 81.67 kB gzipped, +0.22 kB)

## Christer's instans-config (oppsummert)

```bash
# .env.local (gitignored)
VITE_APP_NAME=Husby
APP_NAME=Husby
```

Begge SKAL være identiske. Frontend og backend leser hver sin variabel — divergens vil føre til at e-post sier én ting og web-grensesnittet noe annet.

## Ute av scope (eksplisitt deferred)

- Legacy `public/*.html` (login.html, setup.html, terms.html, etc.) — frosset per `CLAUDE.md` DEL 6, blir erstattet av v2 før pilot.
- `public/manifest.json` — legacy PWA manifest, samme.
- `design/2026-04-redesign/source/*.html` — ferdig-eksporterte mockups, immutable.
- HTML title-interpolering — `client/index.html` har hardkodet "FamilyAssistant" i tittelen. Kan flyttes til Vite-build-time-substitusjon hvis Christer ønsker forks å brand'e også HTML-tittelen, men det krever ny `index.html`-template-mekanisme. Lite verdi i pilot-fasen.
- Backend pino-logger og console-meldinger — operatør-vendt engelsk, ikke bruker-vendt.

## Etter merge

Klar for **Prompt 5 (Fase 1e — Auth-flyt)**. AuthGuard og useAuth har final shape allerede; Prompt 5 bytter useAuth's body fra mock til reell `/api/auth/*`-flyt + bygger Login-skjermen, og det vil gjøre det med `t('common:appName')` allerede etablert som mønster for brand-referanser.
