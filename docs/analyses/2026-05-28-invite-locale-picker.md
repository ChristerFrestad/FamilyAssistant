# ANALYSE: Locale picker in InviteMemberModal (issue #121)

**Bakgrunn:** PR #119's `InviteMemberModal` setter `locale` automatisk
fra `i18n.language`. Bra for vanlig case (inviterende og mottaker
deler språk-preferanse), men UX-gap når inviterende har appen på
norsk men vet at mottaker foretrekker engelsk — uten å bytte hele
appen først.

## Scope

Trivielt-merket per CLAUDE.md DEL 11. Frontend-only. Backend tar
allerede imot `'no' | 'en'` uendret. Ingen migrering, ingen API-
kontrakt-endring.

## Endringer

| Fil | Endring |
|---|---|
| `client/src/app/components/family/InviteMemberModal.tsx` | Ny `locale` state + radio-picker UI (Norsk / English) |
| `client/src/app/i18n/locales/no/family.json` | Nye nøkler: `invitations.modal.emailLanguage`, `emailLanguageNo`, `emailLanguageEn` |
| `client/src/app/i18n/locales/en/family.json` | Samme nøkler på engelsk |
| `client/src/app/components/family/InviteMemberModal.test.tsx` | 3 nye tester: default matcher `i18n.language`; override endrer payload-locale; reset på modal-close |

## Domenemodell-påvirkning

Ingen. Locale-feltet eksisterer allerede (BR-INVITE-3).

## Edge-cases

1. **Default-verdi:** Fortsatt `i18n.language?.startsWith('en') ? 'en' : 'no'`.
   Pickeren initialiseres med dette, så ingen atferdsendring for
   eksisterende flyt.
2. **Reset på modal-close:** Den eksisterende `useEffect(() => { if
   (!open) { ... } })` resetter alle felter. Locale-state legges til
   i reset-blokken slik at neste åpning starter med default igjen.
3. **Tilgjengelighet:** Radio-group med `role="radiogroup"` og
   `aria-label` på fieldset-nivå, hver radio har eksplisitt
   `<label>`. Tastatur-navigasjon via piltaster fungerer
   automatisk siden vi bruker native radioer.
4. **Frontend test SAMPLE_INVITATION:** Brukerintere `token` og
   `url` — disse blir fjernet i #120's type-splitt. Når #120 merger
   til main vil dette branch'et trenge merge-resolution. Plan:
   resolve etter #120 lander; SAMPLE_INVITATION typecast'es til
   `InvitationWithSecret` (har token + url) i stedet for
   `Invitation`.

## ISO 25010-påvirkning

- Brukbarhet: +0.1 (eksplisitt språk-kontroll uten å bytte appens
  globale UI-språk)
- Andre karakteristikker: uendret

## Portainer-oppstartsrisiko

Ingen. Frontend-only.

## Plan

1. Denne analysen — commit 1
2. Implementasjon (komponent + i18n-nøkler + tester) — commit 2
3. Full lokal client + backend CI
4. Push + PR + auto-merge etter grønn CI per Christers blank-check
