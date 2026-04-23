# Komponent-inventar — Familieassistenten redesign (april 2026)

Kilde: `source/Familieassistenten.html` (2845 linjer, én fil). Designet
er strukturert i ~30 React-funksjons-komponenter. Dette dokumentet
kategoriserer dem etter scope + dokumenterer data/props de trenger.

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

## 10. Tekniske observasjoner

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
