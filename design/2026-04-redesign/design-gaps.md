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

<!-- Primary Button light-mode-kontrast — flyttet til "Løste gaps"
     2026-05-01 etter Phase 3A WCAG-revisjon.
     Se entry "Primary Button light-mode-kontrast" under Løste gaps. -->

---

## Løste gaps

> Entries flyttes hit fra "Aktuelle" når de er designet, implementert,
> og verifisert. Bevart som referanse for fremtidige diskusjoner og
> for å demonstrere format-velging.

### Primary Button light-mode-kontrast

- **Skjerm/Kontekst:** `Button`-komponent, variant `primary`
  (`client/src/app/components/base/Button.tsx`) i **light mode**
- **Oppdaget:** 2026-04-28, follow-up til bug-fix `e3b8d6b`
  (text-ink → text-ink-contrast). Light-mode-kontrasten krevde
  uavhengig vurdering siden dark mode allerede var løst.
- **Hva manglet:** Primary-knappen brukte `bg-mint` + `text-ink-contrast`.
  I light mode betydde det `oklch(0.58 0.14 155)` (medium mint) som
  bakgrunn og `oklch(0.99 0.005 85)` (nær cream/hvit) som tekst.
  Mathematisk WCAG-kontrast i light mode: ~3.0:1 — under AA-kravet
  på 4.5:1 for body-text. Knappen brukte `font-body font-medium` på
  `text-body` (14 px ikke-fet) som ikke kvalifiserer for AA-Large.
- **Blokkerende-nivå:** medium (escalert til kritisk under
  Phase 3A audit siden alle pilot-flow trenger AA-compliance)
- **Midlertidig løsning:** Bruker `bg-mint text-ink-contrast` per
  spec. Ingen workaround.
- **Antatt design-grunnlag:** `--mint` og `--ink-contrast` fra
  `client/src/app/styles/tokens.css`
- **Spørsmål til design-runde:** n/a (resolved i Phase 3A WCAG-
  audit — se Resolusjon)
- **Status:** Implementert
- **Resolusjon:** Phase 3A WCAG-revisjon (`fix/wcag-revisjon` branch,
  PR pending) implementerte BESLUTNING 4 Alternativ A:
  - `--mint` light mode: L=0.58 → L=0.50 (`oklch(0.50 0.14 155)`)
  - `--mint-deep` light mode: L=0.45 → L=0.38 (`oklch(0.38 0.13 155)`)
  - `--mint-deep` dark mode: L=0.55 → L=0.62 (fikset hover-state
    som også var under AA i dark mode)

  Ny matematisk WCAG-kontrast (verifisert i
  `client/src/app/styles/contrast.test.ts`):
  - cream `oklch(0.99 0.005 85)` på dark mint `oklch(0.50 0.14 155)`:
    ~5.0:1 ✓ AA Normal
  - cream på mint-deep light `oklch(0.38 0.13 155)`: ~7.5:1 ✓ AAA
  - dark `oklch(0.15 0.02 95)` på dark mint-deep `oklch(0.62 0.14 155)`:
    ~5.4:1 ✓ AA Normal

  Alle tre tokens er låst i contrast-tester slik at en designer ikke
  kan reversere endringen uten at testen feiler.

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

### Seed-data og recipe-ingredient-kategorier er hardkodede norske strenger

- **Skjerm/Kontekst:** `Shopping`-skjermen, kategori-headers i `CategoryGroup`
- **Oppdaget:** 2026-04-30, Fase 2D (kategori-i18n-bug)
- **Hva mangler:** Backend bruker norske kategori-strenger som
  `'Frukt & grønt'`, `'Kjøtt & fisk'`, `'Meieri'`, `'Tørrvarer & annet'`
  konsistent i `server/seed.js` (84 produkter), `server/llm.js` LLM-
  prompt, og `shopping_extras.add()`-default. Frontend rendrer disse
  as-is uten i18n-mapping, så engelsk-språk-brukere ser norske
  kategori-headers på alle items som kommer fra recipe-generering
  eller seed-data.

  Manuelle items er adressert i Fase 2D (category=`'other'` enum-key,
  i18n-mappet til "Annet"/"Other"). Kjente keys er `produce`, `meat`,
  `dairy`, `pantry`, `frozen`, `beverage`, `household`, `other`.
- **Blokkerende-nivå:** medium — pilot-bruker er Christer (norsk-
  preferanse), men engelsk-språk-piloter i fremtid vil oppleve mixed-
  language UI hvis ikke fikset
- **Midlertidig løsning:** `KNOWN_CATEGORY_KEYS`-set i
  `CategoryGroup.tsx` mapper kjente enum-keys gjennom i18n; ukjente
  strenger passerer uendret. Tilstand: bare `'other'` brukes for nye
  manuelle items; eksisterende seed-data og recipe-genererte items
  har fortsatt norske strenger.
- **Antatt design-grunnlag:** Tailwind-design-system, eksisterende
  Card + Badge-komponenter, `--mint`/`--coral`/`--cyan`/`--amber`/
  `--rose`-accent-palett
- **Spørsmål til design-runde:** Hvilke kategori-keys og display-
  navn skal vi standardisere på tvers av norsk og engelsk?
  Sannsynlige kandidater: produce, meat, dairy, pantry, frozen,
  beverage, household, snacks, frozen-meals, baby, pet, other. Skal
  vi tillate fri-tekst-kategorier (UI-bruker-input) eller låse til
  enum? Om enum: trenger vi 8, 12, eller 16 kategorier? Skal hver
  kategori ha en accent-farge fra design-tokens, eller er hash-
  basert mapping nok?
- **Oppfølging:** seed.js (84 produkter), llm.js (LLM-prompt-mapping),
  shopping_extras.add()-default må migreres samtidig. Database-
  migrering kreves for eksisterende rader: oppdater
  `shopping_list_items.category` fra norske strenger til enum-keys
  via UPDATE-mappingstabell.
- **Status:** Pending

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

### "Marker brukt"-dialog er ikke i mockup — pilot-tilleggs-funksjon

- **Skjerm/Kontekst:** Pantry-sub-view i Shopping-skjermen
  (`?view=pantry`) — `UseDialog`-komponent
  (`client/src/app/components/pantry/UseDialog.tsx`)
- **Oppdaget:** 2026-04-30, Fase 2E (Pantry sub-view) under
  scope-bekreftelse med Christer
- **Hva mangler:** Mockupen `Familieassistenten.html` linje 804-895
  (`Pantry`-sub-view) viser pantry-rader med navn, holdbarhet-
  badge, progress-bar, og "Handle"-knapp når level < 40%. Det er
  INGEN "Marker brukt"-knapp eller dialog i designet. Christer har
  prioritert kvantitativ tracking som kjerne-verdi for pilot
  (B3-overstyring 2026-04-30) og bedt oss bygge dialogen som
  tilleggs-funksjon utenfor mockup.
- **Blokkerende-nivå:** medium — funksjon er nødvendig for kjerne-
  verdi-løftet, men design er utvikler-initiert og bør verifiseres
  i neste design-runde
- **Midlertidig løsning:** `UseDialog` bygd som modal med tre quick-
  buttons ("1/4", "1/2", "Alt") + manuelt nummer-input. Validering
  blokkerer amount > remaining og amount ≤ 0. Dialog åpner via
  "Marker brukt"-knapp på hver `PantryItem`, lukker på bekreft eller
  avbryt. Sender PUT /api/pantry/correct med `newQty = remaining -
  amountUsed`. Optimistisk UI-update + rollback ved feil.
- **Antatt design-grunnlag:** Modal-komponent (size="sm",
  position="center") fra Fase 1b.3 Batch G; Button (primary +
  secondary); inline-validering med `text-coral`; quick-button-stil
  matcher chips i Shopping-skjermen (`rounded-pill` + `bg-surface`).
- **Spørsmål til design-runde:** "Tegn 'Marker brukt'-flyten på
  Pantry. Skal det være: (a) modal som vi har bygd, (b) inline-
  popover ved siden av item-raden, (c) bottom-sheet på mobil
  (slide-up med thumb-friendly knapper)? Quick-buttons: er 1/4-
  1/2-Alt riktig sett, eller skal vi ha 25-50-75-100 % tabs i
  stedet? Decimal-input: la brukeren skrive direkte (kr/g/dl),
  eller bruk +/- stepper? Når amount = remaining, skal vi vise en
  ekstra bekreftelse ('Tom for vare — fjerne den?') eller bare
  silent fjerne raden? Hvilken aksent-fargesetting hører hjemme
  her — primary mint, eller ikke-fremtredende secondary?"
- **Status:** Pending

### Settings-skjerm forenklet for pilot — 4 av mockup-ens 9 grupper

- **Skjerm/Kontekst:** Settings-skjerm på `/v2/settings`
  (`client/src/app/screens/Settings.tsx`) — siste skjerm i Sprint 5
  / Fase 2F
- **Oppdaget:** 2026-05-01, Fase 2F (Settings-skjerm) under
  scope-bekreftelse med Christer
- **Hva mangler:** Mockupen `Familieassistenten.html:2288-2570`
  viser Settings som modal-overlay fra TopBar med 9 SettingsGroups
  (Hjem-card, Familiemedlemmer, Tilkoblinger, Handel og butikker,
  Assistenten, Familieliv, Varsler, Preferanser, Konto og personvern,
  Logg ut). Pilot-implementasjonen er en dedikert `/v2/settings`-tab
  med 4 seksjoner: System (språk + tema), Familie (navn + 3 disabled
  Coming soon-rader), Bruker (2 disabled Resend-rader), Konto (GDPR-
  eksport + slett konto). Fem hele mockup-grupper er ikke bygd:
  Familiemedlemmer (overlapper med Family-skjerm), Tilkoblinger
  (Google Cal / Apple Cal — post-pilot), Handel og butikker
  (Kassal-API-key UI + foretrukne butikker — post-pilot),
  Assistenten (smarte forslag + stemme — post-pilot), Familieliv
  (gamification-detaljer — Sprint 6).
- **Blokkerende-nivå:** lavt — pilot-bruker kan håndtere kjerne-
  flytene (System-prefs, redigere familienavn, GDPR-eksport,
  slette konto). Resten er roadmap-stubs som ærlig signaliserer
  hva som kommer i hvilken sprint.
- **Midlertidig løsning:** SettingsSection + SettingsRow-pattern
  med disabled-state og badge-keys (`badge.sprint6`,
  `badge.sprint7`, `badge.requiresResend`). Pilot-feedback driver
  hvilke nye seksjoner som prioriteres. Eksisterende mockup-
  grupper (Familiemedlemmer, Familieliv, Preferanser) overlapper
  med andre skjermer eller er post-pilot scope.
- **Antatt design-grunnlag:** Card padding `--p-md`, shadow
  `--shadow-low`, divider `border-stroke`, badge-tokens fra
  PantryItem/ExpiryBadge. Footer-versjon-tekst `font-mono
  text-meta text-text-3`. Alle fra `client/src/app/styles/tokens.css`.
- **Spørsmål til design-runde:** "Skal Settings være en egen
  /v2/settings-tab i bottom-nav (vår nåværende implementasjon),
  eller en modal-overlay fra TopBar (mockup-ens valg)? Hvis tab:
  hvilken sprint-rekkefølge har de utestående mockup-gruppene
  (Tilkoblinger, Handel og butikker, Assistenten, gamification-
  detaljer)? Hvor hører Familiemedlemmer-listen hjemme — egen
  Family-tab (eksisterende) eller Settings-seksjon (mockup-valg)?
  Skal Coming soon-stubs forbli i pilot, eller fjernes så
  tomme seksjoner vises kortere? Hvilke ekstra ikoner / accent-
  farger trenger settings-rader for å matche mockup-ens visuelle
  rytme (vi har bare disabled-opacity og sprint-badge i pilot)?"
- **Status:** Pending

### Plassering (location) for pantry-items er ikke i datamodell

- **Skjerm/Kontekst:** Pantry-sub-view, gruppering av items
- **Oppdaget:** 2026-04-30, Fase 2E (Pantry sub-view) under
  backend-inventering
- **Hva mangler:** Mockupen
  `Familieassistenten.html:434-451` (`pantryData`) grupperer items
  per `loc: "Køleskap" | "Kjøkkenskap" | "Fryser"`. Backend
  `inventory`-tabellen (migration 004 + 008) har ikke et
  `location`-felt — bare `category` (Meieri, Tørrvarer & annet,
  etc.). Å legge til `location`-kolonne krever ny migrasjon med
  Portainer-oppstartsrisiko, backfill-strategi, og UI for å sette
  location ved add. Christer har valgt å bruke `category` for pilot
  (B2-bekreftelse 2026-04-30) og loggføre dette som design-gap.
- **Blokkerende-nivå:** lavt — pilot-flyt fungerer med category-
  gruppering. v1.1-vurdering når pilot-feedback har vist hvor mye
  brukerne savner location-felt.
- **Midlertidig løsning:** `usePantryData.itemsByCategory` grupperer
  per `category`-felt (samme bucketing som Shopping-skjermen). Items
  uten kategori faller under `'other'` enum-key og rendrer som
  "Annet" via `shopping:categories.other`. Header-card viser kun
  total-tall + "går tomt snart"-stats, ikke location-aggregater.
- **Antatt design-grunnlag:** Card padding `--p-4`, divider
  `border-stroke`, samme group-header-pattern som Shopping
  CategoryGroup. Ingen accent-farge per kategori i pilot.
- **Spørsmål til design-runde:** "Skal pantry gruppere per
  plassering (Kjøleskap/Kjøkkenskap/Fryser/Spisskammers) som
  mockupen viser, eller per kategori (Meieri/Tørrvarer/Frukt &
  grønt) som backend støtter? Hvis plassering: trenger vi
  database-migrasjon for `location`-kolonne. Hvis kategori: er
  pantry og handleliste konsistent gruppert? Hvilke locations
  støttes — fast enum (3-5), bruker-definert fri-tekst, eller
  bruker-valg fra forslagsliste? Skal hver location ha accent-farge
  som mockup viste (cyan/amber/mint), og hva er semantikken
  (kjølighet, posisjon, eller bruksfrekvens)?"
- **Status:** Pending
