# ANALYSE: Pre-auth pilot password protection

**Dato:** 2026-05-04
**Branch:** `feat/pilot-password-protection`
**Type:** Feature (security gate, full-stack)
**Authoritative reference:** Sprint 7 spec — pilot deploy 13–17 May 2026

## Reisen

Pilot-bruker (kjent person Christer har gitt passord til, eller Christer selv på en ny enhet) navigerer til `app.hverdagsplanleggeren.com` via Cloudflare Tunnel.

1. Backend mottar request på `/v2/`.
1.1. Auth-middleware kjøres FØR alle andre auth-sjekker.
1.2. `enforcePilotGate()` sjekker `PILOT_MODE` og pilot-cookie.
1.3. PILOT_MODE=true + ingen cookie + ikke en bypass-path → React app lastes (HTML+JS+CSS).
1.4. PILOT_MODE=true + ingen cookie + API-kall → 403 JSON-respons.
2. React app bootstrapes via `<App />`.
2.1. `<PilotGuard>` kaller GET `/api/pilot/status` på mount.
2.2. Backend returnerer `{ pilotMode: true, pilotAuthenticated: false }`.
2.3. PilotGuard rendrer `<PilotPasswordGate />` i stedet for `<AppRoutes />`.
3. Bruker ser passord-form med tittel "Velkommen!" og forklaring.
3.1. Bruker skriver passord, trykker Fortsett.
3.2. Frontend POST `/api/auth/pilot-password` med `{ password: "..." }`.
4. Backend håndterer attempt:
4.1. Sjekker per-IP rate limit (5 attempts/10 min).
4.1.1. Hvis over limit → 429 + Retry-After + audit-log med success=false.
4.2. Sjekker `isPilotEnabled()` — pilot config er valid.
4.3. Konstant-tids-sammenligning av password mot `PILOT_PASSWORD` env.
4.4. Audit-log entry inserted (success=true/false).
4.5. Hvis success: HMAC-cookie genereres (HMAC(password, "pilot-gate-v1")), sett som HttpOnly+Secure+SameSite=Lax i 30 dager.
4.6. Returnerer 200 ok / 401 wrong_password / 429 rate_limited / 503 pilot_disabled.
5. Frontend håndterer respons:
5.1. ok → `onAuthenticated()` → PilotGuard re-rendrer med `phase: 'open'` → AppRoutes kjører.
5.2. wrong_password → vis "Feil passord. Du har {{count}} forsøk igjen.", clear input.
5.3. attemptsRemaining=0 → også låser form (ingen flere forsøk mulig).
5.4. rate_limited → vis lockout-melding, lås form.
5.5. pilot_disabled → behandle som authenticated (gateway er av, ikke noe å beskytte).
6. Bruker ser appen og kan logge inn med magic-link som normalt.

## Domenemodell-påvirkning

Ny domene-konsept: **pilot-gate** — en pre-auth tilgangs-mekanisme orthogonal til magic-link / sessions. Pilot-cookie bekrefter "denne enheten kjenner pilot-passordet" (én skjell), session-cookie bekrefter "denne enheten er logget inn som spesifikk bruker" (annen skjell).

Berørte filer:
- `server/migrations/025_pilot_password_attempts.sql` — ny audit-tabell
- `server/services/pilot-password.service.js` — ny service med rate-limit + verifisering
- `server/repositories/pilot-password-attempts.repo.js` — ny repo (insert + recent + countByIpSince)
- `server/repositories/index.js` — register nye repo
- `server/config.js` — nye env-vars: `PILOT_MODE`, `PILOT_PASSWORD`, `PILOT_COOKIE_NAME`, `PILOT_COOKIE_TTL_DAYS`
- `server/auth/middleware.js` — `enforcePilotGate()` middleware (DEL 6.1b — krever Christer-godkjenning)
- `server/auth/routes.js` — `handlePilotStatus`, `handlePilotPassword`, route-registreringer
- `client/src/app/auth/pilotApi.ts` — API-klient
- `client/src/app/components/auth/PilotPasswordGate.tsx` — UI-komponent
- `client/src/app/components/auth/PilotGuard.tsx` — wrapper-komponent
- `client/src/app/App.tsx` — wire PilotGuard som ytterst
- `client/src/app/i18n/locales/{no,en}/auth.json` — nye `pilot.password.*` keys
- `tests/pilot-password.test.js` — backend tester (14 cases)
- `client/src/app/components/auth/PilotPasswordGate.test.tsx` — frontend tester (7 cases)

## Edge-cases

1. **PILOT_PASSWORD changes mellom deploys.** HMAC-cookien bindes til password — gamle cookies blir automatisk ugyldige. Brukere må re-logge med nytt passord. Bevisst design.
2. **PILOT_MODE slås av (PILOT_MODE=false).** Service returnerer `isPilotEnabled()=false` → middleware lar alle requests passere. Frontend ser `pilotMode: false` → ikke gated. Smooth post-pilot-overgang.
3. **PILOT_MODE=true men PILOT_PASSWORD missing.** `isPilotEnabled()` returnerer false (krever begge). Fail-open — middleware lar requests passere fordi det ikke er noe å sammenligne mot. Operatør får ingen krasj men også ingen gate.
4. **Rate-limit hits midt i bytte fra wrong→right password.** Etter 5 wrong attempts er IP rate-limited i 10 min. Selv riktig passord rejected som 429. Bevisst — ellers kunne brute-force avsluttes ved tilfeldig riktig gjetning.
5. **Bruker mister pilot-cookie midt i sesjon.** Backend returnerer 403 på neste API-call. AuthContext eller fetch-error håndterer dette. Frontend kan trigge re-fetch av `/api/pilot/status` og vise gate på nytt. Pilot-scope: aksepter "user must re-enter password".
6. **Cloudflare cacher Set-Cookie.** Cloudflare cacher ikke responses med Set-Cookie by default. Verified: `cache: 'no-store'` ikke nødvendig.
7. **CORS preflight på /api/auth/pilot-password.** Same-origin-deploy via Cloudflare Tunnel — ingen CORS preflight. ALLOWED_ORIGINS tillater app-domenet.
8. **JS disabled.** React app rendrer ikke gate. Pilot-bruker uten JS får tom side. Akseptabel pilot-scope (krever JS uansett).
9. **Bruker kommer til /privacy.html før gate.** Whitelist i `PILOT_GATE_BYPASS_PATHS` — privacy/terms bypasser gate. Bruker kan lese personvernerklæringen før hun bestemmer om hun vil prøve passord.
10. **Bruker bytter mellom flere enheter.** Hver enhet trenger eget pilot-passord-attempt for å sette cookien. Cookie er per-browser, ikke per-bruker.

## Konsekvenser på tvers

- **Frontend:** `<App />` får ny ytterste wrapper `<PilotGuard>`. Når PILOT_MODE=false er det praktisk en pass-through med én fetch. Bundle øker ~5KB.
- **Backend:** Ny middleware-trinn FØR auth. Ny endpoint × 2. Ny migrasjon. Ny service. Ingen påvirkning på eksisterende endpoints (ren pre-gate).
- **Database:** Ny tabell `pilot_password_attempts` (3 kolonner + id, ingen FK). Auto-prunes ikke i pilot-scope (5 dager × få attempts = trivielt antall rader).
- **Tests:** 14 backend + 7 frontend = 21 nye tester. Backend tester verifiserer rate-limit, audit log, middleware enforcement, disabled mode. Frontend tester verifiserer alle response-shapes (ok/wrong/rate-limited/disabled/network).
- **DOMAIN_MODEL.md:** Ikke oppdatert — pilot-gate er en transient pilot-feature, ikke domene-konsept.
- **OpenAPI:** Bør oppdateres post-pilot hvis endpointet skal forbli; pilot-scope: skip.
- **CHANGELOG.md:** Entry under "Added — Auth — Pilot password gate".

## Beslutninger

### BESLUTNING 1: Pre-auth gate vs. integrert i auth-middleware

**ANBEFALING:** Pre-auth gate (egen middleware-trinn FØR auth).

**HVORFOR:** Pilot-passordet beskytter mot at fremmede _ser_ login-skjermen i det hele tatt. Hvis det var integrert i auth-middleware, ville fremmed-bruker først nådd login-form og kunne starte magic-link-flow (som genererer email + token).

**ALTERNATIVER:**
- A: Reverse-proxy nivå (Cloudflare Access / nginx auth_basic). Ingen kode-endring, men krever ekstra Cloudflare-oppsett som er utenfor pilot-scope.
- B: Integrert i auth-middleware. Mindre kode, men gir bort login-form til fremmede.

**KONSEKVENS HVIS ANNERLEDES:** B-alternativet eksponerer login-skjerm offentlig — pilot-passord-formålet svekkes.

### BESLUTNING 2: HMAC-cookie vs. random session-token

**ANBEFALING:** HMAC-cookie (HMAC(PILOT_PASSWORD, "pilot-gate-v1")).

**HVORFOR:** Cookies er stateless — ingen DB-lookup, ingen session-state. Endring av PILOT_PASSWORD invaliderer alle gamle cookies automatisk. Trivielt å implementere.

**ALTERNATIVER:**
- A: Random token i pilot_sessions-tabell. Krever ekstra DB-tabell, lookup på hver request, separat invalidering. Overkill for pilot-scope (ingen revoke-behov utenfor password-rotation).
- B: JWT med expiry. Krever JWT-signing-key separat fra session-secret. Overkill.

**KONSEKVENS HVIS ANNERLEDES:** Mer state, mer kode, ingen funksjonell gevinst for pilot.

### BESLUTNING 3: Per-IP rate-limit i memory

**ANBEFALING:** In-memory Map per IP (samme mønster som magic-link service).

**HVORFOR:** Pilot-deploy er single-node RPi5. In-memory er trivielt og raskt. Audit-log går til DB for forensikk; rate-limit er sikkerhetstiltak i øyeblikket.

**ALTERNATIVER:**
- A: DB-basert rate-limit. Krever spørring per request, dårligere ytelse, ingen funksjonell gevinst.
- B: Redis. Overkill for single-node RPi.

**KONSEKVENS HVIS ANNERLEDES:** A er treg, B er overkill. In-memory er riktig dimensjonert.

### BESLUTNING 4: Frontend bypass-paths inkluderer /v2/ + /v2/assets/

**ANBEFALING:** React app's HTML + JS + CSS må kunne lastes uten gate-cookie, slik at gate-UI kan vises.

**HVORFOR:** Catch-22: hvis gate-en blokkerer JS-bundle, kan PilotPasswordGate aldri rendre. Men API-call (POST /api/auth/pilot-password) selv må gå gjennom — det er det vi vil tillate.

**ALTERNATIVER:**
- A: Server-side gate page (HTML form) i stedet for React. Mindre coupling, men dupliserer UI utenfor designsystem.

**KONSEKVENS HVIS ANNERLEDES:** A ville krevd separat HTML-fil med inline-styling. React-tilnærming gir konsistent designsystem og oversettelse via i18next.

## Portainer-oppstartsrisiko-sjekk

- `Dockerfile`: NEI
- `.dockerignore`: NEI
- `docker-compose.yml`: NEI (men nye env-vars må dokumenteres)
- `server/http/bootstrap.js`: NEI
- `server/config.js`: **JA** — nye env-vars (PILOT_MODE, PILOT_PASSWORD, PILOT_COOKIE_NAME, PILOT_COOKIE_TTL_DAYS) med fornuftige defaults. Server starter uten dem (PILOT_MODE defaults false, PILOT_PASSWORD optional).
- `server/index.js`: NEI
- `server/db.js`: NEI
- `server/migrations/**`: **JA** — ny migrasjon 025. Tester verifiserer migrasjonen kjører rent.
- `install.sh`: NEI
- `bootstrap.json`: NEI
- Miljøvariabel-krav: **NEI** — alle nye env-vars er optional.

**Konklusjon:** Lav Portainer-risiko. Ny migrasjon er additive (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Server kan starte med ingen av de nye env-vars satt — defaults gir trygg pre-pilot-tilstand (PILOT_MODE=false). Pilot-deploy aktiverer ved å sette PILOT_MODE=true og PILOT_PASSWORD i Portainer-config.

**Rollback-strategi:** Hvis problem oppstår post-deploy, sett PILOT_MODE=false i Portainer og restart. All annen funksjonalitet uberørt. Migrasjonen kan beholdes (ingen UI-konsekvens).

## ISO 25010-påvirkning

- **Sikkerhet:** 8.2 → 8.4 (+0.2, ny pre-auth gate skjuler login-skjerm fra ikke-autoriserte besøkende)
- **Funksjonell egnethet:** 8.7 → 8.8 (+0.1, manglende pilot-pre-auth lagt til)
- **Brukbarhet:** 8.5 → 8.5 (uendret — pilot-bruker har én ekstra steg, men språket er klart)
- **Pålitelighet:** 8.4 → 8.4 (uendret)

Andre karakteristikker: ikke berørt.

## Plan

Én commit (eller squashed til én ved push):

1. `feat(auth): pilot password gate (backend + frontend)`
   - Migrasjon 025
   - Service + repo + route + middleware
   - PilotPasswordGate + PilotGuard + pilotApi
   - i18n NO + EN
   - 14 backend + 7 frontend tester
   - Denne analysen

## Kompleksitet-vurdering

Stor feature: full-stack, ny migrasjon, ny middleware, ny service, ny komponent, full test-coverage. Estimert ~600 linjer total diff (kode + tester). Berettiget av sikkerhets-behovet for pilot-deploy.
