# Analyse: Multi-tenant aktivering (uke 2, B1)

> **Note (2026-04-29):** This document references Railway as the
> deploy target. The architecture decision was later changed to
> Docker → Portainer → RPi5 → Cloudflare Tunnel (Sprint 2.6). See
> the master plan in `docs/master-plan/` for the current deploy
> architecture. Document preserved as historical record of the
> multi-tenant activation reasoning; the multi-tenant auth code
> in `server/auth/` continues to be relevant under DEL 6 of
> CLAUDE.md, only the deploy target has changed.

**Dato:** 2026-04-20 (uke 2-start)
**Forfatter:** Claude Code
**Baseline:** `main` commit `8372852` + lokal-først-arbeidsflyt (ikke pushet)
**Beslutning (Issue #62, B1):** (a) Start multi-tenant aktivering uke 2.
**Avhengigheter som er UTSATT:** B3 Resend (uke 3-4), B4 Cloudflare Tunnel (uke 4-5)
**Kompleksitet:** stor
**Portainer-risiko:** **HØY** — rører auth-middleware, config-validering og
frys-regler. Trigger DEL 3 Steg 3b (PORTAINER-RISIKO-prosedyren).

> **STOPP før kode.** Denne analysen er skrevet for å få klarhet før noe
> kode endres. Flere nøkkel-valg krever Christer-input (se § 8).

---

## 1. Viktig oppdagelse før vi starter

**Multi-tenant-kode er allerede bygget, registrert og testet.** Dette er
ikke "tin frysen og bygg det" — det er "slå på den eksisterende koden
for ekte bruk, ikke bare single-tenant-pilot."

### 1.1 Hva som allerede eksisterer

| Komponent | Sted | Linjer | Status |
|---|---|---|---|
| Auth-middleware | `server/auth/middleware.js` | 194 | ✅ Aktiv — håndterer Bearer, session-cookie, legacy-fallback |
| OAuth + magic-link + session routes | `server/auth/routes.js` | 290 | ✅ Registrert i `server/routes.js:215` |
| Family + invitation routes | `server/auth/family-routes.js` | 407 | ✅ Registrert i `server/routes.js:220` |
| Onboarding (create-family) | `server/auth/onboarding-routes.js` | 40 | ✅ Registrert i `server/routes.js:235` |
| GDPR-routes | `server/auth/gdpr-routes.js` | 193 | ✅ Registrert i `server/routes.js:230` |
| LLM per-familie config | `server/auth/llm-routes.js` | 100 | ✅ Registrert i `server/routes.js:225` |
| AsyncLocalStorage family-context | `server/auth/family-context.js` | 68 | ✅ I aktiv bruk i alle repo-metoder |
| Sessions repo + crypto | `sessions.js`, `crypto.js`, `cookies.js` | 193 | ✅ Integrert |
| Google OAuth + magic-link | `google.js`, `magic-link.js` | 362 | ✅ Implementert; krever config |
| Migration 014 (multi-family schema) | `migrations/014_auth_and_multi_family.sql` | — | ✅ Kjørt (alle 18 migrasjoner applied) |
| Tests | `tenant-isolation.test.js`, `auth-*.test.js`, `role-enforcement.test.js` | 1000+ | ✅ Alle grønne |

### 1.2 Hva "single-tenant i dag" betyr teknisk

På RPi i dag:

```
Request → authenticate(ctx)
       → Bearer AUTH_TOKEN match
       → attachLocalUser: LOCAL_USER = { id: 0, family_id: 1, role: 'owner', _synthetic: true }
       → repos kjører med familyId=1 via getFamilyId()-fallback (LEGACY_FAMILY_ID)
```

**Ingen reell multi-tenant-sesjon eksisterer** fordi:
- Ingen Google OAuth-konfig (GOOGLE_CLIENT_ID mangler)
- Ingen Resend/e-post-konfig (magic-link tilgjengelig kun med
  `MAGIC_LINK_CONSOLE=true` som skriver kode til server-logg —
  mulig for lokal test, ikke for ekte brukere)
- Ingen offentlig URL (tunnel utsatt til B4)

Bearer-token-flyten treffer `LOCAL_USER` som alltid gir `family_id=1`.
Det betyr at selv om to forskjellige brukere logger inn med ulike
AUTH_TOKEN-er, treffer de begge family_id=1. Eksisterende test
`tenant-isolation.test.js` bypasser middlewaren ved å sette opp ekte
users med session-IDer via `server.repos._db` direkte — som ikke er
mulig for ekte brukere i dag.

### 1.3 Hva "multi-tenant aktivering" derfor konkret betyr

Tre underliggende utfordringer å løse:

**U1 — Session-basert innlogging må kunne brukes på RPi uten tunnel.**
For lokal-test i uke 2 må vi kunne opprette ekte user-sessions mot
RPi-en fra LAN. Alternativer:
- (a) `PILOT_BYPASS=true` + `/api/auth/pilot-login` — eksisterer,
  men skaper kun én pilot-user pr "pilot@local"-adresse. Ikke
  egnet for multi-family test.
- (b) `MAGIC_LINK_CONSOLE=true` + manuelt kopiere login-koden
  fra server-logg til nettleser. Funker for 2-3 test-brukere.
- (c) Google OAuth med `redirect_uri=http://localhost:7777/...` —
  Google tillater localhost uten verifisert domene, men kun for
  test-prosjekter. Kan fungere hvis Christer oppretter test-
  prosjekt i Google Cloud Console.

**U2 — Tenant-isolation må verifiseres empirisk.** Dagens
`tenant-isolation.test.js` kjører i isolasjon med injiserte sessions;
vi trenger end-to-end-verifikasjon hvor to ekte nettlesere logger
inn som forskjellige familier og sjekker at data ikke lekker.

**U3 — Frysen i CLAUDE.md DEL 6.1 må tines kontrollert.** Så snart
vi aktiverer multi-tenant-flyten i prod, kommer bugs og iterasjoner.
Frysen må løsnes på auth-koden uten å miste bevis for at koden er
korrekt (eksisterende tester fortsetter å passere).

---

## 2. Reisen — fra single-tenant pilot til aktiv multi-tenant

### Nivå 1: Konfig-oppsett (ingen kode-endring)

1.1 **`SESSION_SECRET`** (≥32 hex-char) genereres og legges til
    `.env` / Portainer-stack-env. Uten denne faller
    `signPayload()`/`verifyPayload()` tilbake til
    `'dev-secret'` ([server/auth/routes.js:33](../../server/auth/routes.js#L33)) —
    usikkert.

1.2 **`MAGIC_LINK_CONSOLE=true`** settes som utgangspunkt for
    uke 2-test. Skriver magic-link-tokener til server-logg.
    Fjernes i uke 3-4 når Resend er koblet opp (B3).

1.3 **`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`** settes valgfritt —
    hvis Christer oppretter test-prosjekt i Google Cloud Console.
    Ikke påkrevd for uke 2.

1.4 **Verifikasjon:** `handleAuthConfig()`
    ([routes.js:240-246](../../server/auth/routes.js#L240)) returnerer
    `{ pilotBypass, google, magicLink }` — sjekkes via
    `GET /api/auth/config` etter restart.

### Nivå 2: Frys-tining (dokumentasjons-endring)

2.1 **Oppdater CLAUDE.md DEL 6.1.** Fjern `server/auth/` fra
    frysen, eller klargjør at den er "aktivert men krever fortsatt
    analyse for endringer".

2.1.1 Argumentet for å tine: aktivering av multi-tenant betyr at
      bugs vil oppstå og må fikses. Frysen blokkerer fremdrift.

2.1.2 Argumentet for å beholde strengere regler: Christer har
      sagt auth-koden er kritisk og tidligere ble satt i frys
      nettopp fordi vi ikke ønsket uforutsette endringer.

2.1.3 **ANBEFALT mellom-tilnærming:** Endre DEL 6.1 fra "frosset"
      til "krever eksplisitt godkjenning per endring via DEL 5.3
      (feat/fix + Christer-godkjenning)". Dette beholder sikkerhets-
      nettet men åpner for utvikling.

2.2 **Oppdater CONTEXT.md** for å sette DEL B (frontend-bug) til
    lav prioritet midlertidig. Multi-tenant er blokker for alle
    uke 2-7-oppgaver.

### Nivå 3: End-to-end-verifikasjon lokalt

3.1 **Opprett to test-familier via UI-en:**

3.1.1 Åpne `http://<rpi>:7777/login.html` i nettleser 1 (feks
      Chrome). Logg inn med magic-link eller pilot-bypass.

3.1.2 `POST /api/onboarding/create-family` (`{ name: "Test Familie A" }`)
      via UI eller curl.

3.1.3 Åpne `http://<rpi>:7777/login.html` i nettleser 2 (feks Firefox
      med separat cookie-jar). Logg inn som annen bruker. Opprett
      "Test Familie B".

3.2 **Opprett data i begge familier:**

3.2.1 Som user A: `POST /api/pantry` med `productKey=banana`, qty=3.

3.2.2 Som user B: `POST /api/pantry` med `productKey=apple`, qty=5.

3.3 **Verifiser isolasjon:**

3.3.1 Som user A: `GET /api/pantry` → forventet kun bananer.

3.3.2 Som user B: `GET /api/pantry` → forventet kun epler.

3.3.3 Sjekk DB direkte via Node one-liner fra containeren:
      ```js
      db.prepare('SELECT family_id, product_key, qty FROM inventory ORDER BY family_id').all();
      ```
      → to rader, forskjellige family_id-er.

3.4 **Test invitasjons-flyt:**

3.4.1 Som user A: `POST /api/family/invitations` med
      `{ email: "user-c@test", role: "adult" }`.

3.4.2 Kopier token fra respons, åpne
      `http://<rpi>:7777/invite/<token>` i nettleser 3.

3.4.3 Logg inn som user C, aksepter invitasjon.

3.4.4 Verifiser at user C nå er med i family A (kan se
      bananer), IKKE family B.

### Nivå 4: Cleanup og dokumentasjon

4.1 **Slett test-familier** via `DELETE /api/family` (krever
    owner-rolle).

4.2 **Oppdater DOMAIN_MODEL.md** hvis nye entiteter eller regler
    bekreftet (f.eks. presiser hvordan session-id genereres og
    lagres).

4.3 **Oppdater RUNBOOK.md** med multi-tenant-drifts-instrukser:
    nullstilling, invitasjon-opprydding, feilsøking av tenant-
    mismatch.

---

## 3. Hypoteser og scope-valg

### H1 — "Aktivering = bare konfig-endring" (enklest)

Hvis kun `SESSION_SECRET` + `MAGIC_LINK_CONSOLE` + lokal test er
nødvendig, er uke 2-arbeidet:
- 1 commit: oppdater `.env.example` og `docker-compose.yml`
- 1 commit: oppdater CLAUDE.md DEL 6.1 (tin frys)
- 1 commit: oppdater CONTEXT.md + dokumentasjon

**Forventning:** Finner 1-2 bugs under lokal-test som krever små
fix-commits.

**Sannsynlighet:** middels. Eksisterende tester passerer, men
tester bypasser sommiddelware ved direkte DB-manipulasjon.

### H2 — "Aktivering = konfig + mindre bug-fiksing"

Hvis tester passerer men ekte UI-flyt har små frontend-bugs
(manglende error-handling, feil redirect, localStorage ikke
ryddet ved logout), er uke 2-arbeidet:
- H1 + 2-5 fix-commits for oppdagede bugs
- Uten nye migrasjoner

**Sannsynlighet:** høy. Vi har nettopp hatt en "tom handleliste"-
bug som avslørte at UI-en ikke håndterer tom `categories`-array —
tilsvarende bugs i multi-user-flyten er sannsynlige.

### H3 — "Aktivering = konfig + data-modell-utvidelse"

Hvis vi oppdager at eksisterende skjema mangler ting vi trenger
(f.eks. `families.active` flag, `invitations.expires_at` fix,
`users.email_verified`), krever uke 2:
- H1/H2 + 1-3 nye migrasjoner (019, 020, 021)
- Migrations-tester

**Sannsynlighet:** lav-middels. Skjema har 14 migrations med god
dekning, men end-to-end-test kan avsløre edge-case.

**Beslutning:** starte med H1-scope, iterere til H2 eller H3 hvis
lokal test avslører mer.

---

## 4. Edge-cases (minimum 8)

1. **Cookie-lekkasje mellom familier:** Bruker A logger ut, samme
   browser brukes av B uten cleanup. SW cache kan serve gammel
   data. → [server/sw.js:149](../../public/sw.js#L149) håndterer
   401-eviction; verifiser at den skjer på `GET /api/pantry` etc.

2. **AsyncLocalStorage-lekkasje mellom requests:** Hvis en request
   setter familyId og neste request i samme hendelse-loop ikke
   har kontext, kan `getFamilyId()` fallback til `LEGACY_FAMILY_ID=1`
   og returnere feil families data. → Test at middleware alltid
   wrapper handler i `runWithFamily()`.

3. **Pilot-bypass mismatch:** `PILOT_BYPASS=true` + `AUTH_TOKEN=x`
   i samme deploy. Hva skjer? Per
   [middleware.js:107-119](../../server/auth/middleware.js#L107):
   Bearer-token treffer først, overstyrer PILOT_BYPASS. Men
   `handlePilotLogin` kan fortsatt skape pilot-user. → Verifiser
   at kombinasjonen er eksplisitt forbudt eller veldig tydelig
   dokumentert.

4. **Session-expiry midt i request:** User A sitter på UI. Session
   utløper 00:00. Neste request om 01:00: `getValidSession` returnerer
   null. Middleware faller til legacy-fallback. → User A plutselig
   ser family 1-data uten advarsel. Fix: returnere 401 i stedet for
   legacy-fallback når session finnes men er utløpt.

5. **Concurrent login samme bruker:** User A logger inn fra telefon,
   deretter fra PC. To gyldige sessions. `POST /api/auth/logout-all`
   bør slette begge. → Verifiser i E2E.

6. **Google OAuth med ikke-verifisert e-post:** Claims returnerer
   `email_verified: false`. `handleGoogleCallback:126` throws 403. →
   Men UI viser hva? Error-siden må håndteres.

7. **Invitation-token-collision:** Hvis `randomToken()` gir samme
   token to ganger (ekstremt usannsynlig, 128-bit), vil den første
   invitasjonen overskrives. → Sjekk UNIQUE-constraint i schema
   og fallback-retry.

8. **AUTH_TOKEN + session-cookie samtidig:** User har både Bearer
   og cookie. Per middleware er det "first match wins" — Bearer
   sjekkes først. Hvis Bearer peker til LOCAL_USER og cookie til
   ekte user, får user A feil family. → Klient-side: rydde opp i
   tokens ved login.

9. **Race mellom createFamily og invite:** User A oppretter family,
   inviterer B. B aksepterer før A har satt ferdig profile-members.
   Ingen skade, men error-meldinger kan være forvirrende.

10. **Family-sletting med aktive sessions:** Owner sletter family.
    Andre medlemmer har fortsatt gyldige sessions med
    `user.family_id=<slettet>`. Neste request: `getFamilyId()`
    returnerer ID-en, men `repos.family.findFamilyById()` returnerer
    null. → Må returnere 403 "family deleted" eller tvinge logout.

11. **AUTH_TOKEN-rotation midt i test:** Christer roterer AUTH_TOKEN
    under pågående multi-user-test. Pilot-user-tokens invalideres
    umiddelbart. → Dokumentere i RUNBOOK: ikke roter under pilot-test.

12. **Tenant-isolation i cron-jobs:** Weekly chore-schedule og
    shopping-list-enrichment kjører i cron, ikke i request-kontekst.
    De wrapper seg i `runWithFamily(familyId, ...)` — men hva hvis
    family er slettet mellom cron-tick-start og jobb-fullføring?

---

## 5. Konsekvenser på tvers

- **Frontend:** `public/js/auth.js` og `public/js/family-onboarding.js`
  antar enkelte flows. Må sjekkes at de håndterer logout, session-
  expiry og family-switch korrekt.
- **Service worker:** `public/sw.js` har cache-regler som evicter på
  401. Verifiser med 2+ familier.
- **Cron-jobs:** `server/cron.js` kjører pr familie via
  `runWithFamily`. Må testes at den ikke krasjer hvis en family
  slettes midt i kjøringen.
- **LLM-config:** `server/auth/llm-routes.js` lagrer per-familie
  API-keys. Må verifiseres at family A ikke ser family Bs key.
- **Backup/restore:** Daglig backup dumper hele DB. Restore gir
  begge familier tilbake. OK, men verifiser at database-filer ikke
  lekker på tvers hvis én family eksporterer.
- **Seed + current-week:** `ensureCurrentWeek` seeder meal-plans
  for family 1 ved oppstart. For nye familier må seed trigges ved
  create-family. Sjekk `onboarding-routes.js` — bruker den seed?

---

## 6. PORTAINER-OPPSTARTSRISIKO-SJEKK (DEL 3 Steg 3b)

### 6.1 Rører fixen Dockerfile, docker-compose.yml, docker-entrypoint.sh?

- **Dockerfile:** Nei.
- **docker-compose.yml:** **JA** — nye env-variabler må legges til
  (SESSION_SECRET, MAGIC_LINK_CONSOLE). Kritisk for oppstart.
- **docker-entrypoint.sh:** Nei (eksisterende bootstrap-flyt er OK).

### 6.2 Rører fixen server/http/bootstrap.js eller server/config.js?

- **server/config.js:** **JA** — må validere `SESSION_SECRET` som
  påkrevd i multi-tenant-mode. Potensielt også legge til
  `MAGIC_LINK_CONSOLE` som gyldig flag.

### 6.3 Rører fixen migrasjoner?

- **Potensielt ja** (H3-scenario) hvis skjema-gap avsløres. Starter
  med H1 som har ingen migration.

### 6.4 Kan fixen påvirke hvordan containere starter opp?

- **JA.** Hvis `SESSION_SECRET` mangler og vi setter den som påkrevd
  i config.js-validering, vil Portainer-pull av ny image lede til
  oppstartsfeil. Må håndteres defensivt: default-verdi som advarer
  men starter, eller migrasjon-hjelper som genererer den automatisk
  ved første boot (tilsvarende bootstrap-wizardens AUTH_TOKEN-
  generering).

### 6.5 Konklusjon

**PORTAINER-RISIKO: HØY.** Krever:

- Kontrollerte config-endringer (ikke "må ha" uten fallback)
- Test i Portainer-lignende miljø (Docker compose lokalt) før push
- Smoke-test etter Portainer pull + restart

**Mitigasjon:** Claude bygger i små commits, hver med lokal docker-
compose-test. Første commit-sett skal ikke kunne brekke oppstart —
bare legge til konfig-støtte, ikke kreve den.

---

## 7. ISO 25010-påvirkning

| Karakteristikk | Før | Etter uke 2 | Kommentar |
|---|---|---|---|
| Funksjonell egnethet | 8.7 | 8.8 | Multi-family-funksjon blir ekte-testet |
| Reliability | 8.5 | 8.5 / 8.3 | Kan falle midlertidig hvis bugs oppdages |
| Usability | 8.4 | 8.5 | Login + onboarding brukes for første gang |
| Performance | 8.3 | 8.3 | Ingen endring |
| Security | 8.7 | 9.0 | SESSION_SECRET påkrevd, tenant-isolation ekte-testet |
| Compatibility | 8.2 | 8.2 | Ingen endring |
| Maintainability | 8.9 | 8.9 / 9.0 | Frys-tining øker kodbarhet, dokumentasjon oppdatert |
| Portability | 8.4 | 8.4 | Ingen endring |
| Safety | 8.0 | 8.0 | Ingen ny safety-risk |

Usability-løftet avhenger av at UI-flyten faktisk fungerer første
gang. Hvis bugs oppdages og må fikses, havner vi nær 8.4 på slutten
av uke 2 istedenfor 8.5.

---

## 8. Spørsmål til Christer (må besvares før kode)

### Q1 — Hvilken innloggings-metode for uke 2-test?

- **(a)** `MAGIC_LINK_CONSOLE=true` — tokener i server-logg, LAN-test.
  Anbefales for uke 2, enkelt å rydde bort i uke 3-4 når Resend
  kommer.
- **(b)** Google OAuth med test-prosjekt i Google Cloud Console.
  Krever at du oppretter client-ID + secret og legger til
  `http://<rpi-ip>:7777/api/auth/google/callback` som redirect URI.
  Mer realistisk for prod-flyt.
- **(c)** `PILOT_BYPASS=true` — fungerer kun for én pilot-user,
  ikke egnet for multi-tenant-test.

**ANBEFALING: (a).**

### Q2 — Hvor aggressivt skal frysen tines i CLAUDE.md DEL 6.1?

- **(a)** Full tining: fjern `server/auth/`, `railway.json`,
  deploy.yml fra frys-listen.
- **(b)** Delvis tining: behold `railway.json` og deploy.yml
  (Railway er fortsatt fryst per CLAUDE.md DEL 6), men tin
  `server/auth/`.
- **(c)** Soft tining: endre "frosset" til "krever DEL 5.3-flyt
  (feat/fix med Christer-godkjenning)" for `server/auth/`, la
  Railway-stien være uendret.

**ANBEFALING: (c).** Beholder sikkerhetsnettet men åpner for
nødvendig utvikling.

### Q3 — Skal `SESSION_SECRET` genereres automatisk ved første boot?

- **(a)** Ja — bootstrap.json utvides til å inkludere
  SESSION_SECRET, generert via `crypto.randomBytes(16).toString('hex')`
  hvis mangler. Tilsvarende dagens AUTH_TOKEN-håndtering.
- **(b)** Nei — Christer genererer manuelt med `openssl rand -hex 32`
  og legger i env. Mer transparent, mindre automatikk.

**ANBEFALING: (a).** Konsistent med eksisterende bootstrap-flyt.
Reduserer setup-friksjon.

### Q4 — Hva er mål-tilstanden for uke 2-slutt?

- **(a)** Multi-tenant aktiv lokalt på RPi med 2+ test-familier,
  tenant-isolation empirisk verifisert. B3/B4/B5/B6/B7 utsettes.
- **(b)** + frontend-fikset (PR #59-svar mottatt, fix kjørt)
- **(c)** + B5 gamification `chore_completions`-tabell påbegynt

**ANBEFALING: (a).** B1 er stor nok alene; vi vurderer om B5 kan
påbegynnes mot slutten av uke hvis kapasitet.

### Q5 — Skal vi squash-merge multi-tenant-aktivering som én stor
commit, eller holde 5-10 tematiske commits?

Per CLAUDE.md DEL 5.2.3 er 1-3 meningsfulle commits målet. For
dette kan jeg:

- **(a)** Én commit: "feat(auth): activate multi-tenant mode". Ryddig
  historikk, men PR-diff blir stor.
- **(b)** 2-3 commits: config + frys-tining, test-data, dokumentasjon.
  Mer navigerbar, innenfor DEL 5.2.3-norm.

**ANBEFALING: (b).**

---

## 9. Plan — konkrete commits (per Q-svar)

Forutsetter (a) på Q1, (c) på Q2, (a) på Q3, (a) på Q4, (b) på Q5.

### Commit-rekkefølge

**C1: `feat(auth): add SESSION_SECRET bootstrap + MAGIC_LINK_CONSOLE flag`**
- `server/config.js` — validere SESSION_SECRET med
  fallback til bootstrap.json-generering
- `server/auth/bootstrap-session-secret.js` (ny, liten fil) —
  generer hvis mangler
- `.env.example` — dokumenter nye variabler
- `docker-compose.yml` — videresend env
- Tester: `tests/config-session-secret.test.js` — verifisere
  generering, validering

**C2: `feat(auth): activate multi-tenant session flow`**
- Verifiser eksisterende kode passer (ingen fil-endringer
  forventet utenom potensielle små buggs avslørt ved lokal-test)
- Dokumenter tenant-isolation-test-prosedyre i RUNBOOK

**C3: `docs(claude): thaw server/auth/ from DEL 6.1 freeze (partial)`**
- CLAUDE.md DEL 6.1: endre frys-format til "krever
  feat/ + godkjenning" for `server/auth/`
- CONTEXT.md: oppdater AKTIV OPPGAVE til uke 2-arbeid
- Henvisning til denne analysen som begrunnelse

**Estimerte antall commits:** 3-5 (inkl. evt. bugfix-commits).

**Total anslått tidsbruk:** 1-2 dager for C1-C3 + 1-2 dager for
end-to-end-test-iterasjon + 1 dag for docs. Totalt 4-5 dager.

---

## 10. Status

- **Fase:** Analyse-fullført. **Ingen kode endret ennå.**
- **Branch:** `feat/multi-tenant-activation` (bygget oppå
  `chore/local-first-workflow-setup`, kun lokal).
- **Neste:** Christer svarer på Q1–Q5. Deretter starter C1.
- **Portainer-risiko:** HØY — krever smoke-test på docker-compose
  lokalt før push.
- **Frys-berøring:** JA — vil endre CLAUDE.md DEL 6.1 og tine
  deler av frysen. Selve endringen dokumenteres i C3.
