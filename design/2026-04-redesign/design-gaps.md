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

### Family-skjerm er en dedikert tab — mockup har medlems-listen i Settings i stedet

- **Skjerm/Kontekst:** Family-skjerm på `/v2/family`
  (`client/src/app/screens/Family.tsx`) — ny dedikert hovedskjerm i
  Sprint 4 / Fase 2B
- **Oppdaget:** 2026-04-30, Fase 2B (Family-skjerm) under
  implementering
- **Hva mangler:** Mockupen
  `design/2026-04-redesign/source/Familieassistenten.html` har
  ingen designet egen Family-skjerm. Familielisten lever som en
  rad-liste inne i Settings (linje 2335-2354) med `SettingsRow`
  per medlem og en "Legg til familiemedlem"-rad nederst. Detaljerte
  per-medlem-kort har en separat `MemberDetail`-skjerm (linje 2090-
  2286) inni Settings-flyten med XP/streak/farge/permissions/
  diet-chips. Vår App.tsx har imidlertid en egen `/v2/family`-rute
  i nav-strukturen, og Sprint 4-promptet ba oss bygge en dedikert
  skjerm her. Det betyr at vi har bygd en card-grid-layout uten
  direkte design-forelegg: spacing mellom kort, header-card-stil,
  responsive breakpoint (1 col mobile, 2 col >=sm), og placeholder-
  knappers-plassering er utvikler-initierte tolkninger.
- **Blokkerende-nivå:** medium — implementasjonen følger design-
  system-tokens (Card padding="md" shadow="low", grid-gap-4 = 16
  px) og er konsistent med Dashboard-mønsteret, men er ikke et
  design-svar på "hvordan ser Family-skjermen som dedikert tab
  faktisk ut". I praksis kan Family-tab og Settings-listen leve
  side-om-side og dekke ulike use-cases (overview vs. dyp
  redigering); men det bør designes eksplisitt, ikke antas.
- **Midlertidig løsning:** Card-grid med `MemberCard` per medlem.
  Grid `grid-cols-1 sm:grid-cols-2 gap-4`. Header-card med
  familienavn + placeholder Edit-knapp øverst (`shadow="low"`).
  Member-card har Avatar (md) + navn + (Du)-badge på current
  user + role-badge (Eier/Voksen/Barn fra `users.role`) + kategori-
  label (Voksen/Ungdom/Barn fra `family_profile_members.category`)
  + PortionFactorSlider med inline save-status. "Inviter medlem"-
  primary-knapp nederst som placeholder. Single-member-roster får
  hint-tekst.
- **Antatt design-grunnlag:** Card padding `--p-4`, shadow `--shadow-low`,
  grid `--gap-4`, Avatar `md` (40 x 40 px), Badge `mint`/`cyan`/`amber`-
  varianter, alle fra `client/src/app/styles/tokens.css`. Same
  tokens som Dashboard.
- **Spørsmål til design-runde:** "Tegn dedikert Family-skjerm
  (`/v2/family`) som hovedtab. Mockup har kun medlemslist i Settings.
  Vurder: (a) skal Family-tab være en kort-grid-oversikt (overview)
  mens Settings inneholder detaljert per-medlem-redigering? (b) Hvis
  ja, hva skiller Family-card fra `MemberDetail`-flyten i Settings —
  scope, tetthet, hvilke felter som vises? (c) Hva er den primære
  CTA-en på Family — er det 'Inviter medlem' (vår nåværende valg) eller
  noe annet (f.eks. fordel oppgaver, planlegg uka, vis XP)? (d) Hvor
  hører gamification (XP, streak, fargemerking) hjemme — Family-tab,
  eller bare i Dashboard? (e) Header-card med familienavn + Edit-
  knapp: er det riktig plassering, eller hører det i Settings?"
- **Status:** Pending

### Desktop SideNav er ikke designet — kun BottomNav er i mockup

- **Skjerm/Kontekst:** AppShell, `SideNav`-komponent
  (`client/src/app/components/layout/SideNav.tsx`) — desktop-rail
  ved `md`-breakpoint (≥768 px)
- **Oppdaget:** 2026-04-29, Fase 1d (App-shell + responsive nav)
  under implementering av AppShell
- **Hva mangler:** Mockupen
  `design/2026-04-redesign/source/Familieassistenten.html` viser kun
  mobil-visningen — desktop-vinduet rendres som en sentrert
  telefon-frame i en `md:py-10 md:max-w-[1400px]`-wrapper. Det
  finnes ingen tegnet desktop-side-nav, og dermed ingen design-svar
  på (a) bredde på rail-en, (b) plassering av Settings (som ikke er
  i BottomNav), (c) hvordan logo/tema-toggle/språk-switch skal
  forholde seg til side-nav-en, (d) hover-/aktiv-tilstand for radene
  på desktop.
- **Blokkerende-nivå:** medium — implementasjonen er konsistent med
  design-system-tokens og BottomNav-mønster, men er en utvikler-
  initiert tolkning, ikke et design-svar
- **Midlertidig løsning:** Vertikal stack `w-56` med `border-r
  border-stroke` som rail-skille. Hver rad er en `Link` med
  ikon (20 px lucide) + label, `bg-ink text-ink-contrast` for aktiv
  rad og `text-text-2 hover:bg-surface hover:text-text-1` for
  inaktive rader. Settings ligger nederst med en hairline
  `border-t border-stroke` over og `mt-auto`-push for å klistre seg
  til bunnen av rail-en. Samme i18n-labels brukes som i BottomNav
  via felles `nav-items.ts`.
- **Antatt design-grunnlag:** `--canvas-0`, `--surface`, `--stroke`,
  `--ink`, `--ink-contrast`, `--text-2`, `text-body` — alle fra
  `client/src/app/styles/tokens.css`. Bredde `w-56` (224 px) er
  utvikler-valgt etter "rommer ikon + label uten å ta over
  hovedinnholdet".
- **Spørsmål til design-runde:** "Tegn desktop-utgaven av
  navigasjonen for AppShell ved breakpoint ≥768 px. Mockup har kun
  mobil-BottomNav. Trenger: (a) rail-bredde og spacing, (b) hvor
  Settings sitter (tegne som egen seksjon nederst eller flettet
  med primær-nav?), (c) hvordan header/logo forholder seg til
  rail-en (full-width header vs rail-aware header med rail-bredde
  reservert til venstre), (d) eventuell collapse-tilstand (icon-
  only når rail er smal), (e) hvordan vises hover- og aktiv-
  tilstand visuelt — samme `bg-ink` som BottomNav, eller egen
  desktop-stil (f.eks. soft-mint-tint)?"
- **Status:** Pending

### Primary Button light-mode-kontrast — formell WCAG-verifikasjon utestår

- **Skjerm/Kontekst:** `Button`-komponent, variant `primary`
  (`client/src/app/components/base/Button.tsx`) i **light mode**
- **Oppdaget:** 2026-04-28, follow-up til bug-fix `e3b8d6b`
  (text-ink → text-ink-contrast). Dark mode er løst (se "Løste
  gaps"), men light-mode-kontrasten krever uavhengig vurdering.
- **Hva mangler:** Etter fix-commiten bruker primary-knappen
  `bg-mint` + `text-ink-contrast`. I light mode betyr det
  `oklch(0.58 0.14 155)` (medium mint) som bakgrunn og
  `oklch(0.99 0.005 85)` (nær cream/hvit) som tekst. Lys cream-tekst
  på medium mint gir hånd-estimert WCAG-kontrast på rundt 3:1 —
  godt under AA-kravet på 4.5:1 for body-text. Bestått for
  AA-Large-text (≥18 pt eller ≥14 pt fet) og for "graphical objects
  and UI components" (3:1), men strengt tatt under for body-text.
  Knappen vår bruker `font-body font-medium` på `text-body` (14 px
  ikke-fet) i `md`-størrelse — kvalifiserer ikke for AA-Large.
- **Blokkerende-nivå:** medium — knappen er lesbar, men WCAG AA
  for body-text er ikke garantert
- **Midlertidig løsning:** Bruker `bg-mint text-ink-contrast` per
  spec. Ingen workaround.
- **Antatt design-grunnlag:** `--mint` og `--ink-contrast` fra
  `client/src/app/styles/tokens.css`
- **Spørsmål til design-runde:** "Verifiser WCAG AA-kontrast for
  primary-knappen i light mode med faktiske farge-konverteringsverktøy
  (Polypane, WebAIM, Stark, eller @csstools/color). Tre alternativer
  hvis nåværende valg er under AA: (1) mørkere mint i light mode
  (f.eks. `oklch(0.48 0.14 155)`) for bedre kontrast med cream-tekst;
  (2) bytte til mint-deep + samme ink-contrast; (3) hardkodet mørk
  tekstfarge på primary uavhengig av tema (alltid mørk på mint).
  Anbefal en — vis WCAG-tall for valgt alternativ."
- **Status:** Pending

---

## Løste gaps

> Entries flyttes hit fra "Aktuelle" når de er designet, implementert,
> og verifisert. Bevart som referanse for fremtidige diskusjoner og
> for å demonstrere format-velging.

### Primary Button-kontrast i dark mode

- **Skjerm/Kontekst:** `Button`-komponent, variant `primary`
  (`client/src/app/components/base/Button.tsx`)
- **Oppdaget:** 2026-04-28, Fase 1b.3 part 1 (Button-implementasjon).
  Re-klassifisert 2026-04-28 etter at Christer påpekte at den
  spesifiserte `text-ink` var en implementeringsbug (light tekst på
  lyst grønt i dark mode), ikke en design-mangel.
- **Hva mangler:** Primary-knappen var specced og implementert som
  `bg-mint text-ink hover:bg-mint-deep`. Mint i dark mode er
  `oklch(0.82 0.15 155)` (lyst grønt), ink i dark mode er
  `oklch(0.97 0.01 85)` (nær hvit). Hånd-estimert WCAG-kontrast i
  dark mode kollapset til ca. 1.5:1 — *godt* under AA-grensen på
  4.5:1 for body-text *og* under 3:1-floor for grafiske
  UI-komponenter.
- **Blokkerende-nivå:** kritisk i ettertid (under WCAG-floor i dark
  mode); ikke flagget som kritisk i opprinnelig entry siden den
  feilaktig ble klassifisert som design-mangel
- **Midlertidig løsning:** Ingen — bug-en stod i koden frem til
  fix-commiten
- **Antatt design-grunnlag:** `--mint` og `--ink` fra
  `client/src/app/styles/tokens.css`
- **Spørsmål til design-runde:** n/a (var ikke design-spørsmål; var
  feil token-valg)
- **Status:** Implementert
- **Resolusjon:** Løst — ikke design-mangel, men implementerings-bug.
  Korrigert i commit `e3b8d6b` (`fix(client): use text-ink-contrast
  on primary Button for dark-mode contrast`). Endringen byttet
  `text-ink` → `text-ink-contrast` på `primary`-varianten i
  `VARIANT_CLASSES`. Hånd-estimert dark-mode-kontrast etter fix:
  ca. 10-12:1 (komfortabelt over AA og AAA). En følge-mangel om
  light-mode-kontrast er åpnet som egen entry under "Aktuelle gaps"
  fordi cream-tekst på medium mint (light mode-resultatet) ligger på
  rundt 3:1 og krever formell WCAG-verifisering.

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

### Inline-edit av qty/unit på et shopping-list-item mangler

- **Skjerm/Kontekst:** `Shopping`-skjermen (rute `/shopping`) — interaksjon
  per `ShoppingItemRow`
- **Oppdaget:** 2026-04-30, Fase 2D (handleliste-rendering)
- **Hva mangler:** Mockupen viser items med fast qty+unit ("600 g",
  "3 dl") og ingen interaksjon for å redigere disse verdiene. Pilot-
  bruker som vil endre "2 liter melk" til "3 liter" har ingen
  inline-edit-flow — eneste vei er slett + legg til på nytt, som mister
  recipe-link og pris-estimat.
- **Blokkerende-nivå:** lavt — workaround (slett + ny add) er funksjonell,
  men sliter på pris-estimat-fidelity og bryter recipe-link
- **Midlertidig løsning:** Ingen inline-edit i Fase 2D. Bruker må slette
  raden og legge til på nytt med ny qty via QuickAddInput.
- **Antatt design-grunnlag:** n/a (ikke implementert i mellomtiden)
- **Spørsmål til design-runde:** Hvordan ser inline-edit av qty+unit ut
  per `ShoppingItemRow`? Trykk-på-tall for å åpne en numerisk picker?
  Long-press for å åpne edit-modal? Edit-knapp ved siden av X-slett?
  Hvilke begrensninger gjelder for items med `productKey` (Kassal-priset
  pakke kontra fri-tekst)?
- **Status:** Pending
