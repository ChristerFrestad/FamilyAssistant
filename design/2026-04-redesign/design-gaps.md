# Design-mangler — levende dokument

Dette er et levende dokument som fanger opp design-mangler oppdaget
under implementering. Hver entry blir grunnlag for fremtidige
`claude.ai/design`-runder. Christer leser dette før hver design-runde
for å bygge prioritert prompt.

> Hva kvalifiserer som en mangel? Manglende skjerm, manglende
> tilstand i en eksisterende skjerm (f.eks. tomliste, lasting, feil),
> uklar interaksjon, ny komponent som ikke er designet, eller en
> spesifisert design-detalj som ikke holder under implementering
> (kontrast, fokus-rekkefølge, responsive-breakpoint, ...). En
> bevisst nedprioritering av scope er IKKE en mangel.

## Format per entry

Hver entry skal ha alle åtte feltene under. Bruk `n/a` for felt som
ikke gir mening i konteksten — aldri tomt felt, aldri stilltiende
slettet felt.

```
### <kort tittel>

- **Skjerm/Kontekst:** Hvilken skjerm, komponent, eller flyt
- **Oppdaget:** YYYY-MM-DD + hvilken fase/oppgave under implementering
- **Hva mangler:** Beskrivelse av det manglende eller uklare
- **Blokkerende-nivå:** kritisk | medium | lavt
- **Midlertidig løsning:** Hva ble bygd hvis noe (tokens, fallback, stub)
- **Antatt design-grunnlag:** Tokens, fonter, spacing brukt i mellomtiden
- **Spørsmål til design-runde:** Konkret formulering Christer kan
  klippe inn i en design-prompt
- **Status:** Pending | I review | Designet | Implementert
```

`Status`-progresjonen er:
- **Pending** — entry er åpen, ingen design-runde startet
- **I review** — entry er sendt inn i en design-runde, venter svar
- **Designet** — design er levert, men ikke implementert ennå
- **Implementert** — implementert + verifisert. Flytt til "Løste gaps".

---

## Eksempel (fiktivt, viser formatet)

### Tom-tilstand for ukens handleliste mangler

- **Skjerm/Kontekst:** `Shopping`-skjermen (rute `/shopping`)
- **Oppdaget:** 2026-05-12, Fase 2c.1 (handleliste-rendering)
- **Hva mangler:** Mockupen viser handlelisten med 4-12 varer, men
  ingen tilstand når lista er tom (ingen oppskrifter aktivert for
  uken, eller alt er allerede merket kjøpt). Implementering må vise
  noe — vi vet ikke om det skal være en illustrasjon, en
  call-to-action, eller bare tomt.
- **Blokkerende-nivå:** medium — flyten fungerer, men brukeren får
  en uforklart hvit flate
- **Midlertidig løsning:** Bygd en enkel sentrert tekst "Ingen varer
  i listen ennå. Velg oppskrifter på Middag-siden for å fylle den."
  med `text-text-3` og `font-body text-meta`.
- **Antatt design-grunnlag:** `--text-3`, `--font-body`,
  `--text-meta`, sentrert med `flex items-center justify-center
  min-h-[200px]`
- **Spørsmål til design-runde:** "Tegn tom-tilstand for handleliste
  i Shopping-skjermen. Skal vi vise illustrasjon (på linje med
  feilskjerm-stilen), bare tekst, eller en CTA-knapp som tar
  brukeren til Middag-siden? Husk dark/light theme."
- **Status:** Pending

---

## Aktuelle gaps

### Primary Button-kontrast i dark mode

- **Skjerm/Kontekst:** `Button`-komponent, variant `primary`
  (`client/src/app/components/base/Button.tsx`)
- **Oppdaget:** 2026-04-28, Fase 1b.3 part 1 (Button-implementasjon)
- **Hva mangler:** Primary-knappen er specced som `bg-mint
  text-ink`. Mint i light mode er `oklch(0.58 0.14 155)` (medium-grønt)
  og ink er `oklch(0.22 0.02 85)` (mørk) — god kontrast. Mint i dark
  mode er `oklch(0.82 0.15 155)` (knall lys grønt) og ink er
  `oklch(0.97 0.01 85)` (nesten hvit) — *lys tekst på lyst grønt*.
  Marginal kontrast, sannsynligvis under WCAG AA-grensen (4.5:1) for
  body-text-størrelse.
- **Blokkerende-nivå:** medium — knappen fungerer, men leselighet
  i dark mode kan svikte for brukere med synsbegrensninger eller på
  skjermer med lav brightness
- **Midlertidig løsning:** Fulgte spec som gitt (bg-mint text-ink).
  Ingen workaround i koden.
- **Antatt design-grunnlag:** `--mint` og `--ink` fra
  `client/src/app/styles/tokens.css`. Theme-switch er token-drevet.
- **Spørsmål til design-runde:** "Skal `primary`-knappen ha en fast
  mørk tekstfarge uavhengig av tema (alltid `text-ink-light` eller
  lignende), eller skal vi velge en mørkere mint-variant i dark mode
  så `text-ink` (lys i dark) får tilstrekkelig kontrast? Vis WCAG
  AA-kontrastberegninger for begge alternativer."
- **Status:** Pending

---

## Løste gaps

> Entries flyttes hit fra "Aktuelle" når de er designet, implementert,
> og verifisert. Bevart som referanse for fremtidige diskusjoner og
> for å demonstrere format-velging.

### Feilskjerm — generell tilstand for nettverks-/server-feil

- **Skjerm/Kontekst:** Feilskjerm (Screen 07), 3 varianter
  (offline, server-feil, uventet feil)
- **Oppdaget:** 2026-04-23, Fase 1b.0 (analyse av opprinnelig
  mockup-pakke)
- **Hva mangler:** Opprinnelig mockup-pakke (april 2026) hadde ingen
  designet feilskjerm. Brukere som mister nett, treffer en server-feil,
  eller får uventet kasterror ville se en udesignet rå nettleser-feil.
- **Blokkerende-nivå:** medium — kunne deferes til etter pilot, men
  skadet onboarding-opplevelsen
- **Midlertidig løsning:** Ingen — implementering hadde ikke nådd
  feilhåndteringsfasen ennå
- **Antatt design-grunnlag:** n/a (ikke implementert i mellomtiden)
- **Spørsmål til design-runde:** n/a (allerede løst — se
  resolusjon under)
- **Status:** Implementert (designet, men ikke implementert i kode
  ennå — se note)
- **Resolusjon:** Lagt til i ny onboarding-pakke
  `design/2026-04-redesign/source/Onboarding og Auth.html` linje
  1301-1446 som `ScreenError`-komponent med tre varianter
  (`offline`, `server`, `unexpected`). Implementeringen kommer i
  Fase 2 etter at nav/route-strukturen er på plass.

### `bg-bg-0` stutter-naming i Tailwind utility-klasser

- **Skjerm/Kontekst:** Hele design-systemet — Tailwind-utility-klasser
  som leser fra background-tokens
- **Oppdaget:** 2026-04-28, Fase 1b.3 part 1 (Christer påpekte under
  godkjenning av Fase 1b.2.3)
- **Hva mangler:** Tokens var navngitt `--bg-0/1/2` som mappet til
  Tailwind-keys `bg-0/1/2`, som genererte utility-klasser
  `bg-bg-0`/`bg-bg-1`/`bg-bg-2`. "bg" gjentok seg to ganger i hver
  klasse — visuell støy og ikke i tråd med moderne
  design-system-konvensjoner (canvas/surface/ink-mønsteret).
- **Blokkerende-nivå:** lavt — stutter, men funksjonelt korrekt
- **Midlertidig løsning:** Fungerte — bare estetisk uvanlig
- **Antatt design-grunnlag:** Tailwind v3-utility-emisjon basert på
  `theme.extend.colors`-keys
- **Spørsmål til design-runde:** n/a (utviklerinitiert refaktor,
  ikke design-spørsmål)
- **Status:** Implementert
- **Resolusjon:** Renamet `--bg-*` til `--canvas-*` i tokens.css,
  Tailwind config, og preview-seksjoner. Commit c560846
  (`refactor(client): rename --bg-* design tokens to --canvas-* for
  clarity`). Utility-klasser leser nå som `bg-canvas-0` —
  konsistent med moderne design-system-konvensjon.
