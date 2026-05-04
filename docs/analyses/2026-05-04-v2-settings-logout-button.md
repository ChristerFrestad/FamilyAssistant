# ANALYSE: Logout button in v2 Settings

**Dato:** 2026-05-04
**Branch:** `feat/v2-settings-logout-button`
**Type:** Feature (frontend; backend-endpoint finnes allerede)
**Authoritative reference:** `docs/analyses/2026-05-03-pre-pilot-comprehensive-audit.md` § Top-10 H1 / Område 1

## Reisen

Pilot-bruker (Christer eller annen) har logget inn via magic-link og bruker appen over flere dager. Brukeren vil låse appen før hun gir telefonen til familien, eller logge inn med en annen email.

1. Bruker åpner Settings-skjermen via app-shell-navigasjon.
1.1. Settings rendrer eksisterende seksjoner: System, Familie, Bruker, Konto.
1.2. Brukeren scroller til bunns og finner ny seksjon "Sesjon" / "Session".
2. Sesjon-seksjonen viser én rad: "Logg ut" med Sign-out-ikon og knapp.
2.1. Knappen er alltid aktiv (ingen disabled-state — pilot-bruker er alltid pålogget når Settings vises).
3. Bruker trykker "Logg ut".
3.1. Bekreftelses-dialog vises (window.confirm for pilot-scope, samme pattern som DeleteAccountButton).
3.1.1. Dialogtekst: "Vil du logge ut?" / "Log out?"
3.1.2. Bruker velger Avbryt → ingen endring, dialog lukkes.
3.1.3. Bruker velger Bekreft → flyt fortsetter.
4. Frontend kaller `useAuthContext().logout()` (eksisterende hook).
4.1. AuthContext kaller `apiLogout()` mot `POST /api/auth/logout`.
4.2. Backend invaliderer session-cookien, sletter session-row.
4.3. AuthContext setter `user = null`.
5. App.tsx oppdager `isAuthenticated=false` og redirecter til `/v2/login` automatisk.
6. Bruker ser magic-link-input og kan logge inn på nytt (eller låse telefonen).

## Domenemodell-påvirkning

Ingen domeneendring — logout er allerede en domene-handling. Backend-endpointet eksisterer (`server/auth/routes.js`).

Berørte filer:
- `client/src/app/components/settings/LogoutButton.tsx` — ny komponent (mønster: DeleteAccountButton)
- `client/src/app/components/settings/LogoutButton.test.tsx` — ny test
- `client/src/app/screens/Settings.tsx` — ny seksjon "Sesjon"
- `client/src/app/screens/Settings.test.tsx` — utvide eksisterende test
- `client/src/app/i18n/locales/no/settings.json` — nye keys under `session.*`
- `client/src/app/i18n/locales/en/settings.json` — samme keys, engelsk
- `docs/analyses/2026-05-04-v2-settings-logout-button.md` — denne analysen

## Edge-cases

1. **Brukeren har allerede mistet sin session-cookie (utløpt eller fjernet).** AuthContext.logout fanger 401 og clearer local state likevel. Brukeren blir redirectet til /v2/login uansett.
2. **Backend feiler (5xx).** AuthContext re-throws non-401-feil etter local clear. Bruker ser tom Settings-skjerm før App.tsx redirecter til /v2/login. Kan oppfattes som "logout fungerte" fra brukerens perspektiv. Akseptabelt for pilot-scope; toast for serverfeil er en post-pilot polish.
3. **Bruker scroll-jakter på logout uten å åpne menyen.** Logout-rad er nederst i Settings — krever scroll. Pilot-feedback vil avgjøre om den skal flyttes eller dupliseres i app-shell-meny.
4. **Bruker trykker Logout mens en annen request er i flight (race condition).** `busy`-state hindrer dobbel-trykk. AuthContext håndterer ene logout selv om noe annet er pending.
5. **Bruker bekrefter logout men er offline.** Backend-call feiler. Local state cleares uansett (samme grunn som case 1). Bruker logges effektivt ut lokalt; backend-session lever til den utløper.
6. **Bruker er på en delt PC.** Logout sletter cookien — neste bruker får magic-link-input. Riktig pilot-oppførsel.
7. **Bruker har skrudd av JS.** Settings-skjermen rendrer ikke i det hele tatt (React-app krever JS). Pilot-scope: ingen no-JS-fallback.
8. **i18n-key mangler** (engelsk eller norsk). bundle-parity-testen i `client/src/app/i18n/bundles.test.ts` fanger dette ved CI.

## Konsekvenser på tvers

- **Frontend:** Ny komponent + ny seksjon i Settings.
- **Backend:** Ingen endring. `POST /api/auth/logout` brukes som er.
- **API-endepunkter:** Ingen ny endpoint.
- **Migrations:** Ingen.
- **Tester:** Ny test for LogoutButton, utvidet test for Settings.
- **DOMAIN_MODEL.md:** Ingen oppdatering. Logout er ikke et nytt domeneobjekt.
- **OpenAPI:** Allerede dokumentert.
- **CHANGELOG.md:** Entry under "Added — Settings".

## Beslutninger

### BESLUTNING 1: Plassering av logout

**ANBEFALING:** Ny seksjon "Sesjon" / "Session" nederst i Settings, etter "Konto"-seksjonen.

**HVORFOR:** 
- Christers task spesifiserer "Naturlig plassering nederst i Settings".
- Logout er en aktiv handling (ikke en innstilling som lagres) og fortjener egen seksjon, ikke en row inne i en eksisterende seksjon.
- Plassering nederst etter "Slett konto" reflekterer destruktivitets-rangering (logout < slett konto).

**ALTERNATIVER:**
- A: Inni "Konto"-seksjonen som ny row. Kompakt, men blander persistente innstillinger med transient session-handling.
- B: I app-shell-headeren som icon-button. Mer synlig, men app-shell endring er utenfor pilot-scope.
- C: Modal-trigger fra brukerens avatar (Sprint 7-design). Krever avatar-UI som ikke finnes i pilot.

**KONSEKVENS HVIS ANNERLEDES:** Brukeren må lete etter logout. Pilot-bruker sa eksplisitt at logout var savnet i v2.

### BESLUTNING 2: Bekreftelses-dialog vs. direct-action

**ANBEFALING:** Bekreftelses-dialog via `window.confirm` (same pattern som DeleteAccountButton).

**HVORFOR:**
- Logout uten bekreftelse er irreversibelt fra UX-perspektiv (krever ny magic-link for å logge inn igjen).
- Pilot-brukere kan tolke logout-knappen som "lukk session"-betydning og trykke ved et uhell.
- `window.confirm` matcher eksisterende Settings-pattern. Bespoke modal er Sprint 7-polish.

**ALTERNATIVER:**
- A: Direct-action uten bekreftelse. Enkelere kode, men risikerer utilsiktet logout.
- B: Bespoke modal med retro-knapp ("Avbryt") og primary-knapp ("Logg ut"). Bedre UX, men polish utenfor pilot-scope.

**KONSEKVENS HVIS ANNERLEDES:** Hvis A, brukerne logges ut ved et uhell. Hvis B, vi bygger en modal som blir kastet eller redesignet i Sprint 7.

### BESLUTNING 3: i18n-namespace

**ANBEFALING:** Legg keys i `settings:session.*` (ny seksjon) og `settings:logout.*` (handling).

**HVORFOR:**
- Eksisterende settings.json organiserer keys per seksjon (account.*, family.*, system.*).
- `session` er konseptuelt distinkt fra `account` (account-data persisterer; session er transient).
- Engelsk og norsk får samme key-struktur — bundle-parity-testen håndhever det.

**ALTERNATIVER:**
- A: Plasser under `account.logout.*`. Kompakt, men antyder feil hierarki.
- B: Standalone `auth:logout`. Logout fra Settings er auth-handling, men i Settings-kontekst hører den hjemme i settings-namespace.

**KONSEKVENS HVIS ANNERLEDES:** Ikke kritisk — alle alternativer fungerer. Anbefalt struktur er mest selvforklarende.

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile`: NEI
- `.dockerignore`: NEI
- `docker-compose.yml`: NEI
- `server/http/bootstrap.js`: NEI
- `server/config.js`: NEI
- `server/index.js`: NEI
- `server/db.js` eller `server/migrations/**`: NEI
- `install.sh`: NEI
- `bootstrap.json`: NEI
- Miljøvariabel-krav: NEI

**Konklusjon:** Ren frontend-feature. Eksisterende backend-endpoint brukes som er. Ingen Portainer-risiko.

## ISO 25010-påvirkning

- **Funksjonell egnethet:** 8.7 → 8.8 (+0.1, manglende basisfunksjon legges til)
- **Brukbarhet:** 8.5 → 8.6 (+0.1, brukeren kan nå avslutte sesjon uten å åpne dev-tools)
- **Pålitelighet:** 8.4 → 8.4 (uendret)
- **Sikkerhet:** 8.2 → 8.3 (+0.1, mulighet for å invalidere session styrker selv-betjent sikkerhet)

Andre karakteristikker: ikke berørt.

## Plan

Fire commits:

1. `feat(settings): add LogoutButton component with confirm flow`
   - LogoutButton.tsx (ny, mønster fra DeleteAccountButton)
   - LogoutButton.test.tsx (ny)
2. `feat(settings): wire LogoutButton into Settings as new Session section`
   - Settings.tsx oppdatering
   - Settings.test.tsx utvidelse
3. `i18n(settings): add session and logout keys (NO + EN)`
   - settings.json begge språk
4. `docs(analyses): add analysis for v2 settings logout button`
   - Denne analysen

Eller alle i én commit (totalt < 200 linjer diff, ingen dybde-avhengighet). Squashing til én commit på final push er OK per DEL 5.2.3.

## Kompleksitet-vurdering

Liten feature. Backend finnes, AuthContext.logout finnes, mønster fra DeleteAccountButton finnes. Hovedjobben er JSX + i18n + test. Ingen ny domene-konsept, ingen forretningsregel, ingen DB-endring.
