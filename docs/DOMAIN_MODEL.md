# DOMAIN_MODEL.md – Domenemodell og forretningsregler

> Dette dokumentet er systemets kollektive forståelse av seg selv.
> Claude leser det før hver oppgave og oppdaterer det når domenet
> utvides eller endres. Hvis denne filen og koden er i konflikt:
> STOPP og varsle Christer. En av dem er feil.

> Dette dokumentet er **bevisst startet tomt**. Prosjektet har allerede
> 22 services og rik domeneforståelse i koden – å backfille alt her
> ville være en flere-ukers oppgave på linje med ISO-løftet. I stedet
> vokser dokumentet når Claude berører domeneområder, én oppgave av gangen.

---

## HVORDAN LESE DETTE DOKUMENTET

Inntil en entitet, regel, eller edge-case er dokumentert her, er
kode-sannhet i `server/services/*.service.js` og `server/repositories.js`
den autoritative kilden. Når Claude jobber med en ny oppgave:

1. Sjekk om berørte entiteter/regler finnes her
2. Hvis ja: bruk som referanse, oppdater hvis endring
3. Hvis nei: når oppgaven er ferdig, dokumenter det som ble etablert
   eller oppdaget under arbeidet

---

## ENTITETER

> Hver entitet beskriver: felter, relasjoner, regler, livssyklus.
> Kort og konkret. Koden er sannheten; dette er forklaringen.

*(Ingen entiteter dokumentert ennå. Vokser organisk.)*

### Format å følge når du legger til en entitet

````markdown
### <EntityName>

**Kildefil:** `server/services/<name>.service.js`
**Repository:** `repos.<entity>` i `server/repositories.js`
**Tabell:** `<table_name>` (migrasjon `server/migrations/<NNN>_*.sql`)

**Hva er det:** 2–3 setninger som forklarer hva entiteten representerer
i familien/husholdningen.

**Felter:**
- `id` – PK
- `<felt>` (type) – kort forklaring
- `created_at`, `updated_at`

**Relasjoner:**
- 1 ↔ N med <AnnenEntity>
- ...

**Regler:**
- <regel 1>
- <regel 2>
- Referer BR-N hvis regel er dokumentert i forretningsregler

**Livssyklus:**
<Hvordan entiteten oppstår, endres, og forsvinner.>

**Berøres av tester:**
- `tests/<fil>.test.js`
````

---

## FORRETNINGSREGLER

> Regler som går på tvers av flere entiteter. Nummereres for referanse
> fra kode og tester. Format: BR-<nummer> (Business Rule).

### BR-INVITE-1: Pre-validering ved invitasjons-opprettelse

**Hva:** Når en eier oppretter en invitasjon med en e-post-adresse,
avviser serveren med 409 hvis e-posten allerede er medlem
(`EMAIL_ALREADY_MEMBER`) eller allerede har en aktiv pending
invitasjon (`EMAIL_ALREADY_INVITED`) i samme familie.

**Hvorfor:** Forhindrer at brukere blir bombardert med duplikate
invitasjoner og at invitasjons-listen vokser med "ghost"-rader.
Sjekken er familie-scoped slik at den samme e-posten kan inviteres
til flere familier samtidig (DEL 14 cross-tenant isolation).

**Detaljert flyt:**
1. Klient sender POST `/api/family/invitations` med email + role +
   message + locale
2. Server normaliserer email: `trim().toLowerCase()`
3. `findExistingMemberByEmail(familyId, email)` (case-insensitive
   match mot `users.email` for `family_id = ?` og `deleted_at IS NULL`)
4. Hvis treff → 409 `{code: 'EMAIL_ALREADY_MEMBER'}`
5. `findActiveInvitationByEmail(familyId, email)` (mot
   `family_invitations` med `accepted_at IS NULL AND revoked_at IS
   NULL AND expires_at > now`)
6. Hvis treff → 409 `{code: 'EMAIL_ALREADY_INVITED'}`
7. Ellers: insert + send email

**Berørte filer:**
- `server/auth/family-routes.js` (`handleCreateInvitation`)
- `server/repositories/family.repo.js`
  (`findExistingMemberByEmail`, `findActiveInvitationByEmail`)
- `tests/family-invitation-prevalidation.test.js`

**Dokumentert:** 2026-05-05, PR #119

### BR-INVITE-2: Resend roterer token og invaliderer gammel

**Hva:** Resend genererer en ny `token`-verdi og oppdaterer
`expires_at` til nå + 7 dager. Den gamle token-verdien blir
slettet, så den gamle `/v2/invite/<oldToken>`-lenken slutter å
fungere umiddelbart.

**Hvorfor:** Standard SaaS-pattern. Hvis original e-post lekker
eller invitasjons-lenken kompromitteres, gir resend en ny rotert
token uten å lage en duplikat-rad. invited_email,
invitation_message og locale arves fra original-raden — eierens
intent er "send samme invitasjon på nytt", ikke "endre den".

**Detaljert flyt:**
1. Eier klikker "Send på nytt" på pending-listen
2. Klient POSTer `/api/family/invitations/:id/resend`
3. Server validerer family_id-match og pending-state
4. `randomToken(32)` → ny token
5. UPDATE `family_invitations` SET token = ?, expires_at = ?
   WHERE id = ? AND family_id = ? AND accepted_at IS NULL AND
   revoked_at IS NULL
6. Email sendes på nytt med ny URL og samme melding/locale
7. Gammel token returnerer null fra `findInvitationByToken` → klikk
   på gammel link gir STATE 5 NOT_FOUND

**Berørte filer:**
- `server/auth/family-routes.js` (`handleResendInvitation`)
- `server/repositories/family.repo.js` (`resendInvitation`)
- `tests/family-invitation-resend.test.js`

**Dokumentert:** 2026-05-05, PR #119

### BR-INVITE-3: Invitasjon eier sin egen locale + personlig melding

**Hva:** Hver `family_invitations`-rad lagrer `locale`
(`'no' | 'en'`, NOT NULL DEFAULT 'no') og valgfri
`invitation_message` (TEXT, max 500 tegn). Email-rendering bruker
disse feltene direkte — uten å avhenge av inviters eller mottakers
nåværende språkpreferanse.

**Hvorfor:** Resend må kunne sende emailen i samme språk som
første gang. `users.preferred_language` finnes ikke (out-of-scope
for pilot), så invitasjonen må selv eie locale-valget.

**Detaljert flyt:**
1. Frontend leser `i18n.language` ved create
2. Klient POSTer body `{email, role, invitationMessage, locale}`
3. Backend Zod-aktig validering: locale ∈ {'no','en'}, message ≤ 500
4. Server INSERT — locale + message persistert på raden
5. Email-rendering velger template `invitation-{locale}.html` +
   `.txt`, substituerer `{{INVITATION_MESSAGE_BLOCK}}` (HTML-eskapet
   blockquote eller plain-text quote)
6. Resend leser samme felter — ingen re-fetch av brukerpreferanse

**Berørte filer:**
- `server/migrations/029_invitation_message_locale.sql`
- `server/repositories/family.repo.js` (`createInvitation`)
- `server/services/email.service.js` (`renderInvitationTemplate`,
  `sendInvitationEmail`)
- `server/email/templates/invitation-{no,en}.{html,txt}`
- `tests/family-invitation-message.test.js`,
  `tests/email-invitation-locale.test.js`

**Dokumentert:** 2026-05-05, PR #119

### BR-BRAND-1: Brand-config kommer kun fra env-variabler

**Hva:** Hver white-label-instans (Hverdagsplanleggeren,
FamilyAssistant og fremtidige) får brand-config (app-navn, wordmark-
splitt, favicon-bokstav, tagline, primær/aksent/dot-farger) fra åtte
env-variabler. Ingen hardkodede app-navn, taglines eller farger
finnes i React-komponenter, HTML eller email-templates.

**Hvorfor:** Samme Docker-image skal kunne servere alle brands uten
rebuild. Build-time-mekanikken (`VITE_APP_NAME`) som ble brukt fra
Sprint 2.5 til Sprint 9 brøt dette løftet — `:main`-imaget hadde en
bygget-inn `appName` som ikke kunne overstyres ved deploy. Sprint 10
(PR #122) erstattet build-time-mekanikken med `GET /api/config` som
klienten henter ved app-mount.

**Detaljert flyt:**
1. Operatør setter `APP_NAME`, `APP_NAME_PRIMARY`, `APP_NAME_ACCENT`,
   `APP_FAVICON_LETTER`, `APP_TAGLINE`, `APP_PRIMARY_COLOR`,
   `APP_ACCENT_COLOR`, `APP_DOT_COLOR` i Portainer-stacken
2. `server/config.js` Zod-validerer ved oppstart; defaults reflekterer
   FamilyAssistant
3. `server/index.js` logger aktiv brand ved boot via pino +
   eventuelle cross-validation-warnings
4. `server/http/branding.js` eksponerer ikke-sensitive felter via
   `GET /api/config` (cache 1 t)
5. Klient henter `/api/config` i `client/src/main.tsx` før React-mount
6. `applyBrandTokens(config)` injiserer CSS-tokens på `:root`;
   `i18n.addResource('common.appName', ...)` driver eksisterende
   `{{appName}}`-interpolation
7. `Wordmark` + email-templates leser fra config — ingen hardkoding

**Berørte filer:**
- `server/config.js` (envSchema, collectBrandWarnings)
- `server/http/branding.js` (`/api/config`, `/favicon.svg`,
  `/logo-mark.svg`, `/manifest.json`)
- `client/src/app/hooks/useBrandConfig.ts`
- `client/src/main.tsx` (early fetch + side-effects)
- `tests/brand-config-validation.test.js`,
  `tests/branding-routes.test.js`

**Dokumentert:** 2026-05-05, PR #122

### BR-BRAND-2: Wordmark er todelt med fargedeling

**Hva:** App-navnet rendres alltid som to konkatenerte segmenter
(`APP_NAME_PRIMARY` + `APP_NAME_ACCENT`) hvor hvert segment har en
egen farge — primær og aksent. Fargedelingen markerer en konseptuell
todeling i navnet (sammensatt ord på norsk, to-ords-navn på engelsk).
`<Wordmark size="..." />`-komponenten brukes overalt der app-navnet
skal vises som logo. Rene tekst-kontekster (browser-title, meta-tags,
email-subject) bruker `config.appName` direkte.

**Hvorfor:** Visuell signatur som er gjenkjennelig på tvers av brand-
instanser uten å kreve grafisk illustrasjon. Hver instans deler
samme strukturelle DNA men har egne ord og farger via env.

**Detaljert flyt:**
1. `Wordmark` leser `useBrandConfig().config.{namePrimary, nameAccent}`
2. Mens config er null (cold-load): rendrer width-reservert usynlig
   placeholder. Bedre tom for ~200 ms enn feil brand for 200 ms —
   ingen `'FamilyAssistant'`-fallback under cold-load
3. Når config kommer: `<span style="color:primary">{namePrimary}</span><span style="color:accent">{nameAccent}</span>`
4. `aria-label` settes til konkateneringen så screen-readers leser
   "Hverdagsplanleggeren" som ett ord

**Berørte filer:**
- `client/src/app/components/brand/Wordmark.tsx`
- `client/src/app/hooks/useBrandConfig.ts`
- `client/src/app/components/layout/AppShell.tsx` (header)
- `client/src/app/components/brand/Wordmark.test.tsx`,
  `client/src/app/hooks/useBrandConfig.test.ts`

**Dokumentert:** 2026-05-05, PR #122

### BR-BRAND-3: Favicon = én bokstav i mørkegrønn container

**Hva:** Favicon er én bokstav (`APP_FAVICON_LETTER`) i samme
typografi som wordmarken, satt på en mørkegrønn rounded-rect
container (`#1F3F26` default) med en liten salviegrønn prikk
(`#7BA05B` default) i øvre høyre hjørne. Bokstaven er første tegn i
`APP_NAME_PRIMARY`. Rendres dynamisk fra
`server/branding/templates/favicon.template.svg` ved request til
`GET /favicon.svg`.

**Hvorfor:** Et symbol som er gjenkjennelig på tab-bar uten å være
knyttet til en spesifikk app-funksjon (kalender, hake, mat). Samme
container-formel virker for hver brand — bare bokstaven og evt.
fargene endres. SVG-only inntil PNG-derivater (sharp) tas inn
som tech-debt før external pilot.

**Detaljert flyt:**
1. `client/index.html` har `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
2. Browser fetcher `/favicon.svg`
3. `server/http/branding.js` leser cached template + substituerer
   `{{LETTER}}` (sanitized til a-zA-Z) og `{{APP_NAME}}` (XML-escaped)
4. Server returnerer `image/svg+xml` med `Cache-Control: public,
   max-age=3600, immutable`
5. Samme template i større format brukes for `/logo-mark.svg` (PWA
   install-icon, post-pilot OG-image)

**Berørte filer:**
- `server/branding/templates/favicon.template.svg`
- `server/branding/templates/logo-mark.template.svg`
- `server/http/branding.js`
- `tests/branding-routes.test.js`

**Dokumentert:** 2026-05-05, PR #122

### Format å følge når du legger til en regel

````markdown
### BR-001: <Kort tittel>

**Hva:** <Regelen i 1–2 setninger>

**Hvorfor:** <Bakgrunn og begrunnelse>

**Detaljert flyt:**
1. <steg>
2. <steg>
3. <steg>

**Berørte filer:**
- `server/services/<navn>.service.js` (implementasjon)
- `tests/<fil>.test.js` (verifikasjon)

**Dokumentert:** <dato, PR-nummer>
**Sist endret:** <dato, PR-nummer>
````

---

## EDGE-CASES PÅ TVERS

> Edge-cases som berører flere entiteter og må håndteres konsistent
> overalt. Nummereres for referanse.

*(Ingen edge-cases dokumentert ennå.)*

---

## GLOSSAR

> Når Christer eller koden bruker ord, skal de bety det samme.

*(Ingen termer definert ennå. Bygges opp etter hvert.)*

### Format å følge

````markdown
- **<Term>:** <Kort definisjon>. (Referanse: `<fil>`)
````

---

## RELASJONER PÅ HØYT NIVÅ

*(Diagram/oversikt kommer når nok entiteter er dokumentert.)*

---

## REFERANSER TIL EKSISTERENDE ID-SYSTEMER

Prosjektet har allerede etablert flere ID-systemer fra ISO-planen.
DOMAIN_MODEL.md bruker **BR-N** for forretningsregler, og refererer
til eksisterende ID-er der relevant – **introduserer ikke parallelle
systemer**:

- **SAF-N** – safety (se `docs/SAFETY_CASE.md`, f.eks. SAF-1 =
  deterministisk allergi-post-filter)
- **SBOM-N** – supply chain (f.eks. SBOM-6 = audit_log)
- **OBS-N** – observability
- **PERF-N** – ytelse
- **PORT-N** – portabilitet
- **TS-N** – type-sikkerhet
- **R-N** – risks (se `docs/RISK_REGISTER.md`, R1-R12)

En forretningsregel kan referere en SAF eller R der det gir mening,
f.eks.:
> BR-005 implementerer SAF-1 (deterministisk allergi-sjekk) for
> shopping-list-entries. Se også R1.