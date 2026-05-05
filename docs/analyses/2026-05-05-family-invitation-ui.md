# ANALYSE — Familie-invitasjon UI (PR #119, Sprint 9)

**Slug:** `2026-05-05-family-invitation-ui`
**Branch:** `feat/family-invitation-ui`
**Trigger:** Christer's Sprint 9 re-scoping (kvalitet over MVP, pre-pilot
soft-launch til fokusgruppe). Bygger ovenpå PR #109 (invitasjon-backend
m/`invited_email`-kolonne) og leverer hele bruker-vendt invitasjon-flyt.

---

## 1. Reisen

### 1.A — Eier inviterer ny voksen til familie

1. Eier åpner `/v2/family`
   1.1. Existing layout: header + medlemskort. Ny seksjon
        "Pending invitasjoner" tegnes hvis `listInvitations()` returnerer
        rader.
   1.2. "Inviter medlem"-knappen erstatter `showPlaceholder('invite')`
        med å åpne `<InviteMemberModal open={true} />`.
2. Eier fyller inn modal
   2.1. Email (required)
        2.1.1. Klient-side validering: regex-match. Disabled-submit hvis
               tom eller ugyldig.
        2.1.2. Lokal låsing — submit-knapp viser spinner under fetch.
   2.2. Rolle (radio: Voksen/Foreldre — to-valg som matcher backend
        `assigned_role: 'adult' | 'child'`. Pilot-scope: barn-rolle
        deaktiveres med pilot-melding "Subaccounts kommer i Sprint 10",
        ELLER vi støtter `'adult'` only). **Beslutning B5 nedenfor.**
   2.3. Personlig melding (textarea, max 500 tegn, optional)
        2.3.1. Tegn-teller live (`{count}/500`).
        2.3.2. Ved >500 tegn: rødt counter, submit disabled.
3. Eier trykker Send
   3.1. POST `/api/family/invitations` med `{email, role, invitationMessage,
        locale: i18n.language}`.
   3.2. Server pre-validerer:
        3.2.1. Email allerede medlem av familie → 409 EMAIL_ALREADY_MEMBER.
        3.2.2. Email allerede pending invitasjon → 409 EMAIL_ALREADY_INVITED.
        3.2.3. Begge sjekker er familie-scoped (cross-tenant: invitasjon i
               annen familie blokkerer IKKE).
   3.3. Hvis OK: row insertes, token genereres, email sendes via Resend
        (best-effort — feil i email-send blokkerer ikke 201-respons).
   3.4. Frontend lukker modal, viser inline-status "Invitasjon sendt
        til {email}", refresh PendingInvitationsList.
4. Eier ser pending invitasjoner
   4.1. Tabell: email | sendt | utløper | actions.
   4.2. "Send på nytt" → confirm dialog → POST `/.../resend` → toast.
   4.3. "Trekk tilbake" → confirm dialog → DELETE → toast + listen
        oppdateres.

### 1.B — Mottaker aksepterer invitasjon

1. Mottaker åpner email
   1.1. Email rendres i mottakers locale (lagret på invitasjon-row).
   1.2. CTA-knapp peker til `${APP_URL}/v2/invite/{token}`.
2. Klikk på lenke
   2.1. Browser navigerer til `/v2/invite/{token}` (PUBLIC route).
   2.2. PilotGuard er aktivt — hvis pilot-mode, må mottaker først passere
        pilot-password-gate. Pilot-cookie persisterer 30 dager (eksisterende).
   2.3. `InviteAccept`-komponent monteres og fetcher `GET
        /api/invitations/{token}` (anonym peek-endpoint).
3. State machine (5 states):
   - **STATE 1 — LOADING:** Spinner mens peek pågår (min 500 ms for å
     unngå flash).
   - **STATE 2 — VALID + IKKE LOGGET INN:** Vis inviter + familie. CTA:
     "Logg inn for å akseptere" → `/v2/login?redirect=/v2/invite/{token}`.
   - **STATE 3 — VALID + LOGGET INN MED MATCHENDE EMAIL:** Vis inviter +
     familie. CTA: "Aksepter". POST `/.../accept` → redirect `/v2/family`.
   - **STATE 4 — VALID + LOGGET INN MED FEIL EMAIL:** Vis warning. CTA:
     "Logg ut" → POST logout → redirect login med redirect-param.
   - **STATE 5 — ERROR:** 404 (not found) | 410 (expired) | 409
     (already used) | 500 (generisk).

### 1.C — Eier sender invitasjon på nytt (resend)

1. Eier ser pending invitasjon i listen.
2. Klikker "Send på nytt".
3. Confirm dialog: "Send invitasjon til {email} på nytt?"
4. POST `/api/family/invitations/{id}/resend`.
   4.1. Server validerer: invitasjon må være pending (ikke accepted/revoked).
   4.2. Server validerer: invitasjon må tilhøre eierens family (DEL 14).
   4.3. Genererer ny token, oppdaterer expires_at (=now + 7 dager),
        sender email på nytt med samme melding + locale.
5. Toast: "Invitasjon sendt på nytt".

---

## 2. Domenemodell-påvirkning

### 2.A — Tabeller / migrasjoner

- `server/migrations/029_invitation_message_locale.sql` (ny)
  - `ALTER TABLE family_invitations ADD COLUMN invitation_message TEXT`
  - `ALTER TABLE family_invitations ADD COLUMN locale TEXT NOT NULL
    DEFAULT 'no' CHECK (locale IN ('no','en'))`
  - Begge nullable/default → backwards compatible med
    `findInvitationByToken`-rader fra migrasjon 014/028.

### 2.B — Repositories

- `server/repositories/family.repo.js`
  - `createInvitation()` aksepterer `invitationMessage`, `locale`.
  - `findInvitationByToken()` returnerer `invitation_message`, `locale`.
  - Ny: `findActiveInvitationForEmail(familyId, email)` for
    pre-validering.
  - Ny: `resendInvitation(familyId, invitationId, newToken)` —
    `UPDATE family_invitations SET token = ?, expires_at = ?, ...
    WHERE id = ? AND family_id = ? AND accepted_at IS NULL AND
    revoked_at IS NULL`.

### 2.C — Routes

- `server/auth/family-routes.js` (server/auth/ er soft-thaw — DEL 6.1b)
  - `handleCreateInvitation`: validerer message + locale, gjør
    pre-validering, returnerer 409 med error-code.
  - `handlePeekInvitation`: returnerer message i response.
  - Ny: `handleResendInvitation`.
  - Ny route: `POST /api/family/invitations/:id/resend`.

### 2.D — Email service

- `server/services/email.service.js`
  - Ny: `sendInvitationEmail({ to, url, familyName, inviterName,
    invitationMessage, expiresInDays, locale })`.
  - Bruker template-filer fra `server/email/templates/` som lastes
    synkront ved modul-init.
  - 4 nye template-filer: `invitation-no.html`, `invitation-no.txt`,
    `invitation-en.html`, `invitation-en.txt`.
  - Subject genereres fra template (header-linje), body fra resten.

### 2.E — Frontend

- Ny: `client/src/app/family/familyInvitationsApi.ts` — typed klient.
- Ny: `client/src/app/screens/family/InviteMemberModal.tsx`.
- Ny: `client/src/app/screens/family/PendingInvitationsList.tsx`.
- Ny: `client/src/app/screens/InviteAccept.tsx`.
- Endret: `client/src/app/screens/Family.tsx` — bytte placeholder mot
  ekte modal og pending-liste.
- Endret: `client/src/app/App.tsx` — ny PUBLIC route
  `/invite/:token`.
- Endret: `client/src/app/i18n/locales/{no,en}/family.json` — nye
  keys under `invitations.*`.

### 2.F — DOMAIN_MODEL.md

Domenet utvides med:
- `family_invitations.invitation_message` (TEXT, max 500 tegn)
- `family_invitations.locale` (CHECK constraint)
- BR (forretningsregel): pre-validering ved opprettelse —
  `invited_email` må ikke kollidere med eksisterende family-medlem
  eller eksisterende pending invitasjon.
- BR: resend genererer nytt token (gammel blir invalidated). Locale
  og message arves fra original invitasjon.

Dette dokumenteres i `docs/DOMAIN_MODEL.md` ifm. PR.

---

## 3. Edge-cases (≥8 obligatorisk)

1. **Email allerede medlem av samme familie:** 409 EMAIL_ALREADY_MEMBER.
   Frontend viser feil under email-felt: "Denne e-posten er allerede
   medlem av familien".
2. **Email allerede pending invitasjon i samme familie:** 409
   EMAIL_ALREADY_INVITED. Frontend viser: "Denne e-posten er allerede
   invitert".
3. **Email allerede medlem av en ANNEN familie:** Tillatt (cross-tenant
   pre-validering). Bruker må manuelt forlate annen familie ved accept
   (eksisterende `handleAcceptInvitation` returnerer 409 da).
4. **Personlig melding > 500 tegn:** Submit-knapp disabled, lokalt
   counter rødt. Backend dobbel-validerer: returnerer 400 hvis
   submit smyg seg gjennom.
5. **Resend på accepted invitasjon:** Returnerer 409 — invitasjon
   må være pending. UI bør ikke vise resend-knapp på accepted, men
   sikre backend-grenser uansett.
6. **Resend på revoked invitasjon:** Returnerer 409.
7. **Resend på utløpt invitasjon:** Forretningsbeslutning —
   anbefaling: tillat resend (gjenoppliv med ny expires_at). Brukerens
   forventning er "bruk samme invitasjons-record igjen".
8. **Cross-family resend-forsøk:** Family A's eier prøver å resende
   family B's invitasjon. Returnerer 404 (DEL 14 isolation —
   `WHERE family_id = ?` i UPDATE).
9. **Mottaker klikker invitasjon-link mens logget inn med FEIL email:**
   STATE 4. Logout-knappen bruker eksisterende
   `POST /api/auth/logout`-endpoint, redirecter til
   `/v2/login?redirect=/v2/invite/{token}` — magic-link-flyt
   bevarer redirect.
10. **Mottaker klikker invitasjon to ganger raskt:** Første aksept
    lykkes, andre returnerer 409. UI viser STATE 5 errorAlreadyUsed.
11. **Email-send feiler (Resend nede):** Best-effort log,
    invitasjons-rad eksisterer. Eier ser invitasjon i pending-liste
    og kan kopiere URL manuelt eller resend etter Resend kommer
    tilbake.
12. **Locale ikke gyldig (klient sender 'fr'):** Backend Zod-validerer
    mot enum `['no','en']`, default 'no' hvis ugyldig.
13. **Invitasjons-token forsøkt brukt etter resend:** Gammel token
    invalidert av UPDATE — `findInvitationByToken(oldToken)` returnerer
    null → STATE 5 errorNotFound.
14. **Pilot-mode mottaker uten pilot-cookie:** PilotGuard fanger,
    viser pilot-password-side først. Når passord OK, redirect tilbake
    til `/v2/invite/{token}`.

---

## 4. Konsekvenser på tvers

- **Frontend (`client/src/app/`):**
  - Ny screen `InviteAccept.tsx` + screens-dir
  - Ny modal `InviteMemberModal.tsx`
  - Ny liste `PendingInvitationsList.tsx`
  - Ny API-modul `familyInvitationsApi.ts`
  - Endret `App.tsx` (ny route)
  - Endret `Family.tsx` (modal-integrering + pending-liste)
  - Endret `i18n/locales/{no,en}/family.json` (invitasjons-strings)
- **API-endepunkter (`server/auth/family-routes.js`):**
  - Endret `POST /api/family/invitations` (message + locale + pre-val)
  - Endret `GET /api/invitations/:token` (returnerer message + locale)
  - Ny `POST /api/family/invitations/:id/resend`
- **Database-migrasjoner:** `029_invitation_message_locale.sql`.
- **OpenAPI:** Oppdater `openapi.yaml` for nye request/response-felter
  og resend-endpoint.
- **Tester:**
  - `tests/family-invitation-message.test.js` (ny)
  - `tests/family-invitation-resend.test.js` (ny)
  - `tests/family-invitation-prevalidation.test.js` (ny)
  - `tests/email-invitation-locale.test.js` (ny)
  - Utvide `tests/family-invitation-extension.test.js` med DEL
    14-assertions for nye endpoints.
  - `client/src/app/family/familyInvitationsApi.test.ts` (ny)
  - `client/src/app/screens/family/InviteMemberModal.test.tsx` (ny)
  - `client/src/app/screens/family/PendingInvitationsList.test.tsx` (ny)
  - `client/src/app/screens/InviteAccept.test.tsx` (ny)
- **DOMAIN_MODEL.md:** Forretningsregler for invitasjon utvides
  (BR-INVITE-1 pre-validering, BR-INVITE-2 resend invaliderer gammel
  token, BR-INVITE-3 locale + message persistens).

---

## 5. Beslutninger (med anbefaling)

### B1 — Hvor lagres locale for email-rendering?

**ANBEFALING:** Ny `locale` TEXT-kolonne på `family_invitations` med
CHECK-constraint (`'no' | 'en'`), default `'no'`. Frontend sender
`i18n.language` ved create. Locale arves ved resend.

**HVORFOR:** Locale må persistere mellom create og send + resend.
Brukers preferred-language er ikke lagret på `users`-tabellen — å
legge det til ville være out-of-scope for denne PR-en. Inviterens
nåværende språk er en god default.

**ALTERNATIVER:**
- Detect locale fra inviters `Accept-Language`-header på server. Konsekvens:
  hver request gir potensielt forskjellig locale, vanskelig å resende
  konsistent. Ikke deterministisk.
- Ny `users.preferred_language`-kolonne. Konsekvens: schema-endring
  som ikke trengs for invitasjon, drifter ut-av-scope.
- Hardkode 'no' for pilot. Konsekvens: bryter Christer's eksplisitte
  i18n-krav og blokkerer engelsk fokusgruppe.

**KONSEKVENS HVIS ANNERLEDES:** Resend kan sende email i feil språk, eller
i18n-coverage er ikke komplett.

### B2 — Hvordan formidles 409-error fra pre-validering til UI?

**ANBEFALING:** Backend returnerer 409 med JSON
`{ title: 'Conflict', detail: <human msg>, code:
'EMAIL_ALREADY_MEMBER' | 'EMAIL_ALREADY_INVITED' }`. Frontend
sjekker `code` for å velge riktig i18n-key.

**HVORFOR:** Maskinlesbar `code` lar UI velge riktig i18n-key uten
streng-matching. Følger eksisterende
`server/http/errors.js`-konvensjoner (utvides med ny `errors.conflict()`-overload).

**ALTERNATIVER:**
- Bare `detail`-streng på engelsk → UI parser. Konsekvens: skjør,
  i18n-coverage degraderes.
- Forskjellige HTTP-status-koder per case (409 vs 422). Konsekvens:
  bryter REST-konvensjon; 409 er riktig for begge.

**KONSEKVENS HVIS ANNERLEDES:** Frontend må streng-matche eller vise
generisk feilmelding, dårligere UX.

### B3 — Resend genererer ny token vs beholder gammel?

**ANBEFALING:** Generer ny token. Gammel invalidieres av UPDATE.

**HVORFOR:** Standard SaaS-pattern. Hvis gammel email lekker eller
mottaker melder "invitasjon er kompromittert", kan eier resende for
å rotere token. Eldre email-klient som klikker gammel link får
STATE 5 errorNotFound — rent og forventet.

**ALTERNATIVER:**
- Behold token, oppdater bare expires_at. Konsekvens: enklere logikk,
  men ingen rotasjon ved kompromiss. Mottaker som har slettet email
  kan fortsatt aksepteres med gammel link selv om eier "trakk tilbake
  og resendte". Forvirrende.
- Revoke gammel + opprett ny rad. Konsekvens: pending-listen blåses
  opp med "ghost"-rader.

**KONSEKVENS HVIS ANNERLEDES:** Mindre robust mot kompromiss; men
funksjonelt nesten likt.

### B4 — Skal `/v2/invite/:token` være en PUBLIC eller PROTECTED route?

**ANBEFALING:** PUBLIC (utenfor AuthGuard, men inni PilotGuard).
Komponenten håndterer logged-in-state internt for STATE 3 vs STATE 2.

**HVORFOR:** Mottaker er per definisjon ikke logget inn første gang.
PilotGuard er fortsatt på fordi pilot-mode = "alt bak passord". Logged-in
sjekk gjøres internt i InviteAccept via `useAuthContext()` —
samme `useAuthContext` returnerer `null` for anonym, brukerobjekt
ellers, slik at samme komponent kan vise begge STATE 2 og STATE 3.

**ALTERNATIVER:**
- PROTECTED. Konsekvens: AuthGuard tvinger login før peek — bruker
  ser ikke hvem som inviterer før de logger inn. Dårligere konvertering.
- Helt utenfor PilotGuard. Konsekvens: omgår pilot-password-gate.
  Bryter pilot-konseptet.

**KONSEKVENS HVIS ANNERLEDES:** Dårligere UX eller bruddet pilot-isolasjon.

### B5 — Skal "Foreldre"-rollen tilbys i InviteMemberModal?

**ANBEFALING:** Tilby kun "Voksen" (assigned_role='adult') i pilot-scope.
Skjul barn-rolle helt (Sprint 10 subaccounts har egen flow). Skjul
også eier-rolle (transfer-ownership er separat handling).

**HVORFOR:** Backend støtter `'adult' | 'child'` allerede. Children
i invitasjons-flow innebærer email-konto, men barn forventes ikke å
ha egen email i pilot-scope (subaccounts via PIN i Sprint 10). Å
tilby barn-rolle i UI nå skaper forvirring og dead-end. "Foreldre"
er IKKE en backend-rolle — `'owner'` er det, og overføres via
transfer-ownership, ikke invitasjon.

**ALTERNATIVER:**
- Tilby "Voksen" + "Foreldre" som radio (mapper begge til 'adult').
  Konsekvens: forvirrende — to valg som gjør samme ting.
- Tilby "Voksen" + "Barn". Konsekvens: barn får invitasjon-email,
  men flow-en er ikke designet for det. Bryter Sprint 10-design.

**KONSEKVENS HVIS ANNERLEDES:** Forvirrende UI eller post-pilot tech-debt
fjerning av ubrukt valg.

Christer's Sprint 9-prompt nevner "Voksen/Foreldre" i radio. Tolker
det som "to-valg som signaliserer roller — men begge mapper til
adult i backend". **Velger likevel én radio-knapp 'Voksen' (default)
+ skjult role='adult' verdi**, og logger Foreldre-skill som
post-pilot Sprint 11 (granulære permissions). Hvis Christer vil ha
to-valg, kan vi legge det til, men det blir kosmetisk.

### B6 — Skal vi bygge global Toast-komponent eller bruke inline aria-live?

**ANBEFALING:** Inline `role="status" aria-live="polite"` i hver kontekst
(modal, pending-liste). Ingen global toast.

**HVORFOR:** Eksisterende kodebase bruker inline aria-live (se
`Family.tsx`, `Settings.tsx`). En global Toast krever portal +
queue + animasjon — for stor scope for denne PR-en. Inline status
er tilstrekkelig for én modal og én liste.

**ALTERNATIVER:**
- Bygg global Toast-system. Konsekvens: scope-blowup.
- Native browser `alert()`. Konsekvens: dårlig UX.

**KONSEKVENS HVIS ANNERLEDES:** Større PR, lengre review.

---

## 6. Portainer-oppstartsrisiko-sjekk

- `Dockerfile` eller `.dockerignore`: **NEI** (frontend bygges
  allerede inn).
- `docker-compose.yml`: **NEI**.
- `server/http/bootstrap.js`: **NEI**.
- `server/config.js` oppstartsvalidering: **NEI** — locale leses fra
  request-body, ingen ny env-var.
- `server/index.js` startup-sekvens: **NEI**.
- `server/db.js` eller `server/migrations/**`: **JA** — ny migrasjon
  `029_invitation_message_locale.sql`. Migrasjons-runneren håndterer
  ALTER TABLE inkrementelt; eksisterende prod-DB får begge kolonner
  med default-verdier (NULL message, 'no' locale).
- `install.sh`: **NEI**.
- `bootstrap.json`-lesning eller -skriving: **NEI**.
- Miljøvariabel-krav for oppstart: **NEI** — `RESEND_*` er allerede
  optional.

**Migrasjonen er additiv (ALTER TABLE ADD COLUMN), kjøres i
transaksjon, idempotent.** Eksisterende rader får default-verdier.
Lav risiko, men utløser teknisk PORTAINER-RISIKO-prosedyre fordi
migrasjons-mappen røres. Per DEL 3 Steg 3b legger jeg til
oppstartstest:

- `tests/migration-029-roundtrip.test.js`: før/etter-migrasjon
  verifiserer at `family_invitations` har de nye kolonnene.

Rollback-strategi: SQLite ALTER TABLE DROP COLUMN ikke supportert
før 3.35. Hvis rollback trengs, manual revert via temp-table-dans.
Rolling forward er foretrukket — nye rader får default 'no'/NULL,
intet i produksjon brytes. Christer-godkjenning nødvendig per DEL
3 Steg 3b.

---

## 7. ISO 25010-påvirkning

| Karakteristikk | Før | Etter | Begrunnelse |
|---|---|---|---|
| Funksjonell egnethet | 8.7 | 8.8 | +0.1 — ny ende-til-ende invitasjons-flyt med kvalitet (resend, pre-val, message) |
| Brukbarhet | 8.5 | 8.7 | +0.2 — UX-polish: 5-state accept, pre-validering, personlig melding, NO+EN |
| Vedlikeholdbarhet | 8.3 | 8.3 | uendret — ny kode følger eksisterende patterns; ingen tech-debt akkumulert |
| Pålitelighet | 8.5 | 8.5 | uendret — best-effort email, transaksjonell DB |
| Sikkerhet | 8.2 | 8.3 | +0.1 — DEL 14 cross-tenant tester for nye endpoints, ny token ved resend |
| Ytelse | 8.4 | 8.4 | uendret — ingen N+1, prepared statements, ny indeks ikke nødvendig (eksisterende `idx_invitations_email`) |
| Kompatibilitet | 8.6 | 8.6 | uendret — additiv migrasjon |
| Portabilitet | 8.7 | 8.7 | uendret |

ISO-snitt før: 8.49. Etter: 8.53. Innenfor mål (~8.55) og ingen
karakteristikk trekkes under 8.0.

---

## 8. Plan (commits i rekkefølge)

1. `docs(analysis): add analysis for family-invitation-ui`
2. `chore(migrations): add 029_invitation_message_locale.sql`
3. `feat(repos): add invitation_message + locale + resend + prevalidation helpers`
4. `feat(email): add sendInvitationEmail with NO/EN templates`
5. `feat(routes): wire pre-validation, message, resend on family-routes`
6. `test(invitation): backend coverage for message, resend, prevalidation, locale`
7. `feat(client/api): add familyInvitationsApi`
8. `feat(client/family): add InviteMemberModal + PendingInvitationsList`
9. `feat(client/invite): add InviteAccept screen with 5-state machine`
10. `feat(client/family): integrate modal + pending list into Family screen, add /invite/:token route`
11. `feat(i18n): add NO/EN invitation strings`
12. `test(client): cover invitation UI (modal, list, accept)`
13. `docs(openapi): document invitation endpoints + new fields`
14. `docs(domain): update DOMAIN_MODEL with BR-INVITE-1/-2/-3`
15. `docs(roadmap): update post-pilot-roadmap with PR #119 scope`

Hver commit er testet og selvstendig grønn lokalt.

---

## 9. Kompleksitet-vurdering

**Estimat:** STOR oppgave. Christer har eksplisitt valgt kvalitet over
hastighet. Analysen bekrefter:
- 14 edge-cases (over minimum 8)
- 6 beslutninger med anbefaling
- ~10 nye filer + 6 endrede filer
- Backend + frontend + DB + i18n
- DEL 14 multi-tenant + DEL 6.1b soft-thaw + DEL 3 Steg 3b Portainer-risiko

Kompleksitet matcher Christer's signal: "Pre-pilot fase 1 — full kvalitet".
Ingen scope-snarveier.

---

## 10. Avhengigheter og frys-status

- **DEL 6.1b (server/auth/ soft-thaw):** Ja, `server/auth/family-routes.js`
  endres. Krever DEL 5.3 flow → branch `feat/`, Christer-godkjenning
  per PR. Christer har eksplisitt re-scopet og pre-godkjent (Q5
  i Sprint 9-prompten: "IKKE NØDVENDIG (verifisert)"). Tester listet
  i DEL 6.1 skal passere uten endring (vil verifiseres lokalt + CI).
- **DEL 14 (multi-tenant testing):** Ja, alle nye endpoints med
  `family_id` får cross-tenant assertions. Eksisterende test-fil
  `tests/family-invitation-extension.test.js` utvides.
- **DEL 7.7 (no tech-debt):** Ja, alle kommentarer/identifiers på
  engelsk US, ingen TODOs uten issue-ref, ingen `console.log`.
- **DEL 7.11 (i18n-policy):** Ja, alle nye strings i `family.json`
  (existing namespace), ikke hardkodet.
- **DEL 7.12 (white-labeling):** Ja, email subject/body bruker
  `config.APP_NAME`. Frontend bruker `t('common:appName')` der
  app-navn vises.

Ingen ny npm-dep, ingen SaaS-aktivering, ingen secrets, ingen
backup-flyt-endring.
