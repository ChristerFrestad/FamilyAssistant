# Architecture-fit — "Kjør overalt"-vurdering av mockup

**Scope:** vurderer om designet fra `source/Familieassistenten.html`
støtter Christers **kjør-overalt-arkitektur** ("én Docker image, både
Christers prod + andre familiers selvhost, konfigurert via env-variabler").

**Spesifikt:**
- Auth-skjerm må vise konfigurerte providers dynamisk, ikke hardkodet.
- Feature-tilgjengelighet må gating'es på konfig (f.eks. hvis Resend
  mangler, skjul "magic-link til email").
- Fresh-install trenger første-gangs-setup-wizard.

---

## 🔒 Låste beslutninger (2026-04-23)

Christers svar på de 6 beslutningspunktene i §6:

- **D1** Design for auth+onboarding: **Start Fase 1 (toolchain + design-system + shell) nå.** Auth-skjermer venter på at claude.ai/design-kvoten resetter. Denne analysen står — implementering av auth kommer som egen fase etter claude.ai leverer.
- **D2** Apple-integrasjon: **Arkitektonisk forberedelse, ikke implementering.** `calendar_integrations.provider` designes med enum som støtter flere providers. UI viser "Koble til Apple Calendar" som **disabled/"kommer senere"**. Faktisk CalDAV-kode skrives ikke i v1.
- **D3** Feature-gating: **Klient-side via `/api/config/features`.**
- **D4** Kassal: **per-familie-nøkkel** i Settings (se `backend-requirements.md` §7 oppdatering).
- **D5** SPA med React Router.
- **D6** Vite + Tailwind v3 + React 18 + TypeScript (strict).

### Nye strategiske føringer fra samme runde

- **Arkitektur-mål "kjør overalt":** én kodebase, konfigurerbar for:
  - Christers offentlige prod: Cloudflare Tunnel + eget domene + Google OAuth + Resend magic-link
  - Self-host: lokal Portainer, magic-link via console, ingen Google, ingen Cloudflare
  - Frontend detekterer tilgjengelige providers via `/api/config/features`
- **Domene-fleksibilitet:** nåværende domene er midlertidig. Må kunne byttes uten kode-endring. Se `domain-scan-report.md` for skanning — konklusjon: `APP_URL`-mønsteret er allerede etablert i backend, frontend må bruke relative URLer + lese `appUrl` fra `/api/config/public`.
- **Tema-system:** light + dark for v1, arkitektur støtter flere temaer senere uten omskriving (se `design-system.md` §12).
- **i18n:** bygges inn fra start. Primær norsk, engelsk neste. RTL-støtte i layout-systemet fra dag én (for arabisk etc).
- **Navigasjon:** responsive. Bunnmeny mobil, sidemeny desktop. Samme informasjonsarkitektur, ulik presentasjon.

### Nye relevante beslutninger

- **Kcal fjernes fra v1** (ikke i datamodell, ikke i UI). Se `backend-requirements.md` låste-beslutninger.
- **Tags-migrasjon (022)** inkluderes. Dashboard/ukesmeny kan vise tags.
- **Achievements:** nivå 1 family-toggle via `families.gamification_enabled`-kolonne. Nivå 2 (per-medlem) senere.
- **Kalender ↔ chore-kobling** utsatt til v1.1. Notert, ikke bygget.

---

## 1. TL;DR

**Mockup-en tar IKKE høyde for kjør-overalt-arkitekturen.** Den antar en
allerede-innlogget familie på en fullt konfigurert deploy.

**Tre arkitektur-kritiske hull:**
1. **Ingen auth/login-skjerm** — designet starter på Dashboard med
   hardkodet familienavn via `TWEAK_DEFAULTS`. Ingen flyt for
   "ikke-innlogget bruker".
2. **Hardkodet Google + Apple-integrasjoner** — Settings-seksjonen
   "Tilkoblinger" viser Google + Apple uten conditional rendering.
   Selvhost-familier uten OAuth-apper vil se knapper som ikke virker.
3. **Ingen bootstrap-wizard** — fresh-install-flyten (brukeren åpner
   appen første gang på en tom instance) er ikke designet.

**Verdivurdering:** designet er **UI-systemet + visuelle skjermer for en
innlogget-opplevelse**. Resten må konstrueres fra null med samme design-
tokens. Dette er estimert 3-5 dager ekstra designer-arbeid (auth,
onboarding, provider-kort) pluss 5-10 dager implementering.

**Beslutningspunkt for Christer:** Godta at 3-5 nye design-skjermer må
lages internt (med samme stil) før redesign kan dekke kjør-overalt-
scenarier, eller be claude.ai/design om oppfølgings-runde som inkluderer
auth-flyt.

---

## 2. Hva mockup-en DEKKER godt

### Gaming-tilstand (innlogget, happy path)
- Dashboard med familienavn i hilsen — `tweaks.familyName` kan mappes
  til `family_profile.name` via backend.
- Rolle-switching i Gjøremål (Pappa/Mamma/Barn) — demonstrerer at
  designet **har tenkt på multi-user-opplevelsen** innenfor én familie.
- Permissions-UI i Member Detail (administrator-toggle) — matcher
  eksisterende `users.role` enum (owner/adult/child).

### Feature-gating delvis støttet
- `tweaks.gamification` kan slås av → Gjøremål-skjerm skjuler XP/streaks/
  leaderboard. **Dette er god praksis** og viser at designeren har tenkt
  på variantstøtte. Kan utvides til andre features.
- Settings → "Smarte forslag"-toggle kan reflektere om LLM er
  konfigurert.

---

## 3. Hva mockup-en IKKE dekker (arkitektur-hull)

### 3.1 Auth / login-skjerm — FRAVÆRENDE

**Hva designet antar:** Bruker er allerede i familie, app-shell starter
direkte på Dashboard.

**Hva kjør-overalt krever:**
- **Christers prod:** Google OAuth → `/api/auth/google/start`
- **Pilot-familier med Resend:** Magic-link via email → `/api/auth/magic-link`
- **Pilot-familier uten Resend:** Magic-link til console-logg (dev) — skjules i prod-UI
- **RPi bearer-token:** AUTH_TOKEN + curl — brukes sjelden av endbruker, admin-only
- **PILOT_BYPASS:** spesial-flagg som slipper gjennom uten auth

**Dynamisk provider-liste:** Auth-skjerm må kalle `GET /api/auth/providers` (eksisterer ikke ennå) og rendre knapper for hver aktivert provider:
```
response: {
  providers: [
    { id: "google", label: "Fortsett med Google", enabled: true, icon: "google" },
    { id: "magic-link", label: "Send magic-link til e-post", enabled: true, method: "email" },
    // eller:
    { id: "magic-link", label: "Magic-link (dev — se server-logg)", enabled: true, method: "console" }
  ]
}
```

**Design som mangler:**
- Login-kort/splash-skjerm (kan bruke aurora + glass som design-språket)
- Magic-link input + send-bekreftelse
- Google OAuth-callback landing
- Feilmeldinger for ugyldige/utløpte tokens

**Eksisterende `public/login.html`** er en primitiv skjerm som IKKE
matcher redesignet. Må lages på nytt i samme stil.

### 3.2 Onboarding / bootstrap wizard — FRAVÆRENDE

**Scenario:** Selvhost-familie installerer appen for første gang på en
RPi med tom database. Første request må:
1. Skape familie (`POST /api/onboarding/create-family`)
2. Legge til første medlem som owner
3. Sette opp `SESSION_SECRET` via bootstrap wizard v2 (migrert inn i
   batch 1 C1)

**Hva designet antar:** Familien finnes allerede, medlem-liste er
fylt ut.

**Hva mangler:**
- Wizard-skjerm 1: "Velkommen. Hva heter familien?"
- Wizard-skjerm 2: "Første medlem (deg)" — navn, rolle
- Wizard-skjerm 3: "Invitér familien" — eller hopp over
- Wizard-skjerm 4: "Sett opp kalender-kobling" — hopp over hvis Google
  ikke er konfigurert
- Bekreftelse / "Ferdig — la oss sette opp første uke"

Dette finnes delvis som `server/http/bootstrap.js`-endepunkter, men har
ingen UI i redesignet. Eksisterende `public/setup.html` må redesignes.

### 3.3 Provider-sjekk i Settings → "Tilkoblinger" — STATISK

**Mockup viser:**
```
- Google Kalender (Lise + Per · toveis synk)  [toggle ON]
- Apple Kalender (Per · toveis synk)           [toggle ON]
- Koble til ny tjeneste                         [chevron]
```

**Problem:** Begge er alltid synlige. Selvhost-familie uten OAuth-konfig
ser toggles de kan slå på, men ingenting skjer når de trykker.

**Løsning:** Settings-skjermen må kalle `GET /api/integrations/available`
som returnerer hvilke integrasjoner som er *mulige* i denne deploy:
```json
{
  "google_calendar": { "enabled": false, "reason": "GOOGLE_CLIENT_ID not set" },
  "apple_calendar": { "enabled": false, "reason": "not supported" },
  "oda_delivery": { "enabled": false, "reason": "ODA_API_KEY not set" },
  "kassal": { "enabled": true, "configured": true }
}
```

UI rendrer kun "enabled"-integrasjoner, med eventuell "ikke tilgjengelig
i denne installasjonen"-info for deaktiverte.

### 3.4 Feature-gating på klient-nivå — DELVIS STØTTET

Mockup-en har `tweaks.gamification`-toggle som skjuler gamification.
God idé men ikke generell nok:
- LLM-forslag (sparkles-kort på Dashboard) må skjules hvis LLM ikke
  konfigurert
- Stemme-input (mic-knapp) må skjules hvis Whisper/STT ikke aktivert
- Voice-wake-phrase ("Hei Fam") må skjules samme grunn
- Apple-integrasjon må skjules hvis ikke implementert (B6 besluttet
  kun Google)

**Anbefalt mønster:** `GET /api/config/features` returnerer `{llm: true,
voice: false, calendar_google: false, achievements: false, ...}`.
Klient bruker dette til `{features.llm && <AISuggestCard/>}`-rendering.

### 3.5 Hardkodet norsk + tid-format

Mockup er på norsk. For å virkelig "kjøre overalt" må:
- i18n-struktur bygges inn
- Dato/tid-format (DD.MM vs MM/DD, 24-timers vs 12-timers)
- Valuta (NOK hardkodet i mockup)

**Vurdering:** Norsk-only er akseptabel for pilot i Norge. i18n kan
være fase 2. Men UI-strings må ikke hardkodes inline — bruk
translations-filer fra dag 1.

---

## 4. Anbefalte endringer til design-sett

### 4.1 Nye design-skjermer trengs (7 skjermer å lage i samme stil)

1. **Splash / Welcome** — før auth, aurora + logo + "Start"-knapp
2. **Login — provider-valg** — dynamisk liste basert på konfig
3. **Login — magic-link input** — e-post eller dev-console-hint
4. **Login — magic-link sent confirmation** — "sjekk e-post"
5. **Bootstrap wizard step 1-3** — familie-opprettelse, medlem, invitasjoner
6. **Integration-detail (per provider)** — modal/skjerm for å koble til/fra en provider
7. **Auth-error / session-utløpt** — brukerfeedback

### 4.2 Konditional rendering-regler

Dokumentere som designregler (f.eks. i `design-system.md`):

| Komponent | Conditional |
|---|---|
| AI-forslag-kort på Dashboard | `features.llm === true` |
| Stemme-input (mic-knapp) | `features.voice === true` |
| Agenda-strip | Enten `features.calendar === true` ELLER fallback til interne events |
| Google-integrasjon-rad | `integrations.google_calendar.enabled === true` |
| Apple-integrasjon-rad | `integrations.apple_calendar.enabled === true` |
| Gamification-blokk | `settings.gamification === true` (brukervalg, ikke konfig) |
| Kassal-seksjon | `integrations.kassal.enabled === true` |

### 4.3 "Koble til ny tjeneste"-skjerm

Mockup har en "chevron-rad" for dette men ingen detaljer. Trenger:
- Liste over tilgjengelige providers
- Per provider: instruksjon + "Koble til"-knapp
- OAuth/API-key-input-skjermer per type

---

## 5. Backend-endepunkter som mangler for å støtte kjør-overalt

Nye endepunkter som kreves for å gjøre mockup-redesignet
kjør-overalt-klart:

```
GET  /api/auth/providers              → dynamisk liste
GET  /api/config/features             → { llm, voice, calendar, achievements, ... }
GET  /api/integrations/available      → { google_calendar: {enabled, reason}, ... }
POST /api/integrations/:provider/connect
DELETE /api/integrations/:provider/disconnect
POST /api/onboarding/create-family    (eksisterer ❓ må verifiseres)
GET  /api/onboarding/status           (er wizard ferdig?)
POST /api/onboarding/complete
```

---

## 6. Beslutningspunkter for Christer

### D1. Design for auth + onboarding
**A)** Be claude.ai/design om en oppfølgings-runde som dekker de 7
missing-skjermene (splash, login, wizard, integration-detail).

**B)** Lage dem selv basert på eksisterende design-tokens. Raskere å
iterere, men designer-kvalitet kan lide.

**Min anbefaling:** **A** — én oppfølgings-runde med spesifikt scope:
"Designer auth-flyt, onboarding-wizard og integration-detail-skjermer
for samme prosjekt, matching eksisterende visuelle språk. Se spesifikt
etter dynamisk provider-valg: Google OAuth + magic-link (email/console) +
PILOT_BYPASS".

### D2. Apple-integrasjon i design vs roadmap-beslutning
Issue #62 B6 avviste Apple CalDAV ("3-4 uker ekstra arbeid"). Men
designet inkluderer Apple overalt (kalender, settings, member detail).

**A)** Behold Apple i design — bygg UI som grått-ut når ikke tilgjengelig.
**B)** Fjern Apple fra design — matcher B6-beslutning.

**Min anbefaling:** **B** — redesign bort Apple-referanser for å unngå
falske løfter. Hvis Apple senere legges til, kan designet oppdateres.

### D3. Feature-gating-strategi
**A)** Klient-side gating via `/api/config/features`. Enklest.
**B)** Server-side rendering av conditional routes (routes returnerer
404 hvis ikke aktivert).

**Min anbefaling:** **A** for pilot. **B** er mer robust men krever
mer arbeid.

### D4. Kassal.app: per-familie vs global nøkkel
Se `backend-requirements.md` §7.

### D5. Multi-screen eller SPA?
Mockup er én HTML-fil som wrapper alt i én "mobil-ramme" på desktop. I
produksjon, ønsker Christer:

**A)** SPA (én side, client-side routing) — raskt, men dårligere SEO
**B)** Multi-page (hver skjerm egen HTML) — som dagens app
**C)** Next.js SSR (best practice 2026)

**Min anbefaling:** **A** (SPA med React + client routing). Matcher
mobilfokus + inline-transisjoner designet viser. Next.js er overkill
for en intern familie-app.

### D6. Build-toolchain
Nåværende app:
- Vanilla JS (ingen build), Tailwind IKKE brukt, egen CSS i `public/css/`

Mockup-bygging krever full toolchain-bytte. Forslag:
- **Vite** (build-tool, fast, minimalt oppsett)
- **React 18** (eller preact for mindre bundle)
- **Tailwind v3+** (med postcss-build)
- **TypeScript** (matcher nåværende `@ts-check`-bruk i backend)

**Stor konsekvens:** full rebuild av frontend. Backend uberørt (API-
lag stabilt). Rolling-deploy mulig — gammel og ny frontend kan sameksistere
på forskjellige ruter i en overgangsperiode.

---

## 7. Total scope-vurdering for kjør-overalt-redesign

| Del | Scope-estimat | Blokker |
|---|---|---|
| Design-supplement (7 nye skjermer) | 3-5 dager | D1-beslutning |
| Auth-flyt backend-endepunkter | 2-3 dager | — |
| Feature-gating backend | 1-2 dager | — |
| Frontend toolchain-oppsett (Vite + Tailwind + React) | 2-3 dager | D6-beslutning |
| App-shell + routing + theme | 3-5 dager | — |
| 5 skjermer (Dashboard, Meals, Shop, Chores, Calendar) | 3-4 uker | backend-requirements.md scope |
| Settings-skjerm | 3-5 dager | — |
| Onboarding-wizard | 3-5 dager | D1 |
| Auth-skjermer | 3-4 dager | D1 |
| Tester + a11y | 1-2 uker | — |

**Totalt estimat (alle features):** ~10-14 uker full-tid. **Pilot-MVP
(kalender-B6 ekskludert, achievements fase 2):** ~6-8 uker.

---

## 8. Konklusjon

**Ja, mockupen er et verdifullt utgangspunkt** — design-tokens,
visuelle mønstre og komponent-struktur er produksjons-klart å hente.

**Nei, mockupen er ikke et ferdig kjør-overalt-design** — auth,
onboarding, og provider-gating mangler og må designes/implementeres
separat.

**Anbefalt strategi:**
1. Godta design-tokens og komponentsettene som grunnlag.
2. Supplere med ~7 nye skjermer via claude.ai/design-oppfølging (D1).
3. Fjern Apple fra design-skjermer (D2) for å matche B6-beslutning.
4. Implementere i faser per `backend-requirements.md` §10.
5. B6 kalender-beslutning må avklares før fase 4.

**Kritisk:** denne analysen krever at Christer (evt. med claude.ai-
design-assistent) gjør en oppfølgings-runde for auth+onboarding før
implementering starter. Ellers får vi en halvfungerende redesign som
bare dekker innlogget-opplevelsen.
