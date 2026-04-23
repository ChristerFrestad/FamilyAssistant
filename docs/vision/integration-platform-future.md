# Integrasjons-plattform — fremtidsvisjon (post-pilot)

**Status:** VISJON-DOKUMENT. Ikke v1-arbeid. Ingen implementerings-aktivitet
nå. Dette er et strategisk kart for hvor produktet potensielt beveger seg
*etter* pilot-fasen (uke 11+), når reelle bruksmønstre er kjent.

**Formål:** Påse at hver integrasjon vi bygger i v1 (Kassal.app først;
Oda, Meny, etc. senere) bygges med tanke på at den kan bli del av et
større katalog-system senere. Det betyr gjenbrukbare abstraksjoner,
tydelig separasjon mellom "hva integrasjonen gjør" og "hvordan den
kobles inn", og dokumentert metadata per integrasjon.

---

## 1. Kjernevisjon

Familieassistenten starter som en norsk familie-app med en håndfull
ferdige integrasjoner (Kassal.app, senere Oda). Men datamodellen,
frontend-gating og backend-routing-laget skal fra dag én være bygget
slik at vi uten store omskrivninger kan bli:

- **En nordisk plattform:** flere land, flere språk (se i18n-strategi
  i `docs/vision/` — å opprette hvis relevant), flere matvarehandels-
  integrasjoner (ICA Sverige, Dansk Supermarked, etc.)
- **Et sentralt vedlikeholdt integrasjons-katalog:** Christer (som
  operatør) oppgraderer "offisielle" integrasjoner og disse
  automatisk distribueres til prod-brukere.
- **Selvbetjent utvidelse for self-host:** en familie som kjører app-en
  på egen Pi kan manuelt legge til integrasjoner som ikke finnes i det
  offisielle katalogen — via enten en git-klone-flyt eller et
  "Installer integrasjon"-UI.
- **Åpent community-bidrag:** på sikt tar vi imot integrasjons-bidrag
  fra andre utviklere i en kurert prosess (PR-basert, med review).

**Klar avgrensning mot v1:** ingenting av dette skal bygges nå. Men
v1-koden skal ikke lage tekniske valg som senere vil blokkere dette.
Det er hele poenget med dokumentet.

---

## 2. Bruksscenarier vi peker mot

### 2.1 "Offisielle" integrasjoner (prod, Christers deploy)

Scenario:
- Christer-prod støtter 5 integrasjoner i pilot: Kassal, Oda, matkasser
  (f.eks. Godt Levert), Google Calendar, Apple Calendar.
- Prod-brukere trenger ikke å gjøre noe for å aktivere — de velger fra
  en liste i Settings, og Christer-prod har kjørende API-nøkler /
  OAuth-apper for alle på server-nivå.
- Når en integrasjon oppdateres (feks Kassal-API går fra v1 til v2),
  ruller Christer ut en ny image, og alle prod-brukere får oppdateringen
  samtidig.

### 2.2 Self-host — offisielle integrasjoner
Scenario:
- Pilot-familien kjører på egen RPi.
- De vil koble til Kassal — de registrerer egen Kassal-nøkkel i
  Settings (ingen Christer-infrastruktur involvert — per D4).
- Google Calendar krever at de registrerer egen OAuth-app i Google
  Cloud Console og setter inn client_id + client_secret. UI leder dem
  gjennom oppsettet via en wizard.
- Oda / matkasser: hvis disse integrasjonene krever Christer-drevet
  infrastruktur (f.eks. en proxy-server som gjør kalles mot Oda), må
  self-host-brukere ha tilgang til denne proxyen eller akseptere at
  noen integrasjoner kun er tilgjengelige i prod.

### 2.3 Self-host — egen integrasjon
Scenario:
- En svensk pilot-familie ønsker å koble appen mot ICA (ikke i
  katalog). De skriver egen integrasjon i TypeScript, følger
  integrasjons-malen i `docs/development/integration-template.md`,
  installerer via `npm install ./local-integration-ica` eller via git-
  subtree. Integrasjon registrerer seg ved oppstart og blir synlig i
  Settings.

### 2.4 Community-bidrag (post-pilot)
Scenario:
- Svensk familie har kjørt sin ICA-integrasjon i 6 måneder, virker
  bra. De åpner en PR mot hovedrepoet.
- Christer reviewer koden, tester mot pilot-data, og merger.
- Neste prod-release inkluderer ICA som offisiell integrasjon.

---

## 3. Arkitektur-prinsipper for v1-integrasjoner

Hver integrasjon vi bygger (i v1: Kassal) skal følge disse prinsippene,
slik at de senere kan inngå i et katalog-system:

### 3.1 Metadata-first
Hver integrasjon beskriver seg selv:

```ts
// Eksempel for Kassal
export const integrationMetadata = {
  id: 'kassal',
  version: '1.0.0',
  displayName: 'Kassal.app',
  description: 'Prissammenligning og tilbud for norske matvarehandler',
  countries: ['NO'],
  category: 'grocery-pricing',
  authType: 'api-key',
  requiresConfig: ['KASSAL_API_KEY'],
  provides: ['pricing', 'offers', 'store-discovery'],
  setupInstructions: {
    no: 'Registrer en nøkkel på https://kassal.app/api og lim inn i Settings',
    en: 'Register a key at https://kassal.app/api and paste it in Settings',
  },
  officialSupport: true, // vs community-maintained
};
```

Dette metadata-objektet er det som katalog-systemet (når vi får det)
bruker til å liste, filtrere og presentere integrasjoner.

### 3.2 Separasjon: core vs integration
- `server/integrations/<id>/service.js` — integrasjonens egen kode,
  API-kall, error-håndtering.
- `server/integrations/<id>/metadata.js` — objektet over.
- `server/integrations/<id>/routes.js` — integrasjonens HTTP-ruter
  (valgfritt — noen integrasjoner eksponerer egne endepunkter).
- `server/integrations/index.js` — registry som auto-discoverer alle
  `server/integrations/*/metadata.js` ved oppstart og bygger en
  "available integrations"-liste som brukes av `/api/config/features`
  og `/api/integrations/available`.

### 3.3 Konfig via miljøvariabler, ikke hardkoding
Hver integrasjon leser sin konfig fra env:
```
KASSAL_API_KEY=...
ODA_API_KEY=...
GOOGLE_CALENDAR_CLIENT_ID=...
```

Og per-familie-nøkler (som Kassal i D4) lagres i `family_llm_config`-
stil tabell (per-integration-config per familie).

### 3.4 Ikke anta at "internet er tilgjengelig"
Hver integrasjon skal gracefully håndtere at ekstern tjeneste er nede,
har endret API, eller krever ny OAuth-refresh. Feilmeldinger må være
operatørvennlige (RPi-eier skal forstå "Kassal er nede, prisene er fra
i går").

### 3.5 Ikke hardkod landstrenger i UI
Kassal er norsk; Oda er norsk; ICA er svensk. Men UI-en som presenterer
integrasjonen skal lese land fra metadata, ikke fra hardkodet
norsk-tekst i komponenten. Dette er forutsetningen for at appen senere
kan brukes av svenske familier uten full omskriving.

### 3.6 Version-bevisst
Integrasjoner er forskjellige komponenter som utvikles parallelt. Hver
integrasjon har semver-versjon. Katalog-systemet senere kan tilby
"oppdater ICA fra 1.2 til 1.3" uten å oppgradere resten av appen.

---

## 4. Katalog-struktur (post-pilot, skisse)

```
/api/integrations/catalog           → GET liste av tilgjengelige
/api/integrations/catalog/:id       → GET detaljer
/api/integrations/installed         → GET hva familie har aktivert
/api/integrations/installed/:id     → POST/DELETE aktiver/deaktiver
/api/integrations/installed/:id/config  → GET/PUT per-familie-konfig
```

Integrasjoner kan være:
- **Built-in:** ligger i kodebasen, oppdateres med appen
- **Remote:** lastes ned fra et katalog-repo ved første aktivering
- **Local:** installert manuelt av operatør (self-host only)

---

## 5. Hva IKKE gjøres nå (v1)

- **Ingen** katalog-backend
- **Ingen** integrasjons-upload/download-UI
- **Ingen** community-submission-flyt
- **Ingen** remote-loading av integrasjoner
- **Ingen** per-integrasjon versjonering-UI

V1 har kun: Kassal built-in, aktiverbar via Settings, med per-familie-
nøkkel.

---

## 6. Hva gjøres NÅ for å bevare framtidsvisjonen

V1-arbeidet (uke 3-11) må følge disse retningslinjene slik at post-
pilot-visjonen er mulig uten større omskriving:

1. **Kassal-integrasjonen** bygges som `server/integrations/kassal/`
   med metadata.js, service.js, routes.js (hvis nødvendig) — ikke
   spredt ut i andre filer.
2. **`/api/config/features` og `/api/integrations/available`** svarer
   dynamisk basert på `server/integrations/index.js`-registry, ikke en
   hardkodet liste.
3. **Frontend bruker metadata** til å rendre integrasjons-kort i
   Settings. Ingen komponent per integrasjon — én generisk
   `<IntegrationCard metadata={...} />`-komponent som leser labels fra
   metadata.
4. **Database-skjema for integrasjons-konfig** planlegges som
   generisk: `integration_configs(family_id, integration_id,
   config_json)` heller enn én spesifikk tabell per integrasjon.
5. **Setup-instruksjoner** leveres som i18n-nøkler fra metadata, slik
   at norsk/engelsk/osv kan støttes uten å endre integration-koden
   selv.

---

## 7. Beslutnings-triggers (post-pilot)

Når vi gjenvurderer denne visjonen (tidligst uke 11), ser vi på:

- **Antall pilot-familier som faktisk bruker self-host:** hvis bare
  Christer-prod brukes, kan katalog-systemet forenkles til built-in-only.
- **Hvor mange integrasjoner vi har bygget frem til da:** hvis ≥ 5,
  katalog er meningsfull. Hvis ≤ 2, vent.
- **Bruksmønstre i pilot:** er det integrasjoner vi ikke hadde
  forutsett (f.eks. smartklokke-helse, Spotify-playlists, hjemme-
  automatisering)?
- **Hvilke integrasjoner som er "stickey" nok** til at community-
  bidrag er realistisk.

---

## 8. Referanser

- `docs/analyses/2026-04-22-multi-tenant-activation.md` — hvordan
  multi-tenant ble aktivert i uke 2, gir grunnlag for per-familie-
  integrasjons-konfig.
- `docs/vision/` — andre visjons-dokumenter i samme serie (å opprette
  etter behov: internationalization-strategy.md, pilot-to-prod-
  migration.md, etc.)
- RUNBOOK.md §13 — B2 LLM som felles ressurs; lignende pattern som
  integrasjons-konfig (global default + per-familie-override).

---

**Sluttnotat:** dette er et *kompass*, ikke et *kart*. Retningen er
klar; de spesifikke stegene bestemmes i løpet av v1-utvikling og pilot-
fasen. Når forholdene endres, skal dette dokumentet oppdateres.
