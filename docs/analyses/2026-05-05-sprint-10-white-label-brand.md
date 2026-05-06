# ANALYSE — Sprint 10: White-label brand-system + email-redesign

**Slug:** `2026-05-05-sprint-10-white-label-brand`
**Branch:** `feat/sprint-10-white-label-brand`
**Trigger:** Pilot-bruker (kona) skal onboardes til Hverdagsplanleggeren-
instansen. White-label-mekanikken fra DEL 7.12 fungerer ikke ende-til-
ende: server-side `APP_NAME=Hverdagsplanleggeren` virker for email-
subject/body, men frontend viser "FamilyAssistant" fordi
`VITE_APP_NAME` er en build-time-variabel som ikke ble satt i
GHCR-imaget. Sprint 10 flytter brand-config til runtime via
`/api/config` slik at samme image kan serve flere brands, og legger
til et komplett brand-system (wordmark, favicon, email-redesign).

---

## 1. Reisen

### 1.A — Operatør deployer en ny brand-instans

1. Operatør setter env-vars i Portainer
   1.1. `APP_NAME=Hverdagsplanleggeren`
   1.2. `APP_NAME_PRIMARY=Hverdags`, `APP_NAME_ACCENT=planleggeren`
   1.3. `APP_FAVICON_LETTER=h`
   1.4. `APP_TAGLINE=Planlegg middag, gjøremål og familie`
   1.5. `RESEND_FROM=Hverdagsplanleggeren <noreply@hverdagsplanleggeren.com>`
2. Container starter
   2.1. Zod validerer alle env-vars; defaults reflekterer FamilyAssistant
   2.2. Cross-validation kjører: `APP_NAME_PRIMARY+APP_NAME_ACCENT` vs
        `APP_NAME` (case-insensitive, mellomrom-tolerant); første tegn
        i `APP_NAME_PRIMARY` vs `APP_FAVICON_LETTER`
   2.3. Begge mismatch logges som warnings, ikke crashes
   2.4. Pino-log: aktivt brand-config skrives ved oppstart
3. Klient laster `/v2/`
   3.1. `index.html` rendres med default favicon-link og default `<title>`
   3.2. `main.tsx` fetcher `GET /api/config` (cachet 1 t)
   3.3. `useBrandConfig()` hook lagrer config i module-scope
   3.4. `App.tsx` setter `document.title = config.appName` ved mount
   3.5. CSS-tokens (`--brand-primary`, `--brand-accent`) oppdateres
        via inline `<style>`-injeksjon
4. Bruker ser
   4.1. Browser-tab: "Hverdagsplanleggeren" (ikke "FamilyAssistant — v2")
   4.2. Favicon: bokstaven "h" på mørkegrønn med salviegrønn prikk
   4.3. AppShell-header: `<Wordmark />` rendrer "Hverdags" + "planleggeren"
        med fargedeling
   4.4. Splash/login: samme wordmark, større size
   4.5. Magic-link og invitasjons-emails: brand-fargede CTA, wordmark
        som inline-flettet HTML i header

### 1.B — Mottaker åpner email

1. Email rendres i mottakers klient
   1.1. Header: `<h1>` med fargedeling — Outlook/Gmail/iOS-mail
        rendrer alle inline `<span style="color">`-stiler korrekt
   1.2. CTA-knapp: `background: #1F3F26` (mørkegrønn), `color: #F7F3E8`
        (krem)
   1.3. Body-tekst: brand-primær for headinger, neutral grå for brødtekst
   1.4. Footer: liten muted tekst med `{{appName}} · {{tagline}}`

### 1.C — Bruker bytter brand-instans (samme image, ulike domener)

1. Domener: `hverdagsplanleggeren.com` og `familyassistant.com` peker
   til samme Docker-image men ulike Portainer-stacks med ulike env-vars
2. Hver stack starter sin egen container; brand-config kommer fra
   stackens env-vars
3. `/api/config` returnerer ulik respons per stack — klienten ser
   riktig brand basert på domenet

---

## 2. Domenemodell-påvirkning

### 2.A — Server config (utvidelse av eksisterende)

- `server/config.js` (ikke ny fil — utvider eksisterende `envSchema`):
  - `APP_NAME` finnes allerede; suppleres med `APP_NAME_PRIMARY`,
    `APP_NAME_ACCENT`, `APP_FAVICON_LETTER`, `APP_TAGLINE`,
    `APP_PRIMARY_COLOR`, `APP_ACCENT_COLOR`, `APP_DOT_COLOR`
  - Cross-validation som ren funksjon, kalt fra `loadConfig()` med
    output til pino-warning-channel

### 2.B — Branding-routes (ny fil)

- `server/http/branding.js` (CommonJS, integrerer med eksisterende
  `node:http`-router via `registerBrandingRoutes(router)`-funksjon
  fra `server/routes.js`):
  - `GET /favicon.svg` — template + substitusjon
  - `GET /logo-mark.svg` — template + substitusjon
  - `GET /api/config` — public, returnerer alle brand-felter,
    Cache-Control: public, max-age=3600
  - `GET /manifest.json` — dynamisk PWA-manifest (erstatter slettet
    statisk fil fra Sprint 8)
- PNG-derivat-ruter: **STOPP — se Beslutning B1**

### 2.C — Email-templates (refaktor)

- `server/email/templates/`:
  - `invitation-no.html` / `.txt` — oppdater farger til brand-tokens,
    wordmark-header
  - `invitation-en.html` / `.txt` — samme
  - `magic-link-no.html` / `.txt` (NY — ekstrahert fra inline i
    `email.service.js`)
  - `magic-link-en.html` / `.txt` (NY)
- `server/services/email.service.js`:
  - Utvid template-render-helper for å håndtere brand-config-felter
    som placeholders (`{{PRIMARY_COLOR}}`, `{{NAME_PRIMARY}}`,
    `{{NAME_ACCENT}}`, `{{TAGLINE}}`)
  - `sendMagicLinkEmail` skifter fra inline HTML til template-fil
  - Boot-warning hvis `RESEND_FROM` ikke inneholder `APP_NAME`

### 2.D — Frontend brand-system

- `client/public/branding/favicon.template.svg` (NY)
- `client/public/branding/logo-mark.template.svg` (NY)
- `client/src/app/components/brand/Wordmark.tsx` (NY — i app-tre,
  ikke `client/src/components/` som starter foreslår)
- `client/src/app/components/brand/Wordmark.test.tsx` (NY)
- `client/src/app/hooks/useBrandConfig.ts` (NY — første hooks/-fil)
- `client/src/app/styles/brand-tokens.ts` (NY — eller integrert i
  eksisterende `tokens.css` — se Beslutning B5)
- `client/src/main.tsx` — fetch /api/config tidlig + injiser tokens
- `client/index.html` — oppdater favicon-links + default title
- `client/src/app/i18n/config.ts` — bytt fra `VITE_APP_NAME` til
  runtime-config (drives av `useBrandConfig`)

### 2.E — Hardkodede strenger som må fjernes (fra OPPGAVE 1a)

**Brukervendt produkt-kode (MÅ erstattes med config/Wordmark):**

| Fil | Linje | Tekst | Fix |
|---|---|---|---|
| `client/index.html` | 6 | `<title>FamilyAssistant — v2</title>` | Default title settes til `{{appName}}` ved mount fra useBrandConfig |
| `client/index.html` | 7 | `<meta name="description" content="FamilyAssistant — ny frontend under bygging">` | Erstatt med `{{tagline}}` ved mount |
| `client/src/app/i18n/locales/no/common.json` | 2 | `"appName": "FamilyAssistant"` | Default beholdes; runtime-override via `addResource` fra useBrandConfig |
| `client/src/app/i18n/locales/en/common.json` | 2 | `"appName": "FamilyAssistant"` | Samme |
| `client/src/app/i18n/locales/no/settings.json` | 87 | `"version": "FamilyAssistant · v{{version}}"` | Bytt til `"version": "{{appName}} · v{{version}}"` |
| `client/src/app/i18n/locales/en/settings.json` | 87 | `"version": "FamilyAssistant · v{{version}}"` | Bytt til `"version": "{{appName}} · v{{version}}"` |
| `client/src/app/i18n/config.ts` | 128, 152 | `'FamilyAssistant'` literals | Default fallback beholdes; override-mekanisme bytter fra `VITE_APP_NAME` til `useBrandConfig` |

**Brukervendte HTML-sider (statiske):**

| Fil | Linje | Tekst | Fix |
|---|---|---|---|
| `public/privacy.html` | 6, 74 | `FamilyAssistant` i title + body | Hardkodet personvern — Sprint 7-fil. Vurdering: server-rendre via template ELLER aksepter statisk for FamilyAssistant-default. **Beslutning B7 nedenfor.** |
| `public/privacy-en.html` | 6, 75 | Samme | Samme |
| `public/terms.html` | 6, 55, 88, 95, 109 | `Familieassistenten` | Bruksvilkår — samme behandling som personvern |

**Server (operatør-vendt — ikke i scope):**

| Fil | Linje | Tekst | Action |
|---|---|---|---|
| `server/config.js` | 19 | `APP_NAME: z.string().default('FamilyAssistant')` | Default beholdes (riktig — open-source-default) |
| `server/index.js` | 78 | `logger.info('Starting FamilyAssistant...')` | Bytt til `logger.info('Starting ${config.APP_NAME}...')` |
| `server/services/recipe-url-import.service.js` | 13 | `USER_AGENT = 'FamilyAssistant/1.0...'` | Beholdes (User-Agent identifies the open-source product family, ikke deploy-instans — analog til Mozilla/5.0 ikke per-bruker) |
| `server/cron.js` | 1, `server/migrations/index.js` | Kommentarer | Beholdes (kode-kommentarer på engelsk per DEL 7.7) |

**Tester (oppdateres når vi rører de samme filene):**

| Fil | Status |
|---|---|
| `client/src/app/i18n/app-name.test.ts` | Forblir gyldig — tester DEFAULT FamilyAssistant. Legg til test for runtime-override. |
| `client/src/app/components/layout/AppShell.test.tsx` | Tester `'FamilyAssistant — til startsiden'`. Forblir gyldig (default), men endre testen til å verifisere at Wordmark integreres. |
| `client/src/app/screens/auth/auth-screens.test.tsx` | Tester `Velkommen til FamilyAssistant` og `Logg inn på FamilyAssistant`. Forblir gyldig (default). |
| `client/src/app/screens/screens.test.tsx` | Samme |
| `tests/email-service-app-name.test.js` | Forblir gyldig + utvid med wordmark-render-tester |

**Dev/preview (ikke-blocker):**

| Fil | Action |
|---|---|
| `client/src/dev/preview/PreviewPage.tsx:32` "FamilyAssistant v2 — design preview" | Beholdes (dev-only, design-tool) |
| `client/src/dev/preview/sections/Typography.tsx:42, 88` | Beholdes (dev preview) |

### 2.F — Domain model

- BR-BRAND-1: brand-config kommer kun fra env-variabler
- BR-BRAND-2: wordmark er todelt med fargedeling
- BR-BRAND-3: favicon = én bokstav i mørkegrønn container med
  salviegrønn prikk

---

## 3. Edge-cases (≥8)

1. **Cross-validation mismatch (APP_NAME ≠ PRIMARY+ACCENT):** Boot-
   warning i pino-log. Ingen crash. Operator kan bevisst velge
   ulike verdier (f.eks. `APP_NAME="Family Assistant"` med
   mellomrom).
2. **Cross-validation mismatch (APP_FAVICON_LETTER ≠ PRIMARY[0]):**
   Samme — boot-warning, ingen crash.
3. **Manglende env-vars:** Defaults gjelder → FamilyAssistant-merke.
   Egnede defaults sikrer at en frisk Docker-deploy uten
   APP_NAME-overstyring fungerer som open-source-instans.
4. **`/api/config` henting feiler i klient:** `useBrandConfig`
   returnerer `DEFAULT_CONFIG` (FamilyAssistant). Browser ser
   default-brand inntil reload + lykket fetch.
5. **Race-condition på første paint:** index.html har
   default-favicon + default-title. Hvis `useBrandConfig` ikke har
   fullført før første paint, vises FamilyAssistant kortvarig før
   Wordmark/document.title oppdateres. Akseptabel — under 100 ms i
   praksis. Mitigation: cache config i localStorage etter første
   fetch slik at SUBSEQUENT loads er instant.
6. **Cache-invalidering når env endres:** `/api/config`
   `Cache-Control: public, max-age=3600`. Når Christer endrer
   APP_NAME i Portainer og redeployer, må klienter:
   (a) hard-refreshe, eller
   (b) vente 1 time på TTL.
   Akseptabelt for white-label deploys (sjelden).
7. **Email-template render fra brand-config:** `RESEND_FROM` ikke
   matcher APP_NAME → boot-warning + email sendes likevel med
   eksisterende RESEND_FROM-verdi. Operatør må fikse selv.
8. **PNG-favicon på iOS-Safari:** SVG-favicon støttes ikke pre-2020
   iOS. Fallback PNG kreves. Se Beslutning B1.
9. **OG-image (Open Graph for delte lenker):** Krever 1200x630 PNG.
   Generering = ny avhengighet (sharp). Se Beslutning B1.
10. **Manifest.json mangler:** Slettet i Sprint 8. PWA install-prompt
    fungerer ikke uten. Sprint 10 oppretter `GET /manifest.json` som
    ny endpoint.
11. **Custom-fonts:** Brand-system bruker system-fonts av prinsipp
    (BRAND_SYSTEM.md regel 3). Inget WOFF/TTF i bundle.
12. **i18n-konflikt:** Eksisterende `{{appName}}`-interpolation i
    JSON-bundles vil få sin verdi fra runtime-config istedenfor
    `VITE_APP_NAME`. Migrasjons-vei: kall `i18n.addResource(lng,
    'common', 'appName', config.appName)` ved mount.
13. **Privacy/terms-sider hardkodet:** `public/privacy.html` viser
    "FamilyAssistant" / "Familieassistenten" for default-deploy. For
    Hverdagsplanleggeren er det misvisende. Se Beslutning B7.
14. **VITE_APP_NAME backward-compat:** Eksisterende deploys med
    `VITE_APP_NAME` satt vil fortsatt fungere som override hvis vi
    holder på det. Ny mekanisme tar prioritet.

---

## 4. Konsekvenser på tvers

- **Backend:**
  - `server/config.js` (utvidet)
  - `server/http/branding.js` (ny)
  - `server/routes.js` (kall `registerBrandingRoutes` fra `registerRoutes`)
  - `server/index.js` (boot-logging)
  - `server/services/email.service.js` (template-render-helper utvidet)
  - `server/email/templates/*.{html,txt}` (oppdaterte + 2 nye for magic-link)
  - `client/public/branding/*.template.svg` (nye)
- **Frontend:**
  - `client/index.html` (favicon-links + default title)
  - `client/src/main.tsx` (config-fetch + token-injeksjon)
  - `client/src/app/components/brand/Wordmark.tsx` (ny)
  - `client/src/app/hooks/useBrandConfig.ts` (ny)
  - `client/src/app/styles/brand-tokens.ts` (ny)
  - `client/src/app/styles/tokens.css` (utvid med brand-token-defaults)
  - `client/src/app/i18n/config.ts` (override-kilde byttes)
  - `client/src/app/i18n/locales/{no,en}/settings.json` (`{{appName}}`)
  - `client/src/app/i18n/locales/{no,en}/common.json` (default beholdes)
  - Alle steder Wordmark skal vises (header, login, splash) — finnes i
    `AppShell.tsx`, `Welcome.tsx`, `Login.tsx`
- **Tester:**
  - `tests/brand-config-validation.test.js` (ny — cross-validation)
  - `tests/branding-routes.test.js` (ny — favicon, logo-mark, config, manifest)
  - `tests/email-service-app-name.test.js` (utvid)
  - `tests/email-snapshot-hverdagsplanleggeren.test.js` (ny — snapshot)
  - `tests/email-snapshot-familyassistant.test.js` (ny — snapshot)
  - Frontend: `Wordmark.test.tsx`, `useBrandConfig.test.ts`
  - E2E: `tests/e2e-white-label-isolation.test.js` (ny)
- **OpenAPI:** `/api/config` + `/manifest.json` + `/favicon.svg` +
  `/logo-mark.svg` dokumenteres
- **DOMAIN_MODEL.md:** BR-BRAND-1/2/3
- **Docs:**
  - `docs/BRAND_SYSTEM.md` (Christer leverer)
  - `docs/operations/PORTAINER_BRANDING_SETUP.md` (ny)
  - `README.md` (kort white-label-seksjon)

---

## 5. Beslutninger (med anbefaling)

### B1 — PNG-derivater (sharp / node-canvas)

**ANBEFALING:** Hopp over PNG-generering i denne PR-en. Server kun
SVG-favicon + statisk PNG-fallback hvis nødvendig. Logg PNG-
generering som post-pilot tech-debt.

**HVORFOR:** `sharp` er en ny npm-pakke (DEL 2 STOPP-trigger 2.2 —
krever eksplisitt godkjenning). Pakken har native bindings (libvips),
kompliserer Docker-build (multi-stage, økt image-størrelse ~30 MB),
og har historisk vært en frequent breakage-kilde på Alpine Linux.
SVG-favicon støttes i alle moderne browsere. iOS-Safari pre-2020
mangler støtte men pilot-bruker (kona) har moderne enhet.

**ALTERNATIVER:**
- Inkluder sharp: full PNG-suite (favicon-32, apple-touch-icon,
  android-chrome 192/512, og-image). Konsekvens: ny dep, lengre build,
  PR vokser ~100 linjer
- Pre-generer PNG-er ved build-time (ikke runtime): krever nytt build-
  steg, men ingen runtime-dep. Konsekvens: white-label krever rebuild
  per brand → bryter Sprint 10-mål
- Bare SVG (anbefalt): én favicon-rute, ingen ny dep

**KONSEKVENS HVIS ANNERLEDES:** Hvis sharp velges, må Christer
godkjenne ny dep (stopp-trigger 2.2). PR vokser med ~100 linjer +
Docker-build-endring. Hvis pre-build-PNG velges, mister vi runtime-
white-label.

### B2 — Routes-fil (Express vs custom router)

**ANBEFALING:** Skriv om `branding.routes.ts` til CommonJS som
`server/http/branding.js`, integrert med eksisterende custom router
via `registerBrandingRoutes(router, { config })`.

**HVORFOR:** Repo bruker `node:http` med custom router (ingen Express).
Starter-filen er Express-basert og bruker ES-modules + `import.meta.dirname`.
Direkte kopi vil ikke fungere. Re-implementeringen er ~50 linjer og
matcher eksisterende konvensjoner.

**ALTERNATIVER:**
- Introdusere Express bare for branding-routes: tung deploy (Express +
  body-parser + middleware-chain), bryter eksisterende arkitektur-
  konvensjon
- Direkte kopiere starter-fil: vil ikke fungere uten Express

### B3 — Cross-validation som warnings vs errors

**ANBEFALING:** Warnings (per Christer's prompt + brand-config.schema.ts).

**HVORFOR:** Operatør kan bevisst velge avvikende verdier (f.eks.
`APP_NAME="Family Assistant"` med mellomrom; `APP_NAME_PRIMARY=Family`,
`APP_NAME_ACCENT=Assistant`). Crash på legitimate avvik er feil-
signal. Boot-warning i pino-log gir operatør synlighet uten
blokkering.

### B4 — i18n-bundle integration

**ANBEFALING:** Behold eksisterende `{{appName}}`-interpolation i
JSON-bundles, men endre kilden fra `VITE_APP_NAME` (build-time) til
`useBrandConfig().appName` (runtime). Konkret: ved app-mount, etter
config-fetch, kall `i18n.addResource('no'|'en', 'common', 'appName',
config.appName)`.

**HVORFOR:** Eksisterende `{{appName}}`-mekanisme er allerede brukt
i ~10 i18n-strenger (login, magic-link-sent, errors, etc.). Å
refaktorere alle til `useBrandConfig().appName` direkte ville være
unødvendig stort. Bytte av kilde er én linje i `i18n/config.ts`.

**ALTERNATIVER:**
- Refaktorer alle `{{appName}}`-strings til `useBrandConfig` direkte:
  store, mange filer. Konsekvens: PR vokser betydelig
- Behold `VITE_APP_NAME` som overlay over runtime-config: dobbel-
  mekanisme, forvirrende

### B5 — CSS-tokens injection-strategi

**ANBEFALING:** Default-tokens i `tokens.css` (matcher
FamilyAssistant). Runtime-override via `<style>`-injeksjon i
`main.tsx` etter config-fetch — settes på `:root` med høyere
spesifisitet. Bruk `brandTokensCss(config)` fra starter-filen.

**HVORFOR:** Default-tokens i CSS-filen sikrer at første paint har
korrekte farger for FamilyAssistant-deploy (ingen FOUC). For andre
brands får man et kort flash av default-fargene før override —
akseptabelt for sjelden deploy-forskjell.

**ALTERNATIVER:**
- Render tokens server-side i index.html via templating: krever
  ny build/serve-mekanisme, bryter Vite-SPA-konvensjon
- Bare runtime: FOUC for default-deploy også. Verre UX

### B6 — Magic-link-template ekstrahering

**ANBEFALING:** Ekstrahere magic-link HTML+TXT til
`server/email/templates/magic-link-{no,en}.{html,txt}` (4 nye filer)
slik at både magic-link OG invitation følger samme mønster.

**HVORFOR:** Konsistens. Alle email-templates bør være filer, ikke
inline HTML i service. Senere `email-template-editor` (post-pilot) vil
forvente fil-baserte templates.

**ALTERNATIVER:**
- Behold inline HTML for magic-link: blir tech-debt, magic-link og
  invitation har ulike pattern. Konsekvens: post-pilot opprydding

### B7 — Privacy/terms-sider med hardkodet brand

**ANBEFALING:** **Ikke endre i denne PR-en.** Logg som tech-debt
(post-pilot). Pilot-bruker (kona) ser disse sidene som
"FamilyAssistant"-merke selv om resten av appen er
"Hverdagsplanleggeren". Personvernerklæringen er juridisk dokument
som krever Christer's review uansett før "Hverdagsplanleggeren"-
versjon publiseres.

**HVORFOR:** Personvern + bruksvilkår er juridisk innhold. Direkte
template-substitusjon kan bryte semantikken (f.eks. "FamilyAssistant
operates as private owner..." byttes til "Hverdagsplanleggeren
operates as..." — krever juridisk re-vurdering). Pilot-scope er
intern bruk; juridisk publisering er post-pilot.

**ALTERNATIVER:**
- Server-render via template: må migrere innhold til en jinja-style
  template, krever juridisk re-godkjenning. For stort scope.
- Erstatt strings med `{{APP_NAME}}` substitusjon: minimal endring
  men juridisk innhold må fortsatt re-vurderes for fremtidig brand

**KONSEKVENS HVIS ANNERLEDES:** Hvis vi gjør det nå må Christer review
juridisk innhold før merge. Forsinker pilot.

### B8 — File-paths for starter-filer

**ANBEFALING:** Map starter-filer til repo-konvensjoner:

| Starter | Mål-plassering |
|---|---|
| `BRAND_SYSTEM.md` | `docs/BRAND_SYSTEM.md` (Christer-prompt) |
| `favicon.template.svg` | `client/public/branding/favicon.template.svg` |
| `logo-mark.template.svg` | `client/public/branding/logo-mark.template.svg` |
| `Wordmark.tsx` | `client/src/app/components/brand/Wordmark.tsx` |
| `useBrandConfig.ts` | `client/src/app/hooks/useBrandConfig.ts` |
| `branding.routes.ts` (Express) | `server/http/branding.js` (CommonJS, custom router) |
| `brand-config.schema.ts` (separat) | Inline-utvidelse av `server/config.js` `envSchema` |
| `brand-tokens.ts` | `client/src/app/styles/brand-tokens.ts` |

**HVORFOR:** `client/src/components/...` (uten `app/`) eksisterer ikke
i repo. `server/routes/`-katalogen finnes ikke; routes registreres
via `server/routes.js`. `server/config/`-katalogen finnes ikke;
config er én fil. Repo-konvensjoner vinner over starter-filenes
implisitte plassering.

### B9 — PR-størrelse: én eller to PR-er?

**ANBEFALING:** Én PR. Estimere ~700-900 linjer netto + ~400 linjer
tester. Splitting i to (config-system + email-redesign) ville skape
et rart mellomstadium hvor email-templates fortsatt har blå CTA mens
config-system er på plass.

**HVORFOR:** Brand-system og email-redesign er tett koblet —
email-templates BRUKER brand-config-feltene. Å splitte ville bety:
PR-A bare definerer config; PR-B bruker det. Mellomstadiet (etter
A merget før B) har ny config-mekanikk men gamle blå emails.
Forvirrende for review.

**ALTERNATIVER:**
- A: brand-system-config (~400 linjer) → B: email-redesign (~400)
- Konsekvens: to godkjennings-runder, lengre tid før pilot kan
  testes ende-til-ende

**KONSEKVENS HVIS ANNERLEDES:** Hvis Christer foretrekker mindre
PR-er, splitting er mulig — bare gi beskjed nå.

---

## 6. Portainer-oppstartsrisiko-sjekk

- `Dockerfile` eller `.dockerignore`: **NEI** (templates er statiske
  i `client/public/branding/`, kopieres som del av eksisterende
  client-build-stage)
- `docker-compose.yml`: **NEI**
- `server/http/bootstrap.js`: **NEI**
- `server/config.js` oppstartsvalidering: **JA** — nye env-vars med
  defaults. Defaults sikrer at eksisterende deploys ikke brytes.
  Cross-validation = warning, ikke crash.
- `server/index.js` startup-sekvens: **JA** — boot-logging av
  brand-config + cross-validation-warnings. Ren-additiv.
- `server/db.js` eller `server/migrations/**`: **NEI** (ingen DB-endring)
- `install.sh`: **NEI**
- `bootstrap.json`-lesning eller -skriving: **NEI**
- Miljøvariabel-krav for oppstart: **NEI** — alle nye env-vars har
  defaults

**Risiko:** lav. Endringene er additive med trygge defaults.
Eksisterende `:main`-image-deploy uten brand-env-vars vil fortsette
å vise FamilyAssistant.

**Verifisering:**
- `tests/brand-config-validation.test.js`: defaults gir konsistent
  FamilyAssistant-merke uten env-vars
- `tests/phase22-bootstrap.test.js` (eksisterende): bootstrap-flyt
  uberørt

---

## 7. ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Begrunnelse |
|---|---|---|---|
| Funksjonell egnethet | 8.8 | 8.9 | +0.1 — fullt brand-system, runtime-white-label |
| Brukbarhet | 8.7 | 8.8 | +0.1 — konsistent brand i UI + email + favicon |
| Vedlikeholdbarhet | 8.3 | 8.4 | +0.1 — hardkodede brand-strenger fjernet, config-drevet |
| Kompatibilitet | 8.6 | 8.7 | +0.1 — samme image kan serve flere brands |
| Portabilitet | 8.7 | 8.8 | +0.1 — white-label-deploy uten rebuild |
| Sikkerhet | 8.3 | 8.3 | uendret — `/api/config` er public men eksponerer kun ikke-sensitive brand-felter |
| Pålitelighet | 8.5 | 8.5 | uendret |
| Ytelse | 8.4 | 8.4 | uendret — config-fetch cachet 1 t |

ISO-snitt: 8.55 → 8.62. Ingen karakteristikk under 8.0.

---

## 8. Plan (commits i rekkefølge)

1. `docs(analysis): add Sprint 10 white-label brand-system analysis`
2. `docs(brand): add BRAND_SYSTEM.md from Christer's prompt`
3. `chore(branding): add favicon + logo-mark SVG templates`
4. `feat(config): extend envSchema with brand fields + cross-validation`
5. `feat(http): add /api/config + /favicon.svg + /logo-mark.svg + /manifest.json routes`
6. `feat(client): add Wordmark + useBrandConfig + brand-tokens`
7. `feat(client): integrate Wordmark into AppShell, Welcome, Login`
8. `feat(client): drive i18n appName from runtime config`
9. `refactor(email): extract magic-link template to file + extend render-helper for brand fields`
10. `feat(email): redesign invitation + magic-link templates with brand colors + wordmark header`
11. `test(brand): cross-validation, branding routes, email snapshots, e2e isolation`
12. `docs(domain): add BR-BRAND-1/2/3`
13. `docs(operations): add PORTAINER_BRANDING_SETUP.md`
14. `docs(readme): add white-label deploy section`

---

## 9. Kompleksitet-vurdering

**Estimat:** STOR oppgave på linje med Sprint 9. Christer signaliserer:
- Mange filer (~25-30 endrede/nye)
- Multi-layer (server config, server routes, frontend, email, docs)
- Cross-validation + boot-logging
- Snapshot-tester for begge brands
- E2E for white-label-isolasjon
- Ny dokumentasjon (BRAND_SYSTEM, PORTAINER_BRANDING_SETUP)

Anslått total endring: ~700-900 linjer netto + ~400 linjer tester.
Innenfor "én PR"-rammen Christer godtok i prompten, men nær grensen.

**Hvis en av disse trigger økning, splitt til to PR-er:**
- PNG-generering inkluderes (B1 → sharp): +200 linjer + Docker-endring
- Privacy/terms server-rendres (B7): +300 linjer + jur-review-pause
- Magic-link-tester ekspanderes (B6): +150 linjer

---

## 10. Avhengigheter og frys-status

- **DEL 6.1b (`server/auth/` soft-thaw):** Ingen direkte endring i
  `server/auth/family-routes.js` eller `magic-link.js` — bare i hvordan
  email.service.js render maler. Magic-link-flow uberørt.
- **DEL 14 (multi-tenant testing):** Ikke aktuelt — config er global,
  ikke per-familie. White-label betyr én brand per deploy.
- **DEL 7.7 (no tech-debt):** Ny kode følger denne. Eksisterende
  hardkodede strings adresseres som-skrives i samme commit, IKKE
  drive-by.
- **DEL 7.11 (i18n-policy):** Behold eksisterende `{{appName}}`-
  mekanikk; bytt kilde fra build-time til runtime. Ny tekst
  (PORTAINER_BRANDING_SETUP) er operatør-vendt → engelsk per DEL 7.7.
- **DEL 7.12 (white-labeling):** Sprint 10 IS hovedimplementeringen
  av denne policyen. Eksisterende DEL 7.12 oppdateres med ny
  arkitektur (runtime istedenfor build-time).

**Stopp-triggere som krever Christer's eksplisitte avgjørelse FØR
implementasjon:**
- B1 (sharp / PNG-generering) — DEL 2 STOPP-trigger 2.2 (ny npm-pakke)
- B7 (privacy/terms-handling) — juridisk innhold

**Trenger ikke stopp:**
- B2 (Express-omskrivning) — repo-konvensjon
- B3 (warnings vs errors) — Christer har eksplisitt sagt warnings
- B4 (i18n-integrasjon) — internt valg
- B5 (CSS-tokens) — internt valg
- B6 (magic-link-ekstrahering) — internt valg, refaktor
- B8 (file-paths) — internt valg
- B9 (én vs to PR-er) — Christer-input nyttig men ikke kritisk

---

## 11. Hva Christer må svare på FØR implementasjon

1. **B1 — PNG-generering:**
   (a) Hopp over (anbefalt) — bare SVG, logg PNG som post-pilot
   (b) Inkluder sharp (ny dep — DEL 2 godkjenning kreves)
   (c) Pre-build PNG (mister runtime-white-label)

2. **B7 — Privacy/terms-sider:**
   (a) Ikke rør (anbefalt) — logg som tech-debt for jur-review
   (b) Server-render (krever jur-review nå, forsinker)
   (c) Bare token-substituer (jur må fortsatt verifisere)

3. **B9 — PR-splitting:**
   (a) Én stor PR (anbefalt)
   (b) To PR-er (config-system først, email-redesign etter)

Alle andre beslutninger er klare og kan kjøres uten ytterligere
input.
