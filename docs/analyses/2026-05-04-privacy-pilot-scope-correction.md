# ANALYSE: Privacy.html corrected for pilot scope

**Dato:** 2026-05-04
**Branch:** `docs/privacy-pilot-scope-correction`
**Type:** Trivial docs / GDPR compliance

## Bakgrunn

Pre-pilot audit § H5 / Top-10 H5 flagget at `public/privacy.html` nevner tjenester som ikke er aktivert i pilot:
- Backblaze B2 (off-site backup) — ingen kode, kun dokumentert
- Sentry (error tracking) — kode finnes men `SENTRY_DSN` er unset i pilot
- Google OAuth (innlogging) — kode finnes men `GOOGLE_CLIENT_ID` er unset; pilot er kun magic-link

Å nevne tredjeparts-prosessorer i en personvernerklæring som ikke faktisk brukes er en **GDPR-presisjons-feil** og kan undergrave brukerens tillit ("Hva skjer egentlig med mine data?").

## Reisen

1. Pilot-bruker åpner v2-app og scroller til footer/login-page.
2. Bruker klikker "Personvern"-lenke.
3. Bruker leser personvernerklæringen.
3.1. Eksisterende fil-tilstand: nevner B2, Sentry, Google OAuth (alle inaktive i pilot).
3.2. Ny fil-tilstand: nevner kun aktive tjenester + planlagte med "kan aktiveres senere"-merknad.
4. Bruker forstår nøyaktig hvilke tjenester som behandler data i pilot.

## Endringer

### Fjernet (ikke aktivert i pilot)

- **Google OAuth**-rad i tredjeparts-tabell (kode finnes men er env-gated; pilot er kun magic-link)
- **Backblaze B2**-rad (ingen kode finnes; cloud-backup er post-pilot pending decision)
- Identity-seksjonen "navn, epost og profilbilde fra Google OAuth, eller epost fra magic-link-innlogging" → forenklet til "epost fra magic-link-innlogging"

### Oppdatert

- **Sentry**-rad: markert som "valgfri opt-in via SENTRY_DSN env-variabel; ikke aktivert i pilot"
- **Resend**-rad: markert "kun magic-link-leveranse; aktiveres når Christer setter RESEND_API_KEY"

### Lagt til

- **Cloudflare Tunnel**-rad: nevnes for pilot-deploy (gateway til selvhostet RPi5)
- **Kassal API**-rad: nevnes som "valgfri opt-in via KASSAL_API_KEY; aktiveres post-pilot for prissammenligning"
- Lite "Sist oppdatert"-felt nederst med dato (2026-05-04)
- Engelsk parallell-versjon: `public/privacy-en.html` (samme struktur, oversatt innhold)
- Toppbar-lenke "Norsk | English" begge versjoner

## Edge-cases

1. Pilot-bruker bruker browser med `Accept-Language: en` — får fortsatt Norwegian privacy.html (no language routing for static pages); `Norsk | English`-toggle gir manuell veksling.
2. Bruker har bookmark til `privacy.html` — fortsatt fungerer.
3. Bruker linker fra `index.html` eller `login.html` — fortsatt fungerer (lenker uendret).
4. Bruker laster ned privacy.html offline (uvanlig) — språk-toggle vil ikke fungere, men teksten leses uansett.

## Konsekvenser på tvers

- **Frontend:** Ingen påvirkning på React-app. Static page.
- **Backend:** Ingen påvirkning. `server/http/static.js` server fortsatt `public/`-mappen.
- **API:** Ingen.
- **Tester:** Ingen test-endring (privacy.html lintes ikke; det er ikke automatisert test for innhold).
- **DOMAIN_MODEL.md:** Ingen.

## Beslutninger

### BESLUTNING 1: Fjern eller markér tjenester

**ANBEFALING:** Fjern tjenester som har null kode (Google OAuth fra identity-tekst; B2 helt ut av tabell). Markér tjenester som er env-gated (Sentry, Resend, Kassal) med "aktiveres ved env-variabel"-merknad.

**HVORFOR:** GDPR krever presisjon — listing av prosessor som ikke brukes er villedende. Markering av env-gated er korrekt: tjenesten kan brukes hvis admin slår den på.

**ALTERNATIVER:**
- Behold alt og legg til "ikke aktivert"-merknad. Fungerer men er rotete; kan fortsatt forvirre brukere.

**KONSEKVENS HVIS ANNERLEDES:** GDPR-presisjon svekkes; brukerens forståelse av tjenestelandskap blir uklar.

### BESLUTNING 2: Engelsk versjon

**ANBEFALING:** Lag `public/privacy-en.html` som parallell-fil med samme struktur. Lenker til hverandre via topp-toggle.

**HVORFOR:** Christers task spesifiserer "Begge språk-versjoner (NO/EN)". Pilot er primært norsk, men strukturell parity gjør senere oversettelse trivielt.

**ALTERNATIVER:**
- Kun norsk: bryter task-spec.
- Inline-toggle (JS-styrt språkbytte i samme fil): mer kompleks, krever JS som er overkill for static page.

**KONSEKVENS HVIS ANNERLEDES:** Pilot bruker ser kun norsk hvis vi droppes engelsk; senere må vi uansett implementere det.

## Portainer-oppstartsrisiko-sjekk

Alle: NEI. Static HTML-endring som ikke påvirker oppstart, container, migrations, eller config.

## ISO 25010-påvirkning

- Compliance: 8.0 → 8.2 (+0.2, GDPR-presisjon styrkes)
- Andre karakteristikker: ikke berørt

## Plan

Én commit:
1. `docs(privacy): correct privacy policy for pilot scope`
   - Update `public/privacy.html` (Norwegian, primary)
   - Create `public/privacy-en.html` (English parallel)
   - Add language toggle to top of both
   - Add this analysis

## Kompleksitet-vurdering

Trivial docs-endring. Rent innhold + ett ekstra fil + ingen kode-endring. Match med "liten".
