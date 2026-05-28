# Pilot-gate blokkerer auth-flow-er — analyse + fix

Dato: 2026-05-06
Branch: `fix/pilot-gate-blocks-auth-flows`
Forfatter: agent
Kompleksitet: liten (én fil + tester, ~30-45 min)

## Problem (rapportert 2026-05-06)

Test-bruker på `app.familyassistant.com` (post-Sprint-10-deploy med
`PILOT_MODE=true`) klikker magic-link i e-post. Browser hits
`/api/auth/magic-link/verify?token=…` og får `403 Pilot password required`.
Brukeren kommer aldri inn i appen — sesjon blir aldri etablert.

Request-ID i bug-rapport: `44132b98b980595b`.

## Reisen — full ende-til-ende

1. Christer (admin) sender magic-link til testbruker
   1.1. Frontend POST `/api/auth/magic-link/start { email }`
   1.2. Server signerer token + lagrer i `magic_link_tokens`
   1.3. Resend leverer e-post med lenke `https://app.familyassistant.com/api/auth/magic-link/verify?token=<sig>`
2. Testbruker klikker lenken
   2.1. Browser åpner ny tab/vindu (kanskje annen enhet enn der invitasjon ble lest)
   2.2. Browser sender GET til `/api/auth/magic-link/verify?token=…`
   2.3. Ingen `fa_pilot`-cookie til stede (ny enhet)
3. Server tar imot request
   3.1. `authenticate()`-middleware kjører `enforcePilotGate(ctx)` FØRST
   3.2. `isPilotEnabled()` returnerer true (PILOT_MODE=true)
   3.3. `isPilotGateBypassPath('/api/auth/magic-link/verify')` returnerer false
   3.4. `isPilotAuthenticated(req)` returnerer false (ingen `fa_pilot`-cookie)
   3.5. Path starter med `/api/` → kaster `errors.forbidden('Pilot password required.')` (status 403)
   3.6. Magic-link-verify-handleren kjører ALDRI; sesjon opprettes ikke
4. Brukeren ser `{"title":"Forbidden","status":403,"detail":"Pilot password required",…}`

## Domenemodell-påvirkning

Berørte filer:
- `server/auth/middleware.js` — pilot-gate logikk (`PILOT_GATE_BYPASS_PATHS`, `isPilotGateBypassPath`, `isPilotAuthenticated`, `enforcePilotGate`)
- `tests/pilot-password.test.js` — utvides med regresjons-tester
- Ingen DB-endringer, ingen migrasjoner

Ingen domenemodell-endringer i `docs/DOMAIN_MODEL.md`.

## Edge-cases

1. **Magic-link verify uten pilot-cookie (bug-en)** — bruker klikker e-post på ny enhet → 403. Fix: bypass `/api/auth/magic-link/`.
2. **Magic-link start uten pilot-cookie** — bruker har glemt pilot-passordet, kan ikke be om magic-link engang. Fix: bypass.
3. **Google OAuth callback fra google.com** — Google redirecter til `/api/auth/google/callback?code=…`. Ingen sesjon ennå. Bypass kreves.
4. **Invitation peek (`GET /api/invitations/:token`)** — invite-mottaker skal se "Christer inviterer deg til Familien" før login. Token-en er auth. Bypass kreves.
5. **Invitation accept (`POST /api/invitations/:token/accept`)** — samme token. Bypass kreves.
6. **Bruker logget inn før env-vars endret** — har gyldig `fa_session`-cookie men ikke `fa_pilot`. Etter fiks: sesjon teller som pilot-auth, ingen disrupsjon.
7. **Magic-link verify med ugyldig token** — bypass-en endrer ikke at handleren validerer token. Ugyldig token → 401 fra handleren, ikke 403 fra pilot-gate. Korrekt feilmelding.
8. **Anonym besøkende åpner /v2/** — uendret oppførsel: pilot-guard i React-app rendrer pilot-passord-skjerm.
9. **Anonym besøkende treffer `/api/today` direkte** — uendret: 403 Pilot password required (path er ikke i bypass).
10. **Bruker har gyldig sesjon men prøver `/api/admin/*`** — uendret: pilot-gate bypassed (sesjon = auth), men `requireRole('owner'/'admin')` på handleren slår inn.
11. **Stale session i DB (utløpt)** — `repos.auth.getValidSession(sid)` returnerer null → pilot-gate kaster 403. Korrekt.
12. **Bruker uten gyldig session-cookie OG uten pilot-cookie treffer bypass-path** — handleren bestemmer videre flyt (magic-link-verify validerer token, invitation-peek validerer token).

## Konsekvenser på tvers

- **Backend handlers:** ingen endring. Magic-link/google/invitations-handlere antok allerede at de ble truffet av anonyme; de validerer egne tokens.
- **Frontend:** ingen endring. PilotGuard kjører fortsatt i React-app. Brukere som har `fa_session` men ikke `fa_pilot` vil se kort flicker mellom pilot-skjerm og dashboard ved første besøk — men ingen funksjons-disrupsjon.
- **Tester DEL 6.1 (frosne):** alle auth-tester (`auth-magic-link.test.js`, `auth-google.test.js`, `auth-cookies.test.js`, `auth-middleware.test.js`, `auth-onboarding-complete.test.js`, `auth-pilot-login.test.js`, `auth-session-repo.test.js`, `auth-bootstrap-session-secret.test.js`, `auth-crypto.test.js`, `tenant-isolation.test.js`, `role-enforcement.test.js`) skal fortsatt passere uten endring — de tester ikke pilot-gate i utgangspunktet (PILOT_MODE er false i deres test-helper-state).
- **Tester DEL 6.5 policy-tester:** ingen endring i `phase21-repo-hygiene.test.js`.
- **OpenAPI-kontrakt:** ingen endring.
- **CHANGELOG:** ny entry under "Sprint 10 follow-ups" — pilot-gate fikset.

## Beslutninger

**BESLUTNING 1: Bypass-mekanisme — exact-match utvidelse vs prefix-match?**

ANBEFALING: Prefix-match for nye paths.

HVORFOR: Magic-link og google-OAuth har flere sub-paths (`/start`, `/verify`, `/callback`, evt. fremtidige). En statisk eksakt-liste blir brittle ved nye routes. Invitation-token-er har dynamisk URL-fragment (`/api/invitations/:token`).

ALTERNATIVER:
- **Eksakt match per path:** krever oppdatering hver gang en ny auth-rute legges til; lett å glemme.
- **Prefix-match:** dekker hele subtree-en. Mindre vedlikeholdsbyrde.

KONSEKVENS HVIS ANNERLEDES: Eksakt-match ville fanget `/api/auth/magic-link/verify` men ikke `/api/auth/magic-link/start` med mindre vi listet begge eksplisitt. Risiko for samme bug-mønster gjentakelse.

**BESLUTNING 2: Sesjon teller som pilot-auth — sentralisert i `isPilotAuthenticated()` vs distribuert i hver auth-handler?**

ANBEFALING: Sentraliser i `isPilotAuthenticated()`.

HVORFOR: Pilot-gate er én konsept ("ikke-anonym besøkende"). Bedre å ha én funksjon som svarer på det spørsmålet enn å smøre `setPilotCookie(res)`-kall i magic-link-verify, OAuth-callback, invitation-accept, og evt. bootstrap-flyt.

ALTERNATIVER:
- **Sett pilot-cookie ved sesjons-opprettelse:** krever endring i 3-4 handlere. Brittle ved nye auth-kilder. Genererer to cookies (session + pilot) i stedet for ett semantisk sjekkpunkt.
- **Sentralisert sjekk:** én funksjon, én test-flyt, en sannhets-kilde.

KONSEKVENS HVIS ANNERLEDES: Distribuert tilnærming krever endring i flere filer per auth-kilde + test per kilde.

**BESLUTNING 3: Repos-injeksjon vs lazy-load i `isPilotAuthenticated`?**

ANBEFALING: Repos-injeksjon via funksjons-parameter (default null for backward compat).

HVORFOR: `createAuthenticate(repos)` har allerede repos. Naturlig å passere videre. Lazy-require ville lage sirkulær import (middleware → repositories/index → middleware via metrics-callback).

ALTERNATIVER:
- **Lazy-require:** risiko for sirkulær avhengighet.
- **Module-level repos:** krever singleton-state, vanskelig å teste.
- **Optional argument med null-fallback:** enkel, testbar, ingen breaking change for andre callers.

KONSEKVENS HVIS ANNERLEDES: Lazy-require ville kreve forsiktig require-rekkefølge; module-level singleton ville bryte test-isolasjon.

## Portainer-oppstartsrisiko-sjekk

| Fil | Berørt? |
|---|---|
| `Dockerfile` / `.dockerignore` | nei |
| `docker-compose.yml` | nei |
| `server/http/bootstrap.js` | nei |
| `server/config.js` (oppstart-validering) | nei |
| `server/index.js` (startup-sekvens) | nei |
| `server/db.js` / `server/migrations/**` | nei |
| `install.sh` | nei |
| `bootstrap.json`-lesning | nei |
| Miljøvariabel-krav for oppstart | nei |

**Konklusjon: ingen Portainer-risiko.** Endringen er kun i request-tids-middleware. Server starter uendret. Eksisterende `PILOT_MODE`/`PILOT_PASSWORD`/`PILOT_COOKIE_NAME`-env-vars uendret.

## ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Begrunnelse |
|---|---|---|---|
| Functional Suitability | 8.7 | 8.8 (+0.1) | Auth-flyt fungerer ende-til-ende under PILOT_MODE; tidligere var den brutt for alle eksterne brukere. |
| Reliability | 8.5 | 8.5 (uendret) | Ingen endring i feilhåndtering/recovery. |
| Security | 8.3 | 8.3 (uendret) | Pilot-gate beholder anonym-blokk-funksjonalitet. Token-baserte auth-endepunkter har egen validering. Sesjons-cookie krever gyldig DB-rad. Ingen nye angreps-vektorer. |
| Usability | 8.7 | 8.7 (uendret merkbart) | Brukere klikker e-post-lenker uten ekstra friksjon. Etter første pålogging ingen pilot-passord-prompt. |
| Maintainability | 8.5 | 8.5 (uendret) | Sentralisering i `isPilotAuthenticated()` er mer vedlikeholdbar enn distribuert pilot-cookie-setting. |
| Performance | 8.4 | 8.4 (uendret merkbart) | Sesjons-cookie-sjekk legger til én DB-spørring per request — men `repos.auth.getValidSession(sid)` kjøres uansett senere i `authenticate()` for samme sesjon. Mulig å cache resultatet (se Plan §4). |

## Plan

Commits i rekkefølge (hver < 200 linjer diff):

1. **`docs(analysis): pilot-gate auth-bypass plan`** — denne filen.

2. **`fix(auth): pilot-gate bypass for external auth flows`** — `server/auth/middleware.js`:
   - Ny `PILOT_GATE_BYPASS_PREFIXES`-array med `/api/auth/magic-link/`, `/api/auth/google/`, `/api/invitations/`
   - `isPilotGateBypassPath()` itererer prefixes
   - `isPilotAuthenticated(req, repos)` får valgfri 2. parameter; returnerer true også når `cookies[SESSION_COOKIE_NAME]` matcher gyldig sesjon
   - `enforcePilotGate(ctx, repos)` propagates repos til `isPilotAuthenticated`
   - `createAuthenticate(repos)` passerer repos til enforcePilotGate
   - JSDoc-oppdatering på funksjons-signaturer

3. **`test(auth): pilot-gate bypasses external auth flows + honors sessions`** — `tests/pilot-password.test.js`:
   - Ny describe-block "External auth flows under PILOT_MODE":
     - GET `/api/auth/magic-link/verify?token=invalid` → ikke 403 (skal gi 4xx fra handleren, ikke 403 fra pilot-gate)
     - GET `/api/invitations/sometoken` → ikke 403
     - POST `/api/auth/magic-link/start { email }` → ikke 403
   - Ny describe-block "Session-cookie honored as pilot-auth":
     - Med gyldig session-cookie + ingen pilot-cookie: GET `/api/auth/me` → 200 (med user)
     - Med ugyldig session-cookie + ingen pilot-cookie: GET `/api/auth/me` → 403 Pilot password required
   - Ingen endring i eksisterende tester (DEL 6.1 garanti).

4. **(optional, kan utsettes hvis tid er tight)** — caching av session-lookup mellom `enforcePilotGate` og `authenticate` for å unngå dobbelt DB-oppslag. Vurder etter Tier 3 test-run hvis det ikke skader.

## Kompleksitet-vurdering

Christer estimerte 30-45 min. Analysen bekrefter trivialitet:
- Én fil (`middleware.js`) + én test-fil
- Ingen domenemodell-endring
- Ingen forretningsregel
- 12 edge-cases, 6 av dem (1-6) er kjernen
- Lavest mulig Portainer-risiko (ingen)

Per CLAUDE.md DEL 11: liten oppgave med < 3 edge-cases-budsjett-overskrid? Vi har 12 edge-cases — noe over "trivielt"-grensen. Likevel: oppgaven er konstruert som en ren regresjons-fiks med klar anbefaling. Ingen scope-endring forventet.

Kort analyse er forsvarlig.

## Klargjøring fra Christer 2026-05-06

Under implementasjon ble en eksisterende test-assertion oppdaget i
`tests/pilot-gate-lockout-fix.test.js:131-138` som håndhevet motsatt policy:
"magic-link verify must require pilot cookie" med kommentar "Christer's
pragmatic decision: keep magic-link/verify gated so pilot password is
required before any session can be created."

Christer klargjorde policy-en eksplisitt (chat 2026-05-06):

> "pilot gate er kun en formalitet, for at det ikke er hvem som helst som
> kan få lov å komme inn til Wizard, så ingenting må avhenge/trenger å
> avhenge av PilotPassword, siden det er en midlertidig True, som jeg kan
> sette False og vi har ikke gaten der lengre."

**Konsekvens:** Pilot-gate er en formalitet, IKKE en auth-mekanisme.
Kjerne-auth-flyt (magic-link, OAuth, invitations) skal aldri kobles til
pilot-password-cookien — den er en midlertidig toggle operatøren slår av
når soft-launch er over. Den tidligere "same browser"-antakelsen ble
reversert, og test-en oppdatert til å håndheve den nye policy-en.

## Risiko + rollback

**Risiko:** Hvis bypass-prefix-match er for løs (f.eks. `/api/invitations/`-prefix matcher en hypotetisk fremtidig admin-only invitation-route), kan vi ved et uhell åpne sub-routes som burde være gated. Mitigering: definer KONKRET liste med 3 prefixes; review hver gang ny auth-route legges til.

**Rollback:** Trivielt — revertere én commit. Auth-flyt går tilbake til "brutt for eksterne brukere" men deploy-en faller ikke. Pilot kan deaktiveres via `PILOT_MODE=false` som workaround.

**Backward-compat:** `enforcePilotGate(ctx)` (uten repos) → fortsatt fungerende fallback (session-check skipped). Eksisterende eksterne callers (ingen kjente per grep) påvirkes ikke.
