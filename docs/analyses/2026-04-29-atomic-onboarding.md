# Atomic onboarding — Sprint 3 follow-up Bug 4

**Dato:** 2026-04-29
**Branch:** `hotfix/auth-rate-limit-scope` (samme som PR #77)
**Sprint:** 3 follow-ups (rate-limit + routing + atomic onboarding)
**Bug nr:** 4 av Sprint 3 follow-ups

---

## 1. Bakgrunn og problem

Onboarding-flyten i v2 SPA er splittet på to commits til DB:

1. **Step 1 — FamilySetup** sender `POST /api/onboarding/create-family`.
   Backend `INSERT INTO families` + `UPDATE users SET family_id, role`.
2. **Step 2 — UserProfile** sender `POST /api/auth/onboarding/complete`.
   Backend `UPDATE users SET onboarding_completed = 1`.

Hvis brukeren lukker fanen mellom steg 1 og 2, sitter en zombie-familie i
DB (familie er opprettet, brukeren er knyttet som owner, men
`onboarding_completed = 0`). Ved relogin nektes `create-family` med
`409 "User is already in a family"`. Brukeren kan **aldri** fullføre
onboarding fordi det første POST-et er allerede committet og hindrer det
andre.

Christers manuell-test 2026-04-29 17:18 reproduserte dette presist.

## 2. Reisen ende til ende

### 2A. Happy path (det vi vil oppnå)

```
1. Bruker mottar magic-link, klikker den
   1.1. Backend verifiserer token, oppretter session-cookie
   1.2. Magic-link verify redirecter til /v2/onboarding/family
        (basert på onboarding_completed=0, ikke på family_id=null)
   1.3. SPA mounter, AuthContext kaller /api/auth/me, får user med
        onboardingCompleted=false
   1.4. AuthGuard slipper gjennom (bruker er autentisert)
   1.5. OnboardingGuard er IKKE wrappet rundt onboarding-rutene, så
        FamilySetup rendres
2. Bruker fyller familienavn, trykker "Opprett familien"
   2.1. Frontend lagrer { name } i lokal OnboardingContext-state
   2.2. INGEN API-kall
   2.3. Naviger til /v2/onboarding/profile
3. Bruker fyller navn, rolle, portion-factor, trykker "Fullfør"
   3.1. Frontend henter kombinert state fra OnboardingContext:
        { family: {name}, user: {name, role, portion_factor} }
   3.2. POST /api/auth/onboarding/complete med atomic body
   3.3. Backend kjører transaction:
        - INSERT INTO families
        - UPDATE users SET family_id, name, role, portion_factor,
          onboarding_completed = 1
        - INSERT INTO audit_log (action='onboarding_completed', ...)
        - COMMIT
   3.4. Frontend kaller refreshUser() → /api/auth/me viser
        onboardingCompleted=true + familyId satt
   3.5. Naviger til /v2/dashboard
   3.6. AuthGuard + OnboardingGuard slipper gjennom, AppShell rendres
```

### 2B. Avbruddssti (det bugen handler om)

```
1-2.2. Som over
2.3. Bruker LUKKER FANEN her (etter Step 1 submit, før Step 3)
   2.3.1. INGEN API-kall har skjedd siden /api/auth/me
   2.3.2. Backend-state: user.onboarding_completed=0, family_id=null
   2.3.3. Lokal OnboardingContext-state forsvinner med fanen
3. (senere) Bruker klikker ny magic-link
   3.1. Magic-link verify ser onboarding_completed=0 → redirect til
        /v2/onboarding/family
   3.2. SPA mounter med tom OnboardingContext (default state)
   3.3. FamilySetup rendres med tomt familienavn-felt
4. Bruker fyller familienavn på nytt, går gjennom Step 2
   4.1. Atomic POST lykkes (ingen forhåndsstate i backend)
   4.2. Bruker når dashboard
```

### 2C. "Allerede fullført"-sti

```
1. Bruker logger inn etter onboarding fullført
   1.1. Magic-link verify ser onboarding_completed=1 → redirect til
        /v2/dashboard direkte
   1.2. AuthGuard + OnboardingGuard slipper gjennom
   1.3. Hvis bruker manuelt navigerer til /v2/onboarding/family:
        AuthGuard slipper gjennom (autentisert), men nå må vi avgjøre:
        - skal FamilySetup vise et "ferdig"-state, eller
        - skal vi sende dem videre til /dashboard?
   1.4. ANBEFALT: ingen guard på onboarding-rutene som sender
        completed-brukere bort. Det er en kant-case (manuell URL-
        endring), og en ekstra OnboardingCompleteGuard ville være
        speiling av OnboardingGuard. Hvis bruker manuelt går til
        /onboarding/family etter å ha fullført, lar vi dem stå der
        og fylle inn — men POST vil 409 fordi de allerede har
        familie. Det er forsvarlig. Alternativt kan FamilySetup
        sjekke `user.onboardingCompleted` ved mount og redirecte
        tilbake til dashboard. Det er en liten one-line, men ikke
        påkrevd for bug-fixen. Behandles som scope-utvidelse, ikke
        del av denne PR.
```

## 3. Domenemodell-påvirkning

Ingen ny entitet. Ingen ny migrasjon. Ingen ny forretningsregel
introduseres formelt i `docs/DOMAIN_MODEL.md` (filen er fortsatt tom og
vokser organisk per dens egen instruks). Berørte entiteter:

- **users** (`server/repositories/auth.repo.js`)
  - Eksisterende metoder utvides: `setFamily()` brukes som før, men
    kalles nå atomisk fra ny handler.
  - `setOnboardingCompleted()` brukes som før.
  - Behov for én ny low-level metode: `setProfileFields(userId, {name, role, portionFactor})`
    som UPDATER `name`, `role`, `portion_factor` i samme statement.
    Dette unngår tre separate UPDATE-er i transaksjonen.
  - **VIKTIG OPPDAGELSE under analyse:** kolonnen `portion_factor`
    finnes IKKE på users-tabellen. Sjekket migrasjoner 014-022, ingen
    legger til portion_factor på users. Den finnes på
    `family_profile_members.portion_factor`. Se §4.1 nedenfor for
    konsekvens.

- **families** (`server/repositories/family.repo.js`)
  - `createFamily(name, ownerUserId)` brukes som i dagens
    `handleCreateFamily`. Returnerer ny rad.

- **audit_log** (`server/repositories/system.repo.js` via
  `repos.auditLog`)
  - Ny logg-entry per fullført onboarding. SBOM-6-mønsteret bruker
    `withAudit()`-wrapper. Onboarding er ikke "destruktivt" i klassisk
    forstand, men er en høysynlig én-gangs overgang som bør spores.
    ANBEFALING: bruk audit_log direkte i transaksjonen heller enn
    `withAudit()`-wrapperen, fordi vi vil at logg-entry skal være
    inne i samme transaksjon som familie + user-update. Hvis
    transaksjonen rulles tilbake, skal også audit-loggen gjøre det.

## 3.1 Repos brukt og delte mønstre

- `repos._db.transaction(fn)()` brukes som referanse-mønster i
  `handleTransferOwnership` (server/auth/family-routes.js:364) for å
  pakke flere repo-kall i én atomic transaction. Vi følger samme
  mønster.
- `repos.auth.setFamily(userId, familyId, role, profileMemberId)` —
  finnes, brukes som i dag.
- `repos.family.createFamily(name, ownerUserId)` — finnes, brukes som
  i dag (denne kjører to statements internt: INSERT og UPDATE
  owner_user_id, men begge går mot samme db og inkluderes hvis ytre
  transaction-wrapper er aktiv).

## 4. Edge-cases (minst 8)

1. **Tomt familienavn etter trim** — backend Zod-skjema avviser med 400.
   Frontend OnboardingContext + UserProfile-submit må også avvise før
   POST.
2. **Familienavn > 100 tegn** — Zod max(100), 400.
3. **Tomt brukernavn** — Zod min(1), 400.
4. **Ugyldig rolle** — Zod enum: 'owner' | 'adult' | 'child', 400 ellers.
   Christers spec sier 'owner' | 'adult' | 'child'; eksisterende kode
   støtter også 'teen' (se PortionFactorSlider). Beslutning §6.1.
5. **Ugyldig portion_factor** — backend `addMember`-validering tillater
   0.1-3.0; Christers spec sier 0.2-1.5. Beslutning §6.2.
6. **Bruker har allerede familie** — 409. Inntreffer hvis en gammel
   zombie-familie ligger igjen (cleanup-script i §5 fjerner denne i
   dev-DB) ELLER hvis brukeren har akseptert en invitasjon som "adult"
   uten å gå gjennom onboarding. I siste tilfelle bør de IKKE havne i
   FamilySetup — magic-link-verify-redirecten må sjekke begge
   `family_id` og `onboarding_completed`. Trenger en redirect-fix?
   Beslutning §6.3.
7. **Transaksjon feiler midt i** — vi bruker better-sqlite3 sin
   `db.transaction(fn)()`-wrapper som ruller tilbake automatisk hvis
   `fn` kaster. Etter rollback: 500 til frontend, INGEN data i DB.
   Frontend viser feilmelding og bruker kan re-trykke "Fullfør".
8. **To samtidige fullfør-klikk** — `submitting`-flagg i UserProfile
   blokkerer dobbel-submit fra UI. Backend-handler er ikke idempotent
   (en `INSERT INTO families` med samme navn lager en ny rad), så
   dobbel klick MED samtidig race kunne lage to familier. Mitigering:
   handler sjekker `ctx.user.family_id` før INSERT. Innenfor
   transaksjonen er `family_id`-sjekken og INSERT atomisk; hvis to
   request kommer parallelt, kjører SQLite dem serielt (writer-lock),
   så andre request ser oppdatert family_id og 409-er.
9. **Synthetic LOCAL_USER** — gammelt fallback (PR #77 hotfix) som er
   under utfasing. Handler avviser hvis `ctx.user._synthetic` er
   true, samme som dagens onboarding-handlers.
10. **Magic-link verify redirect** — eksisterende
    `redirectTargetForUser(user)` i `server/auth/magic-link.js` styrer
    første redirect etter login. Logikken må ta høyde for at en bruker
    UTEN family_id og UTEN onboarding_completed = same (begge går til
    /v2/onboarding/family). En bruker MED family_id (akseptert
    invitasjon) men UTEN onboarding_completed: hvor sender vi dem? I
    dagens kodebase: hvis family_id er satt, går de til /v2/dashboard
    (men dashboarden krever onboardingCompleted=true via
    OnboardingGuard, så de bouncer til /v2/onboarding/family hvor de
    400/409-er fordi de allerede har familie). Beslutning §6.3.
11. **CSRF / replay-angrep** — auth-cookien er HttpOnly + SameSite=Lax,
    handler er `POST` med JSON-body, ingen CSRF-token. Dette følger
    eksisterende mønster — alle andre auth-endepunkter er like (per
    PR #77 hotfix-strategi). Ingen ny risiko.
12. **Audit_log-skriv feiler** — hvis `audit_log`-INSERT kaster (DB-
    constraint, full disk osv.), blir hele transaksjonen rullet tilbake
    og brukeren får 500. Bedre enn å committe family + user uten
    audit-spor. Akseptabel oppførsel.

## 4.1 Spesifikt om portion_factor på users

Christers OPPGAVE 3 spec:

```
UPDATE users
  SET family_id = ?,
      name = ?,
      role = ?,
      portion_factor = ?,    ← finnes ikke på users-tabellen
      onboarding_completed = 1
  WHERE id = current_user_id
```

Faktum: Migrasjoner 014-022 legger ikke til `portion_factor` på `users`.
Den lever på `family_profile_members.portion_factor`. Onboarding-bruker
har p.t. ingen `profile_member_id` (det blir lagt til i Sprint 4 ifølge
UserProfile-kommentaren).

**BESLUTNING 4.1A — hvor lagres portion_factor under onboarding?**

ANBEFALING: vi godtar portion_factor i request-body for fremtidig
kompatibilitet, men under Sprint 3-onboarding lagres den IKKE i DB. Vi
oppretter en `family_profile_members`-rad samtidig med familie + user-
oppdatering, og setter `users.profile_member_id = members.id` slik at
slider-verdien faktisk lever et sted. Dette er en utvidelse av Sprint
3-scope, men det er den minste utvidelsen som unngår å silent-droppe
data brukeren akkurat skrev inn.

Alternativ A (forkastet): Lagre portion_factor som en ny kolonne på
`users` via en ny migrasjon. Stor scope-utvidelse, krever SBOM-
oppdatering, øker kompleksitet for et felt som naturlig hører hjemme på
profile_member-raden.

Alternativ B (forkastet): Drop portion_factor fra request-body helt,
lagre kun navn + rolle. Strider mot Christers eksplisitte spec som tar
portion_factor som required.

Alternativ C (forkastet): Aksepter portion_factor i body, ignorer
verdien serverside med en TODO-kommentar. Bryter "ikke skap ny teknisk
gjeld"-regelen i CLAUDE.md DEL 7.7.

KONSEKVENS HVIS ANNERLEDES (alt A): én ekstra migrasjon (023) som
legger `portion_factor REAL` på users. Kan reverseres senere når
profile_member-koblingen lages.

KONSEKVENS HVIS ANNERLEDES (alt B): brukeren skriver inn slider-verdi
som forsvinner. Dårlig UX selv om Sprint 4 gjenoppretter den.

ANBEFALT: opprett en `family_profile_members`-rad for onboarding-
brukeren samtidig — bruker den eksisterende
`repos.family.addMember(familyId, {name, category, portionFactor})`.
Sett `users.profile_member_id` til den nye member-id-en. Da:
- portion_factor ender opp på riktig sted (members-tabellen)
- Sprint 4 finner allerede en member-rad å redigere
- Fullfør-flyten produserer en komplett user + family + member +
  audit_log på ett atomic-trekk

## 5. Konsekvenser på tvers (filer som berøres)

### Backend

- `server/auth/routes.js` — `handleOnboardingComplete` skrives helt
  om: ny Zod-schema, transaksjon, response-shape utvidet med family.
- `server/auth/onboarding-routes.js` — slettes helt.
- `server/repositories/auth.repo.js` — uendret eksternt (eksisterende
  `setFamily` + `setOnboardingCompleted` brukes), kanskje en ny
  `updateProfileBasics(userId, {name, role})` for å samle tre UPDATE
  i én. Avhenger av om vi orker å slå sammen — `updateProfile` finnes
  allerede men setter `name + avatar + google_sub`, ikke `role`.
- `server/repositories/family.repo.js` — uendret. `createFamily()`
  brukes som i dag. `addMember()` brukes for nytt member-row.
- `server/routes.js` — fjern `registerOnboardingRoutes`-importen og
  -registreringen.
- `server/schemas.js` — ny Zod-schema for
  `OnboardingCompleteRequestSchema`.
- `openapi.yaml` — oppdater shape: fjern `/api/onboarding/create-
  family`, oppdater request/response for `/api/auth/onboarding/complete`.

### Backend tester

- `tests/onboarding.test.js` — fjern testene for
  `/api/onboarding/create-family` (4 tester). Tester for static assets
  (`/onboarding.html` osv.) — se §6 beslutning legacy-SPA.
- `tests/auth-onboarding-complete.test.js` — utvid eller skriv om for
  ny atomic body. Eksisterende 3 tester (401, happy path flag-flip,
  idempotent) erstattes av nytt sett som dekker:
  - 401 uten session
  - 401 synthetic LOCAL_USER
  - happy path: family + user + member opprettes, onboarding_completed=1
  - idempotent: andre kall fra samme bruker returnerer 409 (allerede i
    familie)
  - validation: tom familienavn → 400
  - validation: rolle ikke i enum → 400
  - validation: portion_factor utenfor range → 400
  - transaction rollback: simulate audit_log-INSERT-kast → ingen rad i
    families/users/members, response 500
  - audit_log: INSERT skjedde med riktig action='onboarding_completed'

### Backend, andre tester berørt

- `tests/m-week5-performance.test.js` — sjekkes for kall til endrede
  endepunkter.
- `tests/security-multi-tenant-isolation.test.js` — sjekkes.

### Frontend

- `client/src/app/auth/authApi.ts` — `createFamily()` slettes,
  `completeOnboarding()` får utvidet body-type.
- `client/src/app/auth/AuthContext.tsx` — `refreshUser()` uendret.
  Kanskje legge til `resetOnboarding()` for å rydde state ved logout.
- `client/src/app/auth/OnboardingContext.tsx` — NY fil. State-bærer
  for multi-step.
- `client/src/app/screens/auth/FamilySetup.tsx` — fjern API-kall,
  bare lagre i OnboardingContext og naviger.
- `client/src/app/screens/auth/UserProfile.tsx` — kall
  completeOnboarding med kombinert body fra OnboardingContext.
- `client/src/app/App.tsx` — wrap `/onboarding/*`-rutene i
  `OnboardingProvider` slik at FamilySetup + UserProfile deler context.

### Frontend tester

- `client/src/app/auth/AuthContext.test.tsx` — uendret.
- `client/src/app/auth/OnboardingContext.test.tsx` — NY fil.
- `client/src/app/screens/auth/auth-screens.test.tsx`:
  - **FamilySetup** "submit POSTs to /api/onboarding/create-family"-
    test må endres til "submit lagrer i OnboardingContext og navigerer".
  - **UserProfile** "submit POSTs to /api/auth/onboarding/complete"-
    test må utvides til å verifisere at kombinert body med family-name
    sendes.
- `client/src/app/components/auth/OnboardingGuard.test.tsx` — uendret
  (logikken er allerede riktig per PR #77).

### Legacy SPA (separat scope-spørsmål — se §6.4)

- `public/onboarding.html`
- `public/js/family-onboarding.js` — kaller `/api/onboarding/create-family`
- `tests/onboarding.test.js` — har tester for den legacy-flyten

### Cleanup-script (Sprint 3 follow-up)

- `scripts/dev-cleanup-incomplete-onboarding.js` — NY fil.

## 6. Beslutninger (med anbefaling)

### 6.1 Rolle-enum: hvilke verdier?

**ANBEFALING:** Aksepter `'owner' | 'adult' | 'child'` på server-siden,
som Christers spec. Frontend UserProfile har p.t. tre alternativer
`'adult' | 'teen' | 'child'` med fallback til 'adult'.

**HVORFOR:** Bruker som logger inn første gang og fullfører onboarding
selv blir owner uavhengig av hva radioknappen sa, fordi de oppretter
familien. UI-radio-knappens 'adult'/'teen'/'child' brukes som
*member-kategori* (passer til portion_factor-defaults), ikke som
*user-rolle*. Ren konseptuell adskillelse:

- `users.role` (DB) = bruker-permission: 'owner' | 'adult' | 'child'
- `family_profile_members.category` (DB) = porsjon-kategori:
  'adult' | 'teen' | 'child'

Server bruker enum 'owner' | 'adult' | 'child' for `users.role` (alle
lover allerede dette via existing constraint på role-feltet, sjekk
migrasjonsfiler), men member-rad får category fra UI-radio-valget. Hvis
UI sier 'teen' → users.role='adult', members.category='teen'. Hvis UI
sier 'child' → users.role='child', members.category='child'.

For *første* bruker som lager familien settes role='owner'
ubetinget — uavhengig av hva UI sender — fordi de er familiens grunnlegger.

**ALTERNATIV:** Aksepter en 'role' fra UI som bestemmer både users.role
og members.category direkte. Konsekvens: 'teen' har ikke en gyldig
users.role-verdi, så vi måtte enten utvide DB-constraint eller mappe.
Dårligere enn anbefalt.

**KONSEKVENS HVIS ANNERLEDES:** Hvis vi tar role=ui-verdien rett inn,
krever DB-constraint endringer eller silent mapping i koden, begge er
verre.

### 6.2 portion_factor-range

**ANBEFALING:** Aksepter 0.1-3.0 (samsvarer med eksisterende
`addMember`-validering i `server/repositories/family.repo.js:158`).
Christers spec sier 0.2-1.5 men eksisterende kode bruker 0.1-3.0 for
member-rader, og PortionFactorSlider på frontend bruker også et videre
range.

**HVORFOR:** Konsistens med eksisterende repo-validering. Hvis vi
strammer til 0.2-1.5 her men member-tabellen tillater 0.1-3.0, får vi
underlige feil senere når Sprint 4 lar bruker redigere medlemmet.

**ALTERNATIV:** Følg Christers 0.2-1.5. Konsekvens: stramt range,
inkonsistens med rest av kodebasen.

**KONSEKVENS HVIS ANNERLEDES:** Stram validering kan forårsake 400-er
for normale verdier som UI tillater. Dårlig UX.

### 6.3 Magic-link redirect-logikk når family_id finnes men onboarding_completed=0

**ANBEFALING:** Behold dagens redirect-logikk i
`redirectTargetForUser`. Dvs:

- ingen family_id eller onboarding_completed=0 → /v2/onboarding/family
- onboarding_completed=1 → /v2/dashboard

I praksis trigger ikke "family_id satt + onboarding_completed=0"-tilfellet
i Sprint 3 fordi:
- Atomic onboarding-fullfør setter begge i samme transaksjon
- Invitasjons-aksept setter family_id men IKKE onboarding_completed,
  så invitee må fortsatt gjennom UserProfile (uten FamilySetup) på sitt
  første login

For invitasjons-flyten trenger vi at OnboardingGuard sender invitee til
/onboarding/profile (ikke /onboarding/family) når family_id allerede
er satt. Dette er ikke triggered av denne bugen og er en eksisterende
"den-gjeldende" oppførsel som allerede fungerer (eller ikke fungerer —
verifiseres separat). Behandles som scope-utvidelse, ikke del av denne
PR.

**ALTERNATIV:** Endre OnboardingGuard til å route basert på
family_id i tillegg til onboardingCompleted. Skopet utvides — krever
tester for invite-aksept-flyten. Anbefales i en egen PR senere.

**KONSEKVENS HVIS ANNERLEDES:** Hvis vi gjør guard-endring nå, sjanse
for å forstyrre invitasjons-flyten som er testet på annet vis.

### 6.4 Legacy SPA-cleanup — DEN STORE SCOPE-BESLUTNINGEN

`/api/onboarding/create-family` slettes per Christers OPPGAVE 4. Den
eneste klienten i kodebasen er `public/js/family-onboarding.js` (kalt
fra `public/onboarding.html`). Hvis endepunktet slettes uten at klienten
også oppdateres, vil legacy SPA-onboarding feile med 404.

Tre opsjoner:

**A) Slett legacy-onboarding-filer fullstendig**
- `public/onboarding.html` slettes
- `public/js/family-onboarding.js` slettes
- Tester for disse i `tests/onboarding.test.js` slettes
- Eventuelle backend-routes som serverer `/onboarding.html` ryddes

**B) Behold legacy-filer, oppdater til ny endepunkt**
- `public/js/family-onboarding.js` skrives om for å kalle
  `/api/auth/onboarding/complete` med atomic body
- Mer kode å vedlikeholde, men legacy-flyt fortsetter å fungere

**C) Behold legacy-filer som-er, og la dem feile**
- Verken sletting eller oppdatering
- Bruker som havner på legacy-onboarding.html får en knust opplevelse

**ANBEFALING: A — slett legacy-onboarding-filer.**

**HVORFOR:**
1. Per CLAUDE.md DEL 7.12 er `public/*.html` legacy-sider "frosset, blir
   erstattet av v2 før pilot". Onboarding er allerede erstattet av v2
   FamilySetup + UserProfile.
2. Christers OPPGAVE 4e sier "Sjekk at ingen andre steder i kode-basen
   kaller slettede endepunkter" — handling kreves når slik kall finnes.
3. B (oppdatere legacy) er mer arbeid for kode som uansett blir slettet
   før pilot.
4. C er aktivt skadelig — bruker som blir routet til /onboarding.html
   pga. legacy redirect-logikk får en gateløs side.

**ALTERNATIV B-konsekvens:** ekstra ~50 linjer å vedlikeholde, ekstra
tester, mer flate å regressjonsteste. Småkostnad men ikke null.

**ALTERNATIV C-konsekvens:** kjent broken UX-sti. Uakseptabel.

**KONSEKVENS HVIS A:** legacy SPA mister sin onboarding-flyt. Hvilke
ruter sender brukere til `/onboarding.html`? Sjekkes som del av impl:

- Backend `redirectTargetForUser` peker p.t. på `/v2/onboarding/family`
  (per Sprint 3 hotfix), så ingen aktiv pålogging-flyt sender til
  legacy onboarding.
- Bootstrap-flyten: ingen, det er for første-installasjon, ikke
  bruker-onboarding.
- Manuell URL → 404, akseptabelt for legacy som er under sletting.

**STOPP-trigger?** Per CLAUDE.md DEL 6 er ikke `public/*.html` formelt
frosset (kun `server/auth/`, `sentry.js`, og spesifikke tester er på
freeze-listen). Legacy-cleanup faller derfor utenfor frys-rammeverket
og krever ikke separat godkjenning. Imidlertid: scope-utvidelse fra ren
endpoint-omskriving til også sletting av tre filer + tester. Christers
instruks sier "STOPP og rapporter underveis hvis du finner andre
relaterte bugs eller scope-overraskelser."

**Min vurdering:** Dette er en oppdaget scope-konsekvens (ikke en
ny bug), og ANBEFALING A er det rette valget men jeg vil rapportere
det til Christer FØR jeg starter implementasjon, slik at han kan velge
B eller C hvis han har en preferanse jeg ikke ser.

### 6.5 Frosen test-fil — `tests/auth-onboarding-complete.test.js`

Filen matcher `tests/auth-*.test.js`-mønsteret som er på CLAUDE.md DEL
6.1-frys. Christers OPPGAVE 4d sier eksplisitt "Slett relaterte tester
for slettede endepunkter".

Gammel oppførsel (idempotent flag-flip) erstattes med ny oppførsel
(atomic family-create + user-update + member-create + audit-log).
Test-filen trenger derfor ny innhold, ikke bare diff.

**ANBEFALING:** behandle Christers OPPGAVE 4d-instruks som den
"eksplisitte godkjenning" som DEL 6.5 krever for å oppdatere en
kode-test. Skriv om filen helt; behold filnavnet (`auth-onboarding-
complete.test.js`) siden URL-en er den samme.

Behandles ikke som STOPP-trigger fordi instruksjonen er eksplisitt og
analysen (denne fil) tjener som "full DEL 3-analyse"-kravet.

## 7. Portainer-oppstartsrisiko-sjekk

| Berører | Ja/Nei |
|---|---|
| `Dockerfile` eller `.dockerignore` | Nei |
| `docker-compose.yml` | Nei |
| `server/http/bootstrap.js` | Nei |
| `server/config.js` oppstartsvalidering | Nei |
| `server/index.js` startup-sekvens | Nei |
| `server/db.js` eller `server/migrations/**` | Nei |
| `install.sh` | Nei |
| `bootstrap.json`-lesning eller -skriving | Nei |
| Miljøvariabel-krav for oppstart | Nei |

**Konklusjon:** Ingen Portainer-risiko. Endring berører kun runtime-
endepunkter, frontend-kode, og tester. Ingen ny migrasjon (cleanup-
script er manuelt-kjørt for dev-DB, ikke del av oppstart). Ingen
DEL 3 Steg 3b-prosedyre.

## 8. ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Δ |
|---|---|---|---|
| Functional Suitability | 8.7 | 8.8 | +0.1 (zombie-familie-bug fjernet, atomic invariant) |
| Reliability | 8.5 | 8.6 | +0.1 (transaksjonell integritet) |
| Maintainability | 8.4 | 8.4 | 0 (færre endepunkter, men mer logikk i én handler) |
| Security | 8.2 | 8.2 | Ikke berørt |
| Performance | 8.5 | 8.5 | Ikke berørt (én POST i stedet for to, men kostnaden var aldri kritisk) |
| Usability | 8.6 | 8.7 | +0.1 (ingen stranded brukere etter avbrudd) |

Ingen karakteristikk trekkes under 8.0.

## 9. Plan (commits i rekkefølge)

1. `docs(analysis): add atomic onboarding analysis` — denne fila.
2. `chore(db): add cleanup script for incomplete onboarding records`
   — `scripts/dev-cleanup-incomplete-onboarding.js`.
3. `feat(api): add Zod schema for atomic onboarding-complete request`
   — utvide `server/schemas.js`.
4. `refactor(api/onboarding): rewrite /api/auth/onboarding/complete to
   create family + user + member atomically` — `server/auth/routes.js`.
5. `chore(api/onboarding): drop POST /api/onboarding/create-family and
   its routes module` — slett `server/auth/onboarding-routes.js`,
   fjern registrering i `server/routes.js`.
6. `chore(legacy): remove legacy SPA onboarding wizard` — slett
   `public/onboarding.html`, `public/js/family-onboarding.js`. Eventuell
   backend-rute som serverer `/onboarding.html` (sjekkes under impl).
7. `test(api/onboarding): replace endpoint tests with atomic-flow
   coverage` — skriv om `tests/auth-onboarding-complete.test.js`,
   slett create-family-tester i `tests/onboarding.test.js` eller hele
   filen avhengig av legacy-cleanup-omfang.
8. `feat(client/onboarding): introduce OnboardingContext for multi-
   step state collection` — `client/src/app/auth/OnboardingContext.tsx`
   + test-fil.
9. `refactor(client/onboarding): FamilySetup writes to context, not
   API` — `FamilySetup.tsx`.
10. `refactor(client/onboarding): UserProfile submits combined state
    via single endpoint` — `UserProfile.tsx`, `authApi.ts`.
11. `chore(api): update openapi.yaml for atomic endpoint` — schema-
    diff.

Etter denne PRs merger: KODE-ROMMET er rent, en atomic onboarding-flyt
finnes, ingen zombie-familier kan skapes.

## 10. Kompleksitet-vurdering

Christer angir i OPPGAVE-listen at dette er en "fix" (sprint-3 follow-up
bug 4), men scope-en er substansiell:

- 1 ny endpoint, 1 slettet endpoint, 1 oppdatert endpoint
- ~10 filer på backend (kode + tester)
- ~5 filer på frontend (ny context, refactor av to skjermer, test-
  oppdateringer)
- 2-3 legacy-filer som slettes
- 1 cleanup-script
- ~30 nye/oppdaterte tester

Dette er en **medium feat/refactor** maskert som hotfix. Diff-størrelse
estimert til 800-1200 linjer netto, fordelt på ~10-12 commits. Ikke
"liten" per CLAUDE.md DEL 11. Full analyse (denne fil) er obligatorisk,
ingen snarveier.

---

**Status:** ANALYSE FERDIG. Christer-bekreftelser mottatt 2026-04-29.

## 12. Christer-bekreftelser (2026-04-29)

- **B1 (legacy cleanup):** Anbefaling A bekreftet — slett
  `public/onboarding.html` og `public/js/family-onboarding.js`. Hvis
  jeg finner uventede kallsteder for legacy-flyten under impl,
  flagge og spørre.

- **B2 (atomic transaction):** Bekreftet — opprett
  `family_profile_members`-rad i samme transaksjon som
  family + user-update + audit-log.

- **B3 (portion_factor-range):** Christer overstyrer eksisterende
  0.1-3.0 og setter ny tak på 2.0. Realistisk per-person-grense
  med margin (storspisere når 1.3-1.8, sjelden over 2.0). Legger
  til ny migrasjon **023** som:
  - `ALTER TABLE users ADD COLUMN portion_factor REAL NOT NULL
    DEFAULT 1.0 CHECK (portion_factor BETWEEN 0.1 AND 2.0)` —
    kolonnen finnes ikke fra før, så ikke pre-flight-check
    nødvendig på users.
  - Rebuild av `family_profile_members` med ny CHECK-constraint
    0.1-2.0 (SQLite støtter ikke ALTER på eksisterende CHECK).
  - **Pre-flight verifisert mot dev-DB:**
    `SELECT COUNT(*) FROM family_profile_members WHERE portion_factor > 2.0;`
    → 0 rader. Trygt å migrere uten datatap.
  - Zod-validering: `z.number().min(0.1).max(2.0)`.
  - Frontend slider: `MAX_PORTION` fra 1.5 → 2.0; tick-verdier
    utvides til 19 stop (0.2-2.0 i 0.1-steg); skala-label "1.5"
    → "2.0"; `MIDPOINT_LABEL_LEFT_PCT` rekompileres fra 61.54% →
    44.44% for nytt skalaområde.
  - `family.repo.js` validering 0.1-3.0 → 0.1-2.0 i `addMember` og
    `updateMember`.
  - Sliderens lockede design-beslutning (Beslutning 2 i
    `locked-decisions.md`) er ikke direkte i konflikt — defaultene
    barn 0.4 / ungdom 0.7 / voksen 1.0 forblir uendret. Range-
    utvidelsen til 2.0 er ren utvidelse oppover; defaults og
    label-band (barn 0.2-0.5, ungdom 0.6-0.8, voksen 0.9+) er ikke
    påvirket. Oppdatering av locked-decisions.md ikke nødvendig
    (range er ikke pinnet eksplisitt i den).

- **B4 (rolle-enum-separasjon):** Bekreftet — `users.role`
  (auth-rolle, settes til 'owner' for første-bruker) og
  `family_profile_members.category` (porsjon-kategori, kommer fra
  UI-radio) er semantisk separate.

## 13. Cleanup-script — observert dev-DB-state (2026-04-29)

Pre-cleanup-snapshot:
- `users` (1 rad): id=1 christer@frestad.com, family_id=2,
  role=owner, onboarding_completed=0, profile_member_id=null →
  zombie-bruker fra Christers manuell-test 17:18.
- `families` (2 rader):
  - id=1 'Default Family' — legacy seed-rad fra migrasjon 014:122,
    BEHOLDES (anker for migrerte single-tenant-data).
  - id=2 'Frestad' — opprettet i Christers manuell-test, owner_user_id=1,
    SLETTES av cleanup.
- `family_profile_members` (0 rader): tom tabell, ingen rensk å gjøre.

Cleanup-script kriterier:
- Slett `families.id != 1` HVOR alle linkede users er
  `onboarding_completed=0` ELLER ingen users er linket
- `family_id=1` (Default Family) ekskluderes alltid (legacy data-anker)
- Brukere som mister familie får `family_id` SET NULL (FK-cascade) +
  rolle nullstilles til 'adult' for konsistens

Forventet etter cleanup på dagens dev-DB:
- families: 1 rad (Default Family beholdes)
- users: christer@frestad.com med family_id=null, role='adult',
  onboarding_completed=0 → ved relogin starter han på FamilySetup
  som om det var første gang, akkurat som tiltenkt.
