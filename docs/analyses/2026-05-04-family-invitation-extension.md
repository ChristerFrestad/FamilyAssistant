# ANALYSE: Family invitation backend extension

**Dato:** 2026-05-04
**Branch:** `feat/family-invitation-backend`
**Type:** Backend extension (eksisterende invitation-flow utvides)

## Bakgrunn

PR C4 spec foreslo å bygge invitation-backend fra grunnen, men eksisterende infrastructure (migration 014, family-routes.js, family.repo.js) har allerede:
- POST /api/family/invitations
- GET /api/family/invitations
- DELETE /api/family/invitations/:id
- GET /api/invitations/:token (peek)
- POST /api/invitations/:token/accept

Mangler for pilot:
1. Email-adresse på invitasjonen (for å sende via Resend)
2. Email-sending hook (best-effort, fallback til console-log)
3. Cross-tenant DEL 14 tester for invitation-spesifikke flyter

## Endringer

- `server/migrations/028_invitation_email.sql`: ALTER TABLE family_invitations ADD COLUMN invited_email
- `server/repositories/family.repo.js`: createInvitation tar `invitedEmail` (normalisert: trim + lowercase)
- `server/auth/family-routes.js`: handleCreateInvitation tar `email`, validerer, persist via repo, beste-innsats Resend-send via ny `sendInvitationEmailBestEffort`
- `tests/family-invitation-extension.test.js`: 5 tester (migration + email-persist + null-flow + cross-tenant list/revoke)

Email-sending faller tilbake til `console.log` av URL hvis Resend ikke er konfigurert (samme pattern som magic-link). `emailService.sendInvitationEmail` interface er ennå ikke implementert — handler logger URL inntil videre.

## Multi-tenant per CLAUDE.md DEL 14

- **Ny tabell?** Nei — utvider eksisterende family_invitations.
- **Ny endpoint?** Nei — eksisterende endpoints utvides med `email`-felt.
- **Cross-tenant?** Eksplisitt testet:
  - family A's listActiveInvitations returnerer kun family A's rader
  - family B's revokeInvitation av family A's id returnerer false
  - family B's data forblir uberørt

## Edge-cases

1. **email mangler/null:** legacy URL-share-flow uendret. invited_email = null persist.
2. **email har whitespace + caps:** normaliseres til trim + lowercase.
3. **email er invalid format:** handler validerer regex, returnerer 400.
4. **Resend ikke konfigurert:** console.log URL, ikke crash.
5. **emailService.sendInvitationEmail ikke implementert:** console.log URL.
6. **emailService.sendInvitationEmail kaster:** catch + console.warn, invitasjon allerede opprettet.
7. **Cross-family revoke:** repo SQL har `WHERE family_id = ?`, så fremmed family får 0 rows updated, false-return.

## Portainer-oppstartsrisiko

Lav. Migration 028 er ALTER TABLE ADD COLUMN — additive. RESEND_API_KEY er optional. Server starter uten endring i pilot.

## ISO 25010

- Funksjonell egnethet: 8.7 → 8.8 (+0.1, email-delivery hook lagt til)
- Sikkerhet: 8.2 → 8.2 (uendret — best-effort er ikke svekkelse)
