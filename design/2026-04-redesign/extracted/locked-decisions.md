# Låste beslutninger — Familieassistenten redesign (THE REFERENCE)

**Status:** 🔒 **ENDELIG.** Denne filen er referanse-kilden for alle
låste beslutninger i frontend-redesign-arbeidet (Fase 1 og fremover).
Endringer i denne filen krever eksplisitt Christer-godkjenning.

**Dato låst:** 2026-04-23
**Gyldig fra:** Fase 1 (uke 3)
**Neste revurdering:** post-pilot (uke 11+) med mindre kritisk blokker
oppstår

---

## 1. Teknologi-stack

| Område | Valg | Begrunnelse |
|---|---|---|
| Frontend-framework | **React 18** | Matcher mockup; stort økosystem |
| Build-tool | **Vite** | Rask HMR, enkel config |
| CSS | **Tailwind v3** | CSS-variabler som tokens; utility-first |
| Språk | **TypeScript strict** | Matcher backend `@ts-check`-stil; forebygger runtime-feil |
| Routing | **React Router** | SPA-mønster; behold ved v1.x |
| i18n-bibliotek | **Bestemmes i Fase 1c** | `react-i18next` vs `react-intl` — velges der med begrunnelse |

---

## 2. Arkitektur-mål

### 2.1 "Kjør overalt"
Én kodebase, to deploy-scenarier konfigurerbart via env:

| Scenario | Infrastruktur | Auth-providers |
|---|---|---|
| **Christers prod** | Cloudflare Tunnel + eget domene | Google OAuth + Resend magic-link |
| **Self-host** | Lokal Portainer, ingen tunnel | Magic-link via console, ingen Google |

**Mekanisme:** Frontend leser `GET /api/config/features` ved boot og
gating'er auth-knapper + feature-kort basert på hva som er aktivert.

### 2.2 Domene-fleksibilitet
- Nåværende domene er midlertidig
- Ingen hardkoding noe sted
- Backend: bruker `APP_URL`-env (allerede etablert, verifisert i
  `domain-scan-report.md`)
- Frontend: relative URLer til egen backend; les `appUrl` fra
  `/api/config/public` for kanoniske URLer (meta-tags, QR-koder, osv.)

---

## 3. Beslutninger med ID-referanser

### D1 — Design for auth + onboarding
**Valg:** Start Fase 1 (toolchain + design-system + shell) nå. Auth-
skjermer venter på at claude.ai/design-kvoten resetter. Implementasjon
av auth er egen fase etter claude.ai leverer.

### D2 — Apple CalDAV
**Valg:** Arkitektonisk forberedelse, ikke implementering. Tabellen
`calendar_integrations.provider` designes med enum som støtter flere
providers (`google`, `apple`, `caldav`, osv.). UI viser "Koble til Apple
Calendar" som disabled/"kommer senere". Faktisk CalDAV-kode skrives
ikke i v1.

### D3 — Feature-gating
**Valg:** Klient-side via `GET /api/config/features`. Ingen server-side
route-404. Enkel implementering.

### D4 — Kassal.app-integrasjon
**Valg:** Per-familie-nøkkel. Hver familie registrerer egen Kassal-nøkkel
i Settings. Link til `https://kassal.app/api` i oppsettet. Ingen global
fallback, ingen hybrid.

### D5 — Frontend-arkitektur
**Valg:** SPA med React Router. Ikke multi-page, ikke Next.js SSR.

### D6 — Build-toolchain
**Valg:** Vite + Tailwind v3 + React 18 + TypeScript (strict).
Se §1.

---

## 4. Øvrige låste valg

### 4.1 Kcal-felter
**Fjernet fra v1.** Ikke i datamodell, ikke i UI. Diabetes-støtte er
pushed til fase 2 per B7 locked-decisions (se
`docs/workflow/pending-decisions.md`).

### 4.2 Tags på oppskrifter
**Inkluderes i migrasjon 022** (`recipes.tags` som JSON array).

### 4.3 Achievements — opt-in/out
**Nivå 1:** family-toggle via `families.gamification_enabled`-kolonne
(legges i migrasjon 022 eller separat).
**Nivå 2 (per-medlem):** utsatt til senere hvis behov.

### 4.4 Kalender ↔ chore-kobling
**Utsatt til v1.1.** Notert, ikke bygget nå.

### 4.5 Tema-system
- **v1:** light + dark
- **Color-blind tema:** utsatt, MEN arkitektur må støtte flere temaer
  senere uten omskriving
- Implementering: `data-theme`-attribute + CSS custom properties +
  liste-basert themes-registry (se `design-system.md` §12)

### 4.6 i18n
- **v1:** norsk default, engelsk neste
- **RTL-støtte i layout-system** fra dag én (for arabisk senere)
- Alle UI-strenger må bruke oversettelsesnøkler, aldri hardkodet tekst

### 4.7 Navigasjon
- **Responsive:** bunnmeny mobil, sidemeny desktop
- **Samme informasjonsarkitektur** i begge layouter
- Nav-elementer defineres én gang, rendres i begge

---

## 5. Struktur-beslutninger (uavhengig av Christer-valg)

Disse er arkitektur-konsekvenser av de låste beslutningene. Ikke noe
nytt Christer må godkjenne.

### 5.1 Mappestruktur
**Å bestemme i Fase 1a:** `client/` vs `public/react/` vs `frontend/`.
Anbefalt: `client/` som topp-nivå-mappe, speilet av `server/`. Bygget
output havner i `server/static-build/` eller tilsvarende.

### 5.2 URL-bygging i frontend
- Relative paths til egen backend: `fetch('/api/...')`
- Aldri hardkodet `https://<domain>/...`
- En `client/src/lib/urls.ts` utility eksporterer `apiUrl()` og
  `absoluteUrl()` (sistnevnte leser `window.location.origin`)
- Kanoniske URLer (for OpenGraph, QR-koder, invitasjoner) leses fra
  `/api/config/public` som returnerer `{ appUrl, deploymentMode, ... }`

### 5.3 User preferences
- **Fase 1:** localStorage-only — ingen server-persistens
- **Fase 2:** migrasjon 029 + `/api/user/preferences`-endpoint +
  sync-logikk
- Se `user-preferences-fit.md` for full spesifikasjon

### 5.4 Integration-pattern
Kassal er første per-familie-integration. Datamodellen bruker generisk
`integration_configs`-tabell (migrasjon 022 eller senere separat) slik
at framtidige integrasjoner (Oda, Meny, etc.) kan legges til uten ny
tabell per integrasjon. Matcher visjonen i
`docs/vision/integration-platform-future.md`.

### 5.5 Co-existence av gammel og ny frontend
**Fase 1 leverer:** ny frontend på egen rute (f.eks. `/beta` eller
`/v2`). Gammel `public/*` fortsetter å fungere på `/` inntil redesign
er ferdig. Ingen big-bang-bytte.

**Å bestemme i Fase 1a:** eksakt rute-prefiks. Forslag: `/v2/` for å
matche pre-batch-3-versjonering. Backend serverer statiske filer fra
`server/static-build/` på denne prefiksen.

---

## 6. Ikke-låste områder (åpne for diskusjon i Fase 1)

- **Mappestruktur for frontend** (`client/` vs `frontend/` vs annen)
- **Co-existence-rute** (`/v2`, `/beta`, annet)
- **i18n-bibliotek-valg** (react-i18next vs react-intl)
- **Default startside** etter login (dashboard antatt, men kan byttes)
- **Specific Tailwind v3.x-versjon** (3.4.x antatt)
- **Node-versjon for Vite-build** (må matche eksisterende Node 20)

Disse avgjøres i Fase 1a og rapporteres til Christer før kode bygges
videre.

---

## 7. Beslutninger som er EKSPLISITT IKKE TATT

For å unngå scope-creep, dokumenterer vi hva som IKKE er besluttet:

- **Offline-first-strategi:** Eksisterende SW (`public/sw.js`) fortsetter
  å fungere for gammel frontend. Ny frontend får egen SW når trengs.
  Ikke v1-arbeid.
- **Push-varsler:** eksisterende notifications.js-logikk gjenbrukes.
  Redesign av push-flyten er ikke v1.
- **Real-time updates:** WebSocket / SSE er ikke besluttet for v1.
- **Bundle-størrelse-budsjett:** ingen hard grense satt. Vil måles i
  Fase 1a og rapporteres.
- **A11y-mål:** WCAG AA antatt som mål, men ingen eksplisitt audit-
  prosess besluttet.
- **Animasjons-preferanse:** `prefers-reduced-motion` må respekteres —
  dette er ikke-forhandlingsbar a11y, ikke en egen beslutning.

---

## 8. Referanse-lenker

- `design-system.md` — design-tokens + tema-arkitektur
- `components-inventory.md` — mockup-komponentliste
- `backend-requirements.md` — API-gap per komponent + migrasjon-liste
- `architecture-fit.md` — kjør-overalt-vurdering
- `user-preferences-fit.md` — per-user preferences-spec
- `domain-scan-report.md` — domene-hardkoding-skanning
- `docs/vision/integration-platform-future.md` — post-pilot integrasjons-visjon
- `docs/workflow/pending-decisions.md` — B7 UI-pending + diabetes-støtte
- `source/Familieassistenten.html` — kilde-mockup
- `source/chat-transcript.md` — design-iterasjons-historikk

---

**Denne filen er THE REFERENCE.** Når implementering starter og noen er
i tvil om hva som er besluttet, sjekk her først. Hvis ikke dekket her —
spør Christer, ikke gjett.
