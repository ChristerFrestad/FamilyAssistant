# ANALYSE: Hash family_invitations.token (issue #120)

**Bakgrunn:** Issue #120 ber om at `family_invitations.token` lagres
som SHA-256-hash, ikke som plain-text — slik migrering 022 allerede
gjorde for `magic_link_tokens.token_hash`. Trusselen: operatør med
DB-lesetilgang kan replay'e ubrukte invitasjons-tokens innenfor
7-dagers TTL'en. Per Christer-familie-pilot er ikke dette pilot-
blokker (single operatør = single tillitsdomene), men dagen et
andre familie deploys denne koden får deres operatør tilsvarende
risiko. Multi-tenant SaaS / managed-offering ville være eksplodert
angrepsflate.

## Scope

Speiler migrering 022-patternet. Trusselmodell + risikoanalyse er
identisk; bare entity (invitation-token vs magic-link-token) er
ulik. Skjema-migrering (DEL 5.2 STOPP-krav) — derfor full analyse,
ikke triviell.

## Endring i system-grenseflate

Issue #120's steg-3-påstand om "no change required in family-routes.js"
viste seg å ikke stemme. `listActiveInvitations` returnerte `token`
og `url` til frontend som del av Invitation-typen. Disse feltene
finnes ikke etter hashing — sha256 er enveis. Konsekvens for
løsningen:

- Listing-endepunktet (`GET /api/family/invitations`) slutter å
  inkludere `token` og `url`. Frontend `PendingInvitationsList`
  bruker dem ikke (sjekket — kun id, invitedEmail, createdAt,
  expiresAt blir rendret). Tester asserter ikke på `token` eller
  `url` i listing-respons.
- Create-endepunktet (`POST /api/family/invitations`) og resend
  (`POST /api/family/invitations/:id/resend`) returnerer fortsatt
  plain token + url i én-shot — det er en del av flyten siden
  emailen lager URL'en der.
- TypeScript-type splittes: `Invitation` (uten secret) for listing,
  `InvitationWithSecret` (med token + url) for create/resend.

## Domenemodell-påvirkning

Ny forretningsregel BR-INVITE-4: Invitation-tokens lagres som
SHA-256-hash. Plain token aksesseres kun i én-shot create-/resend-
respons.

Vil dokumenteres i `docs/DOMAIN_MODEL.md` etter merge.

## Reisen

1. Operatør oppretter invitasjon
2. Backend genererer 256-bit random token
3. Backend INSERT'er `sha256(token)` i `token_hash`-kolonnen
4. Backend returnerer plain token + invitation-URL én gang i
   create-respons (frontend bruker URL'en i email-call)
5. Plain token blir aldri lest tilbake fra DB
6. Mottaker klikker URL'en → frontend POST'er token til
   `/api/invitations/:token/accept`
7. Backend hash'er innkommende token, slår opp via `token_hash = ?`
8. Hvis match og expires_at > now: accept

## Edge-cases

1. **In-flight invitasjoner ved deploy:** Mirror migrering 022 —
   `DELETE FROM family_invitations` som del av migrering 030.
   Eventuelle utestående invitasjoner blir ubrukelige; operatør
   må re-sende. Worst case for Christer-pilot: 0 in-flight
   (han er eneste operatør).
2. **Backwards compat på findInvitationByToken:** API uendret
   — hashing skjer i repo-laget. Tester som faker invitation-
   tokens i DB'en må oppdateres til å hash'e før INSERT, ELLER
   må bruke `repos.family.createInvitation()` (anbefalt).
3. **Resend-flyten:** Genererer ny plain token, hash'er for
   UPDATE, returnerer plain token i respons. Forrige tokens hash
   blir overskrevet.
4. **Audit-log:** `auditInvitation()` mottar `invitation`-objektet
   som returneres fra repo. Etter denne endringen vil
   `invitation.token` ikke finnes (kun `token_hash`). Audit-log
   må enten ekskludere token-feltet helt (anbefalt — secrets bør
   ikke i audit-log uansett), eller utvides til å motta plain
   token separat.
5. **Migrering-rollback:** Som mig 022 — ikke reversibel siden
   hash er enveis. Hvis rollback nødvendig: alle aktive
   invitasjoner må re-sendes etter rollback.

## Konsekvenser på tvers

- `tests/family-invitation-message.test.js` linje 144-152: bruker
  `repos.family.createInvitation({token: 'tok-list', ...})` —
  fortsatt fungerer, men det som lagres er `sha256('tok-list')`.
  Test asserter ikke på `token`-feltet → ingen endring.
- `tests/family-invitation-extension.test.js`: bruker
  `listActiveInvitations` — sjekk om feltet `token` brukes
  (forventer nei).
- Andre tester som bygger invitation-fixtures direkte via SQL må
  hash'e tokens.

## ISO 25010-påvirkning

- Sikkerhet: 8.3 → 8.5 (+0.2, lukker invitasjons-token-replay-vinduet
  i pre-external-multi-tenant-scenarier)
- Vedlikeholdbarhet: uendret
- Andre karakteristikker: uendret

## Portainer-oppstartsrisiko

Lav. Migreringen er idempotent (kjøres én gang). DELETE FROM på
tom tabell er trivielt. ALTER TABLE RENAME COLUMN støttet i SQLite
≥3.25, better-sqlite3 12.x bruker ≥3.49.

## Plan

1. Denne analysen — commit 1
2. Migrering 030 + repo-endring + type-splitt + tester — commit 2
3. Frontend Invitation-type-oppdatering — commit 3 (kun TS-type)
4. DOMAIN_MODEL.md BR-INVITE-4 — commit 4
5. Full lokal CI
6. Push + PR + auto-merge etter grønn CI per Christers blank-check
   av Batch A + B (gitt eksplisitt i meldingen "start batch A, og B,
   commit og merge"). Skjema-endring (DEL 5.2 STOPP-krav) er
   dermed dekket.
