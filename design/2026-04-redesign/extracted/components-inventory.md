# Komponent-inventar — Familieassistenten redesign (april 2026)

Kilder (to filer, samme design-språk):
- `source/Familieassistenten.html` (2845 linjer) — hovedapp, 5 skjermer + Settings.
- `source/Onboarding og Auth.html` (1639 linjer) — 7 onboarding/auth-skjermer + nav-strip.

Designet er strukturert i ~38 React-funksjons-komponenter totalt. Dette
dokumentet kategoriserer dem etter scope + dokumenterer data/props de
trenger.

**Onboarding-oppdatering (2026-04-23):** Se §11 for de 8 nye
komponentene fra `Onboarding og Auth.html` + §12 for felles auth-
UI-atomer.

---

## 1. Topp-nivå app-shell

### `App` (linje ~2656)
**Formål:** Root-komponent. Holder tab-state, settings-state, tweak-state.

**State:**
- `tweaks: {theme, accent, familyName, density, showDeviceFrame, gamification}` — lagret i `TWEAK_DEFAULTS` (editor-injected)
- `tab: 'today' | 'cal' | 'meals' | 'shop' | 'chores'` — lagres i `localStorage('fa:tab')`
- `settingsOpen: boolean`
- `tweaksOpen: boolean`
- `editMode: boolean` — claude.ai design-tool iframe-interaksjon

**postMessage-koblinger (claude.ai design-tool):**
- Lytter på `__activate_edit_mode` / `__deactivate_edit_mode`
- Sender `__edit_mode_available`, `__edit_mode_set_keys`
- **Må fjernes i produksjon** — ingen del av run-overalt-appen.

### `BottomNav` (linje ~2591)
**Formål:** Fast bunn-navigasjon med 5 tabs + mic-knapp.

**Tabs:** I dag, Kalender, Ukesmeny, Handle, Gjøremål. Aktiv tab utvides
til pille-knapp med label; inaktive vises som ikon-only.

**Props:** `tab: string, setTab: (id) => void`
**Tailwind:** `sticky bottom-0 z-30`, `tabbar glass-strong rounded-full`

### `TopBar` (linje ~490)
**Formål:** Topp-linje med dato + tema-toggle + varsel + settings-knapp.

**Props:** `onSettings, theme, setTheme`
**Ikoner:** sun/moon, bell (med red-dot-badge), settings

### `StatusBar` (linje ~2640)
**Formål:** iOS-status-bar-simulering (tid + signal + batteri).
**I produksjon:** fjernes — nettleseren gir ekte status-bar.

### `Tweaks`-panel (linje ~2785)
**Formål:** Floating panel for live tema/familie-redigering.
**I produksjon:** fjernes — dette er et claude.ai-design-verktøy.

---

## 2. Skjerm 01 — Dashboard (linje ~528)

### `Dashboard`
**Formål:** Hovedside "I dag". Hilsen + dagens hendelser + kveldens
middag + stat-grid + pantry-alerts + AI-forslag.

**Props:** `familyName, onOpenCalendar`
**Data:** `todayMealData`, `pantryLow`, `family`, `calendarEvents` (filtrert til i dag)

**Underkomponenter brukt:**
- `AgendaStrip` — horisontal agenda
- `Ring` — progress-sirkel
- `Tag` — mint/cyan chips
- `Avatar` — rund avatar-boble

### `AgendaStrip` (linje ~1650)
**Formål:** Horisontal stripe over dagens kalender-events (neste 4).

**Props:** `onExpand, dayIndex`
**Data:** filterer `calendarEvents` til `dayIndex` og tid ≥ nå

### `Ring` (linje ~511)
**Formål:** Progress-sirkel med prosent-tall.

**Props:** `value, size, stroke, color, label`
**Implementering:** SVG-circle med `strokeDasharray` + `strokeDashoffset`,
roterer -90° så starten er øverst.

### Hero meal card
Inline i `Dashboard`. Ikke separat komponent. Glass-hero med:
- Tidsangivelse + kokke-tid
- Oppskriftsnavn (Instrument Serif)
- Tag-liste (Omega-3, Glutenfri, etc.)
- Porsjons- og kalori-stables
- Progress-ring for ingredienser hjemme
- "Oppskrift →"-knapp

### Stat-grid (2×2)
- Handleliste-kort: antall igjen + estimert kostnad + fremdrift
- Husarbeid-kort: X/Y oppgaver + flame-streak + medlem-avatarer
- Pantry-lavt-kort: liste med progress-barer fargekodet etter nivå
- AI-forslag-kort: pulse-glow ikon + foreslått handling + ja/nei-knapper

---

## 3. Skjerm 02 — Kalender (linje ~1726)

### `Calendar`
**Formål:** Kalender-hovedvisning. Dag/Uke-toggle, people-filter,
day-strip, timeline.

**Props:** `initialDay, onOpenLink, onOpenSettings`
**Data:** `calendarEvents` (24 seed-events på tvers av uken)

**Underkomponenter:**
- `EventRow` (linje ~1604) — venstre-aligned time-rail, person-color strek, ikon + tittel + metadata-chips
- `EventDot`, `PersonPill` — små visuelle byggeklosser

**View-modes:** `timeline` (én dag) | `week` (alle dager gruppert)
**Integration-strip** nederst: viser "2 kalendere synket", lenke til settings.

### `NewEventModal` (linje ~1936)
**Formål:** Full-overlay bottom-sheet for å opprette ny kalenderhendelse.

**Form-felter:** tittel, dag, tid, varighet, hvem, sted, synk-destinasjon
(google/apple), påminnelse-toggle.

**UX:** Fixed overlay, klikk utenfor lukker, title autofocus, submit
disabled når tittel er tom.

### `eventKinds` mapping
Event-type → {label, Icon, color}:
meal, chore, appointment, school, pickup, birthday, delivery, work, activity, medical.

### `familyMembers` mapping
Person-navn → {name, color, shortName} for visning av PersonPill og rail-streker.

---

## 4. Skjerm 03 — Ukesmeny (linje ~750)

### `WeekMenu`
**Formål:** Ukemeny med day-strip + hero-kort for valgt dag + full uke-liste.

**State:** `active: number (0-6)` — valgt dag
**Data:** `weekMeals[]` (7 dager)

**Komponenter:**
- Day-strip (horisontal scroll) med date-rings
- Hero-kort (glass, 28px-rounded) med placeholder for foto + kalori + porsjoner + "Åpne oppskrift"-knapp
- Hele-uka-liste (klikkbar, aktiv rad har ring-mint)

**Actions:**
- "Generer manglende" — ikke implementert, skal kalle AI-forslag
- "Åpne oppskrift" — skal navigere til recipe-detail (ikke implementert i mockup)
- Favoritt-hjerte per middag

---

## 5. Skjerm 04 — Handle (linje ~1124)

### `Shopping`
**Formål:** Wrapper med segmented toggle: list | pantry.
**Props:** ingen — state lokal.

### `ShoppingList` (linje ~894)
**Formål:** Handleliste med kategori-grupper, check-toggle, kontekst-meny.

**State:**
- `data` — kategorier av items (seed fra `shoppingData`)
- `filter` — kategori-chip aktiv
- `menuOpen` — hvilken items kontekst-meny åpen
- `toast` — flyt-melding
- `unpreferred` — liste av uønskede (ingredient, recipe)

**Kontekst-meny-valg per item:**
1. "Har denne varen" → `POST /pantry` + `DELETE` fra handleliste
2. "Vil ikke ha i {recipe}" → `POST /preferences/unpreferred {ingredient, recipe}`
3. "Fjern fra listen" — bare denne gangen

**Progress-panel øverst:** ring viser % ferdig + kr-sum igjen + stor pluss-knapp.

### `Pantry` (linje ~815)
**Formål:** Pantry-view gruppert på lokasjon (Køleskap / Kjøkkenskap / Fryser).

**Data:** `pantryData` med `{loc, color, items: [{name, qty, level, exp}]}`

**Rendering:** progress-bar per item farget etter level (rød < 20%, amber < 40%,
mint >= 40%). Utløpsdato vises som chip ved siden av navn.

**Handle-knapp** vises når level < 40% → snarvei til å legge på handleliste.

### Summary-card øverst
Total antall varer, hvor mange "går tomt snart", hvor mange "med dato".

---

## 6. Skjerm 05 — Gjøremål (linje ~1247)

### `Chores`
**Formål:** Hovedkomponent for gjøremål med rolle-switcher, leaderboard,
ukesmål, dagens oppgaver, hele-uka-oversikt, achievements.

**State:**
- `list` — chores seed
- `currentUserName` — rolle-veksler for demo (Per/Lise/Ida/Mats)
- `view: 'today' | 'week'`
- `selectedDay` — valgt dag i ukesmål-grid
- `weekGoal, weekReward, rewardIcon` — redigerbart XP-mål
- `editGoal` — om rediger-panel er åpent

**Props:** `gamification: boolean` — skjuler XP/streaks/leaderboard når false

**Rolle-logikk:**
- isParent (Pappa/Mamma) kan alle operasjoner
- Barn kan toggle sine egne oppgaver men ikke tildele

### `ChoreRow` (linje ~1173)
**Formål:** Enkeltoppgave-rad med sjekkboks, tildelt person, XP-tag,
utsett-knapp, opphev-knapp (foreldre).

**Props:** `c, onToggle, onPostpone, onAssign, onOverride, showPostpone, compact, currentUser`

**Viser:**
- Sjekkboks (disabled hvis ikke canToggle)
- Avatar
- Oppgave-tekst + RecurBadge + avsender-info hvis gjort
- XP-badge
- "opphev"-knapp (kun foreldre, kun hvis en annen har merket gjort)
- "utsett"-knapp (kun dagens oppgaver)

**Assign-panel:** Klikk på navn → popup med familie-avatarer for re-assign (foreldre-only).

### `RecurBadge` (linje ~1156)
**Formål:** Liten badge som viser gjentakelses-mønster (Hele uka, Man-fre, valgte).
**Props:** `recur, days`

### `Leaderboard-grid` (inline i Chores)
4-kolonne grid over familie-medlemmer med avatar, XP-badge, streak, "leder"-krone.

### `Week-goal-panel`
Foreldre-only rediger-UI: slider 200-2500 XP + preset-knapper + belønning (emoji + tekstinput + presets).

### `Achievements`
Horisontal scroll med merker (emoji + navn + "new"-dot).

---

## 7. Skjerm 00 — Settings (linje ~2284)

### `Settings`
**Formål:** Innstillinger-skjerm (erstatter hovedvisning når åpen).

**State:** notif-toggles, voice-on, smartSuggest, weekStart, activeMember.

**Seksjoner (SettingsGroup):**
- Hjem-kort med familienavn
- Familiemedlemmer (klikkbare)
- Tilkoblinger (Google + Apple + ekstern-service)
- Handel og butikker (Kassal.app + foretrukne butikker + Oda)
- Assistenten (smarte forslag, stemme, diett, lær-assistenten)
- Familieliv (gamification-toggle)
- Varsler (middag, gjøremål, kalender, lavt)
- Preferanser (uke-start, tema, valuta)
- Konto og personvern
- Logg ut (danger)

### `SettingsGroup` (linje ~2273)
Wrapper med tittel + glass-kort med `divide-y`.

### `SettingsRow` (linje ~2249)
Rad med ikon + title + subtitle + right-slot (toggle/chevron/label).

**Props:** `icon, iconColor, title, subtitle, right, onClick, danger`

### `Toggle` (linje ~2292)
Custom switch, mint når på, stroke-strong når av.
**Props:** `on, onChange`

### `MemberDetail` (linje ~2055)
**Formål:** Detalj-skjerm for ett familiemedlem (pushes over Settings).

**State:** name, role, color, isAdmin, canAddEvents, canAddShop,
syncGoogle, syncApple, diet, dislikes.

**Seksjoner:**
- Profile-hero (stor avatar + navn + rolle + XP/streak)
- Profil (navn, rolle, farge-picker med 4 alternativer)
- Tilganger (admin, legge til events, redigere shop)
- Koblede kalendere (Google, Apple)
- **Diett og allergier** — tag-editor med 8 alternativer (Vegetar, Vegan, Glutenfri, Laktosefri, Nøtteallergi, Halal, Kosher, Skalldyrallergi)
- **Liker ikke** — fritekst + vanlige ingredienser
- Kontakt (telefon for SMS)
- Danger: fjern fra husstand

**Design-note:** Diett-listen i mockup er 8 verdier — forskjellig fra
B7-backend sin 13-verdi-liste (mer se `backend-requirements.md`).

---

## 8. Felles / utility-komponenter

### `Avatar` (linje ~465)
Rund avatar med bokstav, fargegradient basert på accent-farge, boks-skygge.
**Props:** `letter, color, size, ring`

### `Tag` (linje ~478)
Pille-tag med soft bakgrunn i accent-farge.
**Props:** `children, color, soft`

### `accentVar(c)` (linje ~458)
Helper som konverterer "mint"/"cyan"/"amber"/"coral" til `var(--mint)` etc.

### `I` (icon-bibliotek) (linje ~247)
42 inline SVG-ikoner. Se `design-system.md` §10.

### `TWEAK_DEFAULTS` / `familyMembers` / `family` / `todayMealData` / `weekMeals` / `shoppingData` / `pantryData` / `pantryLow` / `chores` / `calendarEvents` / `eventKinds` / `weekDayNames` / `weekDayShort` / `weekDates`

Alle seed-data er hardkodet i JS-kode øverst i filen. I produksjon må
disse erstattes med API-kall mot backend.

---

## 9. Komponent-tabell (sammendrag)

| Komponent | Linje | Skjerm | Props | Tailwind-sammendrag |
|---|---|---|---|---|
| `App` | 2656 | shell | — | `min-h-screen` |
| `BottomNav` | 2591 | shell | tab, setTab | `sticky bottom-0 z-30 glass-strong rounded-full` |
| `TopBar` | 490 | shell | onSettings, theme, setTheme | `flex items-center justify-between px-5 pt-6 pb-2` |
| `Dashboard` | 528 | 01 | familyName, onOpenCalendar | `px-5 space-y-5` |
| `AgendaStrip` | 1650 | 01 | onExpand, dayIndex | `glass glass-hl rounded-[22px] p-4 space-y-3 lift` |
| `Ring` | 511 | multiple | value, size, stroke, color, label | SVG |
| `WeekMenu` | 750 | 03 | — | `px-5 space-y-5` |
| `Shopping` | 1124 | 04 | — | wrapper |
| `ShoppingList` | 894 | 04 | — | `space-y-5` |
| `Pantry` | 815 | 04 | — | `space-y-5` |
| `Chores` | 1247 | 05 | gamification | `px-5 space-y-5` |
| `ChoreRow` | 1173 | 05 | c, onToggle, ... | `glass rounded-2xl p-3 flex items-center gap-3 lift` |
| `RecurBadge` | 1156 | 05 | recur, days | chip-aktig |
| `Calendar` | 1726 | 02 | initialDay, onOpenLink, onOpenSettings | `px-5 space-y-5` |
| `NewEventModal` | 1936 | 02 | defaultDay, onClose | `fixed inset-0 z-50` |
| `EventRow` | 1604 | 02 | ev, onTap, compact | `flex gap-3 py-2.5 px-2 rounded-xl` |
| `PersonPill` | 1587 | 02 | who, compact | `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full` |
| `EventDot` | 1583 | 02 | color, size | span w/ shadow |
| `Settings` | 2284 | 00 | onClose, familyName, ... | `px-5 pt-2 pb-8 space-y-5` |
| `SettingsGroup` | 2273 | 00 | title, children | `glass rounded-2xl overflow-hidden divide-y` |
| `SettingsRow` | 2249 | 00 | icon, title, subtitle, right, onClick, danger | `flex items-center gap-3 py-3 px-3 rounded-xl` |
| `Toggle` | 2292 | 00 | on, onChange | `w-[38px] h-[22px] rounded-full` |
| `MemberDetail` | 2055 | 00-sub | member, onBack, onClose | `px-5 pt-2 pb-8 space-y-5` |
| `Avatar` | 465 | felles | letter, color, size, ring | `rounded-full` |
| `Tag` | 478 | felles | children, color, soft | `rounded-full px-2.5 py-1` |
| `StatusBar` | 2640 | shell | — | fjernes i prod |
| `StatusBar`-ikoner inline |  |  | — |  |

---

## 11. Skjerm — Onboarding & Auth (ny 2026-04-23)

Kilde: `source/Onboarding og Auth.html`. 7 selv-navigerbare skjermer +
et showcase-shell. Filen bruker **samme design-tokens** som
`Familieassistenten.html` (OKLCH-farger, Instrument Serif + Geist,
glass + aurora) — hele filen er byggeklossnivå-kompatibel. Det er
IKKE en egen design-system.

**Arkitektur-rolle:** Dette er pre-app-skjermene (før bruker er
innlogget + før fresh-install er konfigurert). De bor utenfor
bottom-nav og har ingen relasjon til familiedata. Når bruker er
autentisert og familie finnes, navigeres det til hovedappens
`/v2/today` via `window.location.href` (fra mockupens perspektiv).

### 11.1 `ScreenWelcome` (linje ~376-447)
**Formål:** Landing/splash-skjerm. Brand + hero + feature-teaser +
primære CTA-er.

**Props:** `goto(screen: string)`

**Oppbygning:**
- `<Logo/>` i topp-venstre + `<ThemeToggle/>` i topp-høyre
- Slide-up animasjon på hero-seksjonen
- Sparkle-badge ("Nytt · Laget for hele familien")
- Display-headline med italic mint→cyan-gradient på ordet "harmoni"
- 2×2 feature-grid: `{icon, color, label}` for Ukesmeny/Handleliste/Kalender/Gjøremål
- Primær CTA: "Opprett konto →"
- Sekundær CTA: "Jeg har en konto"
- Footer-tekst: "Self-host med Docker. Åpen kildekode. Dine data, din hage."

**Tailwind/klasser:** `PageShell`, `glass glass-hl rounded-2xl`,
`font-display text-[44px] sm:text-[56px]`, `btn-primary`, `btn-ghost`.

### 11.2 `ScreenLogin` (linje ~464-592)
**Formål:** Innlogging med dynamisk provider-liste. Adresserer
låst beslutning D3 (feature-gating via `/api/config/features`).

**Props:** `goto(screen, payload)`, `availableProviders: ('google' | 'email' | 'console')[]`

**State:**
- `email: string`
- `sending: null | 'google' | 'email' | 'console'`

**Dynamisk rendering:** `providers.includes('google')`,
`providers.includes('email')`, `providers.includes('console')`
kontrollerer hvilke `ProviderCard`-er som vises. Dette matcher direkte
D3-beslutningen og arkitektur-hull 3.1.

**UX-detaljer:**
- Enter-key på email-felt sender magic-link
- Spinner-badge mens `sending !== null`
- Google går rett til `today` (OAuth simulert); email/console går til `magic-sent`
- Divider mellom Google-knappen og email/console-kortene (kun hvis begge har providers)

**Beslutning for implementering:** `ProviderCard` bør bygges som
**gjenbrukbar komponent** (se §11.8). I mockupen er de re-instansiert
inline; produksjons-React bør abstrahere en `ProviderCard`-komponent
med props `{icon, color, label, subtitle, badge?, onClick, loading}`.

### 11.3 `ScreenSignup1` (linje ~602-690)
**Formål:** Opprett-konto steg 1 av 2 — om familien.

**Props:** `goto`, `formData`, `setFormData`

**Form-felter:**
- Familie-navn (required, min-2-tegn)
- Tidssone (select, 6 valg: Oslo, Stockholm, København, Helsinki, London, UTC)
- Språk (2-button grid: NO/EN med flagg-emoji)

**Komponenter brukt:** `<ProgressDots total={2} active={0}/>`,
`<Field label ... hint ... required/>` med `<I.globe/>`-ikon-overlay på select.

**Validation:** Disabled "Fortsett"-knapp til `family.trim().length >= 2`.

### 11.4 `ScreenSignup2` (linje ~700-811)
**Formål:** Opprett-konto steg 2 av 2 — om admin-brukeren.

**Props:** `goto`, `formData`, `setFormData`

**Form-felter:**
- Navn (required, min-2-tegn)
- Rolle (3-valg stacked cards: Voksen/Ungdom/Barn)
- E-post (required, regex-validert)
- Porsjons-faktor (range-slider 0.5-1.5 steg 0.1, mono-tall-display `×1.0`)

**Komponenter:** `<ProgressDots total={2} active={1}/>`, role-picker
er inline (3 knapp-kort med ikon + navn + subtitle + check når aktiv),
`<Field>`-wrapper rundt alt.

**Slider-pattern:** Egen "slider-med-verdi-til-høyre"-komponent kan
abstraheres for gjenbruk. Viser enhetsløs faktor (×1.0, ×1.2), skalar
for mengde-beregning på ukesmeny og handleliste.

**Etter klikk "Opprett familie":** simulert `setTimeout(400ms) → goto('today')`.
I prod: `POST /api/onboarding/setup` (se §11 i `backend-requirements.md`).

### 11.5 `ScreenBootstrap` (linje ~821-1163)
**Formål:** Fresh-install wizard for self-host. 5 trinn: Velkommen →
SESSION_SECRET → Provider → Konfig → Admin.

**Props:** `goto`, `formData`, `setFormData`

**State:**
- `step: 0..4`
- `secret: string` (48-tegn auto-generert med trimmet alfabet)
- `secretMode: 'auto' | 'custom'`
- `customSecret: string`
- `copied: boolean` (flyktig visual-state etter clipboard-write)
- `provider: 'console' | 'email' | 'google'`
- `resendKey, googleClientId, googleSecret: string`
- `showGoogleSecret: boolean` (eye/eyeOff toggle)

**Underkomponenter per step:**
- Step 0: Introduksjon — 3 nummererte kort (SESSION_SECRET / Auth-provider / Første bruker)
- Step 1: `SecretGeneratorField` (se §11.9) — tabs auto/custom, terminal-stylet display, refresh-knapp, copy-knapp, shield-note om .env-lagring
- Step 2: 3 provider-valg-kort med badges ("Enklest", "Krever Resend", "Avansert") — samme visuelle mønster som `ProviderCard` men inline her
- Step 3: `ConditionalConfigPanel` (se §11.10) — per-provider form (console=kun info, email=Resend-nøkkel + avsender-email, google=client-id + secret med eye-toggle)
- Step 4: Oppsummerings-kort med 3 `<Row>`-rader (SESSION_SECRET, Auth-provider, Status)

**Navigasjon:**
- `next()` på step 4: `goto('signup-1')` med `formData.selfHost=true`
- `back()` på step 0: `goto('welcome')`
- Disabled "Fortsett" avhenger av `secretOk` (step 1) og `providerOk` (step 3)

**CLI-fallback:** Inline `.term`-blokk viser docker-logs-eksempel for
console-provider:
```
# docker logs familieassistenten -f
[2026-04-23 17:04:21] INFO Magic link for you@home.lan:
  https://family.local/auth/magic?t=a7f...
```

### 11.6 `ScreenMagicSent` (linje ~1188-1293)
**Formål:** Bekreftelse etter magic-link er sendt. To modus: email
eller console (self-host).

**Props:** `goto`, `linkPayload: { email, kind }`

**State:**
- `resent: boolean` (flash ved re-send)
- `seconds: number` (30-sek countdown)

**Visuelle hovedelementer:**
- Stor sirkel-ikon (96px) med gradient mint→cyan + `soft-pulse`-animasjon
- Liten check-badge i top-høyre corner (mint-fyll)
- Titler som mappes på `kind`:
  - email: "Sjekk e-posten din"
  - console: "Sjekk server-loggen"
- Terminal-blokk med docker logs-eksempel (kun console-modus)
- Hint-kort om 10-min gyldighet (kun email)

**Re-send-logikk:**
- 30-sekunders countdown (`setTimeout(setSeconds, 1000)` pattern)
- Disabled knapp til `seconds === 0`
- `resent=true` i 1.6s etter klikk (grønn check-indikasjon)

### 11.7 `ScreenError` (linje ~1303-1446)
**Formål:** Feilside med 3 varianter — offline, server (503), unknown (500).

**Props:** `goto`, `variant: 'offline' | 'server' | 'unknown'`

**State:**
- `localVariant: 'offline' | 'server' | 'unknown'` (kan overstyres via dev-switcher nederst)
- `retrying: boolean`

**Variant-map:**
| Variant | Farge | Ikon | Kode | Tittel | Debug-info |
|---|---|---|---|---|---|
| offline | amber | wifi | ERR_NET | Ingen nettforbindelse | (skjult) |
| server | coral | server | 503 | Serveren svarer ikke | `request_id: 7f3a2b · service unavailable` |
| unknown | rose | alert | 500 | Noe gikk skeivt | `trace_id: 9c1e...2f · see server logs` |

**Visuelle elementer:**
- Stor rounded-kvadrat-boks (112×112) med `wobble`-animasjon
- Error-kode-badge i bunn-høyre corner (ink-bakgrunn + mono-font)
- Status-chip (variant-farge)
- Display-headline + beskrivelse
- Debug-info i `glass`-kort (skjules for offline)
- "Prøv igjen"-primary-button (800ms spinner → `goto('today')`)
- Footer-lenker: "Rapporter problem" + "Til forsiden"

**Dev-tool:** "Forhåndsvis variant"-segment-knapp-rad nederst — **SKAL
fjernes i produksjon.** Brukes kun i showcase-miljøet.

### 11.8 `ProviderCard` (avledes fra `ScreenLogin`/`ScreenBootstrap`)
**Formål:** Knapp-kort for én auth-provider (Google, email, console, osv.).

**Anbefalt props (når abstrahert):**
```typescript
type ProviderCardProps = {
  icon: ReactNode;           // <I.google/> etc.
  color: CSSProperty;        // 'var(--mint)' | 'var(--cyan)' | 'var(--amber)'
  label: string;             // 'Fortsett med Google'
  subtitle?: string;         // 'Rask og sikker innlogging'
  badge?: string;            // 'self-host', 'Enklest', 'Krever Resend'
  loading?: boolean;         // rendrer spinner i stedet for arrow
  onClick: () => void;
  disabled?: boolean;        // for providers som ikke er tilgjengelige ("kommer senere")
};
```

**Tailwind-pattern (mockup-inline):**
```
glass glass-hl rounded-2xl p-4 w-full flex items-center gap-3 text-start lift
+ indre 10×10 ikon-boks med color-mix-bakgrunn i provider-farge
+ 14px label + 11.5px subtitle (text-3)
+ arrow (text-3) eller spinner-div
```

**Varianter:**
- Aktiv uten innhold: ren `glass`-bakgrunn + hover-lift
- Med form (email): `glass glass-hl` som wrapper, indre input + submit
- "Coming soon" (Apple senere per D2): rendres med `disabled={true}` og overstyrt `subtitle: 'Kommer senere'`

### 11.9 `SecretGeneratorField` (linje ~934-995)
**Formål:** Auto-generer SESSION_SECRET på 48 tegn + gi copy-knapp +
alternativ "paste egen".

**State:**
- `secretMode: 'auto' | 'custom'` (tab-toggle)
- `secret: string` (48-tegn fra trimmet alfabet som utelater `iloI0O`)
- `customSecret: string` (for manual paste, min 16 tegn)
- `copied: boolean` (flash i 1.4s etter write)

**Alfabet for auto-gen:**
```
'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
// 54 tegn, ambigiøse (0/O/o, 1/l/I) utelatt for copy-paste-vennlighet
```

**Visuelle deler:**
- Tabs `[Generer automatisk | Paste egen]` som glass-pill
- Auto-modus: `.term` (mono terminal-styling) med secret + copy-button (top-høyre) + "Generer ny"-lenke under
- Custom-modus: `<textarea>` i `.field`-stil, character-counter (mint når ≥16, text-3 ellers)
- Info-boks: shield-ikon + ".env-lagres automatisk"-melding

**Implementerings-kompleksitet:** Copy-knappen bruker
`navigator.clipboard.writeText()` med try/catch (fallback hvis ikke
støttet). Håndter Safari-rettigheter.

### 11.10 `ConditionalConfigPanel` (linje ~1047-1119)
**Formål:** Provider-spesifikk konfigurasjons-form i bootstrap-wizard.
Rendrer én av tre distinkte former basert på valgt provider.

**Underliggende komponent:** ingen felles wrapper i mockupen — det er
rene `provider === 'x' && (…)`-betingelser. Anbefaling for prod: én
`<ProviderConfigForm provider={p}/>`-komponent som switch'er på `provider`.

**Varianter:**
- `provider === 'console'`: informativ — terminal-blokk med logg-eksempel
  + amber advarsel-kort ("Ikke bruk console-provider hvis appen er
  eksponert på internett")
- `provider === 'email'`: form med 2 felter — Resend API-key
  (password-type, mono-font, link til `resend.com/api-keys`) + avsender-
  email
- `provider === 'google'`: form med 3 felter — Client ID, Client Secret
  (med eye/eyeOff-toggle), redirect-URI (read-only `.term`-blokk med
  kopier-hint for Cloud Console)

**Validation:**
- console: alltid OK
- email: `resendKey.length >= 10`
- google: `googleClientId && googleSecret`

Disse sjekkene drives av `providerOk`-verdi i `ScreenBootstrap`.

### 11.11 `ProviderTweakMenu` (linje ~1585-1612) — **DEV-ONLY**
**Formål:** Flytende meny i nav-strip som lar designeren simulere
ulike deploys. Slår av/på Google/email/console providers i `ScreenLogin`.

**Rolle i produksjon:** **Skal fjernes.** Dette er en design-tool-
feature som gir deg live-preview av hvordan Login-skjermen ser ut med
ulike provider-kombinasjoner. I prod skal `availableProviders` komme
fra `GET /api/config/features`.

**Mekanisme:** Checkboks per provider (`google`, `email`, `console`).
Updaterer `providers`-state i `App`-komponenten. `ScreenLogin` leser
state via props.

### 11.12 `StepProgressIndicator` (abstrahering av `ProgressDots`)
**Formål:** Visuell progressjon i multi-step flows (signup 1-2, bootstrap 0-4).

**Eksisterende implementering:** `ProgressDots({total, active})`
renderer `total` punkter der `active` er mint-pill, `< active` er
mint-deep, øvrige er stroke-strong-prikk.

**Anbefalt utvidelse:**
```typescript
type StepProgressIndicatorProps = {
  total: number;
  active: number;        // 0-indeksert
  variant?: 'dots' | 'segments';   // segments = tykkere horisontale striper
  labels?: string[];     // valgfri — hover/screen-reader-støtte
};
```

Brukes allerede i `ScreenSignup1`/`ScreenSignup2`/`ScreenBootstrap`.
Alle steder bruker dots-varianten. Segments-varianten er forslag for
fremtiden hvis stepping blir mer komplekst.

---

## 12. Felles auth-UI-atomer (fra `Onboarding og Auth.html`)

Disse er rene UI-byggeklosser brukt på tvers av 11.1–11.7. De skal
bygges som separate komponenter i Fase 1b-produksjonen:

### `PageShell` (linje ~363-371)
Wrapper som gir min-høyde (760px fra mockup — bør revurderes for mobil
responsivitet) + vertikal flex-layout + padding. Alle 7 skjermer starter
med `<PageShell>`-rooten.

**Props:** `children`, `compact?:boolean`, `maxW?:string` (default `max-w-[440px]`)

### `Field` (linje ~346-361)
Form-field-wrapper med label, hint, feilmelding.

**Props:** `label, hint?, children, required?, error?`

**Struktur:**
- Label-rad: uppercase text-3 (11.5px tracking-0.14em) + eventuelt hint til høyre
- Children slot (input/select/textarea/custom)
- Error-footer: coral-tekst med alert-ikon, kun hvis `error` satt

**CSS-klasser som styles inputene:** `.field` (se `design-system.md`
§12 nye tokens).

### `Toggle` (linje ~299-317)
Custom switch — duplikat av `Toggle` fra `Familieassistenten.html`
med ørlite andre dimensjoner (42×24 vs 38×22). Bør konsolideres.

### `ThemeToggle` / `ThemeSwitch` (linje ~319-334 / ~1620-1633)
To varianter av samme komponent. `ThemeToggle` er "plain" (brukes i
skjerm-header); `ThemeSwitch` er nav-strip-variant med lagring i
localStorage. Begge bruker `document.documentElement.setAttribute('data-theme', ...)`-
mekanismen.

**Produksjon:** én `<ThemeToggle/>`-komponent som wrapper
`useTheme()`-hook (beskrevet i `user-preferences-fit.md`).

### `Logo` (linje ~289-294)
Wordmark-komponent. Viser SVG-logo + "Familieassistenten" i
Instrument Serif. `<Logo size={32}/>` default.

### `Row` (linje ~1165-1178)
Generisk 3-kolonne-rad brukt i wizard step 4 oppsummering. Ikon-kvadrat
+ label-text-2 + value-mono-text-1. Tabellen er rendret som en liste
av `<Row>`-komponenter.

**Props:** `icon: IconComponent, label, value, color`

### `ScreenStrip` (linje ~1551-1618) — **DEV-ONLY**
Showcase-navigasjonsstripe med alle 13 skjermer + provider-tweak-meny
+ theme-switch. **Skal fjernes i produksjon.**

---

## 13. Komponent-tabell (sammendrag — oppdatert med onboarding)

Onboarding-komponentene legges til her i tillegg til §9-tabellen:

| Komponent | Kilde · linje | Skjerm | Props | Tailwind-sammendrag |
|---|---|---|---|---|
| `ScreenWelcome` | Onb · 376 | 01 | goto | `PageShell` · slide-up hero · 2×2 grid |
| `ScreenLogin` | Onb · 464 | 02 | goto, availableProviders | dynamisk providers-rendering |
| `ScreenSignup1` | Onb · 602 | 03 | goto, formData, setFormData | `ProgressDots` + 3 Field |
| `ScreenSignup2` | Onb · 700 | 04 | goto, formData, setFormData | `ProgressDots` + 4 Field + slider |
| `ScreenBootstrap` | Onb · 821 | 05 | goto, formData, setFormData | 5-step switch · conditional |
| `ScreenMagicSent` | Onb · 1188 | 06 | goto, linkPayload | `soft-pulse` stor sirkel |
| `ScreenError` | Onb · 1303 | 07 | goto, variant | 3 varianter + dev switcher |
| `ProviderCard` | (abstraksjon) | 02, 05 | icon, color, label, subtitle, badge?, loading?, onClick, disabled? | `glass glass-hl rounded-2xl p-4 flex items-center gap-3 lift` |
| `SecretGeneratorField` | Onb · 934 | 05 | — (self-contained) | `.term` + `.field` + tabs |
| `ConditionalConfigPanel` | Onb · 1047 | 05 | provider | per-variant switch |
| `MagicLinkSentConfirmation` | Onb · 1188 | (alias for ScreenMagicSent) | — | soft-pulse |
| `ErrorStateVariants` | Onb · 1303 | (alias for ScreenError) | — | wobble |
| `ProgressDots`/`StepProgressIndicator` | Onb · 336 | 03, 04, 05 | total, active | `.pdot` + `.pdot.active` + `.pdot.done` |
| `Field` | Onb · 346 | alle | label, hint, children, required, error | label + children slot |
| `PageShell` | Onb · 363 | alle | children, compact?, maxW? | flex-col min-h padding |
| `Logo` | Onb · 289 | alle | size? | inline-flex SVG + display-name |
| `Row` | Onb · 1165 | 05 | icon, label, value, color | 3-kol flex |
| `ProviderTweakMenu` | Onb · 1585 | strip | providers, setProviders | **DEV-ONLY** |
| `ScreenStrip` | Onb · 1551 | (shell) | current, onSelect, providers, setProviders | **DEV-ONLY** |

---

## 14. Tekniske observasjoner

- **Inline Babel-transpilation:** `<script type="text/babel">` — kjører
  JSX i nettleseren via `@babel/standalone`. **Må bygges før prod** —
  egen Vite/webpack-pipeline.
- **Tailwind CDN:** `cdn.tailwindcss.com` — **må byttes til postcss-build**
  med `tailwindcss` som devdependency for produksjon. Nåværende prosjekt
  bruker IKKE tailwind; full stack-bytte nødvendig.
- **React 18.3.1 UMD:** skal erstattes med modul-import når bygget.
- **Skisse-nivå:** all state lokal, ingen API-kall, ingen fetch,
  ingen error-håndtering, ingen loading-states. Må bygges fra null for
  hver skjerm.
- **Inline-styles med `style={...}`:** utbredt. Produksjons-anbefaling:
  erstatt med Tailwind-utility eller CSS-moduler for å unngå inline
  specificity-problemer.
- **Modulær oppdeling:** filen er én stor fil. Anbefalt oppdeling:
  ```
  src/
    screens/
      Dashboard.tsx
      Calendar.tsx
      WeekMenu.tsx
      Shopping.tsx
      Chores.tsx
      Settings.tsx
    components/
      Avatar.tsx
      Ring.tsx
      Tag.tsx
      EventRow.tsx
      ChoreRow.tsx
      Toggle.tsx
      ...
    design/
      tokens.css
      icons.tsx
    hooks/
      useFamilyData.ts
      useAuth.ts
    ...
  ```
