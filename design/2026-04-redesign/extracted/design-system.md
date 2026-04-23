# Design-system — Familieassistenten redesign (april 2026)

Kilder (to filer, samme design-system):
- `source/Familieassistenten.html` (2845 linjer) — hovedapp.
- `source/Onboarding og Auth.html` (1639 linjer) — 7 onboarding/auth-
  skjermer, lagt til 2026-04-23. Tokens er **identiske** med hovedfilen
  (OKLCH-farger, Instrument Serif + Geist, aurora + glass) pluss et
  knippe auth-spesifikke utvidelser (se §14). Alt skal kunne bygges med
  samme `tokens.css` i produksjon.

Dette dokumentet ekstraherer designtokenene slik at implementering i
produksjon-stack (Vite + Tailwind v3 + React 18 + TypeScript, låst
per D6) kan matche det visuelle uttrykket 1:1.

---

## 🔒 Låste beslutninger relevant for design-systemet

Fra Christers gjennomgang 2026-04-23:

- **v1 leverer:** light + dark mode (begge)
- **Color blind-tema:** utsatt, men arkitektur må støtte flere temaer
  senere uten omskriving (token-basert + data-theme-attribute-drevet)
- **Tokens er ekstenderbare:** ikke hardkod to-valg; bygg som liste
  tema-navn slik at `blue-accessible`, `high-contrast`, `purple-neon`,
  osv. kan legges til via CSS-import i senere faser
- **Toolchain:** Vite + Tailwind v3 + React 18 + TypeScript (strict)
- **Tailwind-config** bruker CSS custom properties (ikke hardkodede
  Tailwind-farger) slik at tema-bytter fungerer i runtime uten
  rebuild
- **Ingen kcal-felt i v1** — fjernes fra mockup-implementering

---

## 1. Fargepalett

**Fargerom:** OKLCH (CSS Color Module Level 4). Krever moderne nettlesere
(Safari 15.4+, Chrome 111+, Firefox 113+). For nettlesere uten OKLCH-støtte
må en build-prosess compilere til rgb-fallbacks.

### Dark mode (default) — `--data-theme="dark"`

| Token | Verdi | Bruk |
|---|---|---|
| `--bg-0` | `oklch(0.16 0.015 95)` | App-bakgrunn (varm off-black) |
| `--bg-1` | `oklch(0.20 0.018 95)` | Svakt løftede seksjoner |
| `--bg-2` | `oklch(0.24 0.02 95)` | Striped placeholder, hvile-kort |
| `--surface` | `oklch(0.24 0.018 95 / 0.55)` | Glass-kort default |
| `--surface-strong` | `oklch(0.28 0.02 95 / 0.72)` | Valgte/aktive glass-kort |
| `--stroke` | `oklch(1 0 0 / 0.08)` | Subtil kant |
| `--stroke-strong` | `oklch(1 0 0 / 0.14)` | Markert kant |
| `--text-1` | `oklch(0.97 0.01 85)` | Primær tekst (cream) |
| `--text-2` | `oklch(0.78 0.015 85)` | Sekundær tekst |
| `--text-3` | `oklch(0.58 0.015 85)` | Tertiær tekst / metadata |

### Light mode — `--data-theme="light"`

| Token | Verdi |
|---|---|
| `--bg-0` | `oklch(0.97 0.008 85)` |
| `--bg-1` | `oklch(0.99 0.005 85)` |
| `--bg-2` | `oklch(0.94 0.01 85)` |
| `--surface` | `oklch(1 0 0 / 0.72)` |
| `--surface-strong` | `oklch(1 0 0 / 0.88)` |
| `--stroke` | `oklch(0 0 0 / 0.06)` |
| `--stroke-strong` | `oklch(0 0 0 / 0.12)` |
| `--text-1` | `oklch(0.22 0.02 85)` |
| `--text-2` | `oklch(0.42 0.02 85)` |
| `--text-3` | `oklch(0.58 0.015 85)` |

### Accent-farger (justeres mellom dark/light)

| Token | Dark | Light | Semantikk |
|---|---|---|---|
| `--mint` | `oklch(0.82 0.15 155)` | `oklch(0.58 0.14 155)` | Primær accent · mat · success · XP-gradient |
| `--mint-deep` | `oklch(0.55 0.14 155)` | `oklch(0.45 0.13 155)` | Sekundær mint (gradient-bunn) |
| `--cyan` | `oklch(0.82 0.12 215)` | `oklch(0.60 0.11 215)` | Info · sekundær info · XP-gradient topp |
| `--cyan-deep` | `oklch(0.55 0.11 215)` | `oklch(0.48 0.10 215)` | Gradient-bunn |
| `--amber` | `oklch(0.82 0.13 75)` | `oklch(0.68 0.14 75)` | Streaks · advarsel · middels-risiko |
| `--coral` | `oklch(0.78 0.14 25)` | `oklch(0.62 0.16 25)` | Fare · høy risiko · notifikasjon-prikk |

### Familiemedlem-farger (tilfeldig allokert)

Hvert medlem får én av fire accent-farger. Fargekoden defineres i
`familyMembers`-objektet og brukes konsekvent for avatar-bakgrunn,
rad-streker og chips. Brukeren kan overstyre farge i Settings → medlem-
detaljer (4 alternativer: mint, cyan, amber, coral).

---

## 2. Typografi

Tre Google Fonts lastes via `<link>`:

| Font-familie | Bruk | Vekter |
|---|---|---|
| **Instrument Serif** | Display / overskrifter (`.font-display`) | 400, 400 italic |
| **Geist** | UI-tekst (default på body) | 300, 400, 500, 600, 700 |
| **Geist Mono** | Tall / metadata / inline-kode (`.font-mono`) | 400, 500 |

**Font-stack fallbacks:**
- Display: `'Instrument Serif', ui-serif, Georgia, serif`
- Body: `'Geist', ui-sans-serif, system-ui, sans-serif`
- Mono: `'Geist Mono', ui-monospace, monospace`

**Font-features:** `font-feature-settings: "ss01","cv11"` (Geist-
stylistiske alternativer).

### Type-skala (ekstrahert fra `font-display`-bruk)

| Kontekst | Størrelse | Klasse i kilde | Font |
|---|---|---|---|
| Hero greeting | 40px, line-height 1.05 | `font-display text-[40px]` | Instrument Serif |
| Screen-title | 34px, leading-tight | `font-display text-[34px]` | Instrument Serif |
| Hero meal title | 28px | `font-display text-[28px]` | Instrument Serif |
| Card title | 26px | `font-display text-[26px]` | Instrument Serif |
| Day number | 20-22px | `font-display text-[20px]`/`[22px]` | Instrument Serif |
| Body | 13-14px | (default) | Geist |
| Metadata | 11px | `text-[11px]` | Geist |
| Micro-label (uppercase) | 10-10.5px, `tracking-[0.18em]` | various | Geist |
| Mono-tall | 11-13px | `font-mono` | Geist Mono |

### Letter-spacing / tracking

- `tracking-[0.18em]` — uppercase micro-labels
- `tracking-[0.22em]` — hero section-labels
- `letter-spacing: -0.01em` — display (Instrument Serif)

---

## 3. Spacing-skala

Følger Tailwinds default 4px-enhet (`1 = 4px`). Vanlige verdier fra
kildekoden:

- **Page padding:** `px-5` (20px) horizontal, varierer vertikalt
- **Card-padding:** `p-3` (12px) små, `p-4` (16px) standard, `p-5` (20px) hero
- **Mellomrom mellom seksjoner:** `space-y-5` (20px)
- **Mellomrom i liste:** `space-y-2` (8px), `space-y-2.5` (10px)
- **Gap i flex/grid:** `gap-2`, `gap-3`, `gap-4`

---

## 4. Border-radius

| Kontekst | Radius |
|---|---|
| Hero-kort | `rounded-[28px]` (28px) |
| Standard kort | `rounded-2xl` (16px) |
| Mid-kort | `rounded-[22px]`/`rounded-[24px]` |
| Små kort / knapper | `rounded-xl` (12px) |
| Chips / pills | `rounded-full` |
| Tall-labels | `rounded-md` (6px) |
| Avatar | `rounded-full` |
| Device frame | `rounded-[44px]` padded wrapper + `rounded-[36px]` inner screen |

---

## 5. Shadows / glow

Subtile shadows + glow-effekter (neon-accent):

| Token | Verdi | Bruk |
|---|---|---|
| `--shadow-glow` | `0 0 60px -12px oklch(0.82 0.15 155 / 0.35)` | Hero meal card (dark) |
| `.ring-mint` | `box-shadow: 0 0 0 1px oklch(0.82 0.15 155 / 0.35), 0 0 40px -10px oklch(0.82 0.15 155 / 0.4)` | Aktive kort |
| `.ring-cyan` | tilsvarende med cyan | Sekundær highlight |

Light mode bytter `--shadow-glow` til mer dempet `0 20px 50px -20px` uten glow-spread.

### Elevation-shadow (device frame, modaler)

- Device frame: `0 40px 80px -20px oklch(0 0 0 / 0.6)` + `0 0 0 1px oklch(1 0 0 / 0.06)`
- Context-menu (dropdown): `0 20px 50px -10px oklch(0 0 0 / 0.5)`
- Toast: `0 12px 30px -8px oklch(0 0 0 / 0.5)`

---

## 6. Glassmorphism

Tre glass-varianter:

```css
.glass {
  background: var(--surface);                 /* 0.55 alpha */
  border: 1px solid var(--stroke);
  backdrop-filter: blur(24px) saturate(140%);
}

.glass-strong {
  background: var(--surface-strong);          /* 0.72 alpha */
  border: 1px solid var(--stroke-strong);
  backdrop-filter: blur(32px) saturate(160%);
}

.glass-hl {
  /* pseudo-element gir topp-highlight */
  ::before { background: linear-gradient(180deg, oklch(1 0 0 / 0.06), transparent 40%); }
}

.tabbar { backdrop-filter: blur(28px) saturate(160%); }
```

**Merk:** `backdrop-filter` krever `-webkit-backdrop-filter` for Safari.
Safari < 9 støtter det ikke — for "selvhost"-familier på eldre enheter
vil glass fallback til semi-transparent uten blur (akseptabel
degradering).

---

## 7. Aurora-bakgrunn

Globalt bakgrunns-element (én per app-shell):

```css
.aurora::before {
  width: 560px; height: 560px;
  background: radial-gradient(circle, var(--mint) 0%, transparent 60%);
  filter: blur(80px); opacity: 0.55;
  top: -120px; left: -100px;
}
.aurora::after {
  width: 620px; height: 620px;
  background: radial-gradient(circle, var(--cyan) 0%, transparent 60%);
  bottom: -160px; right: -120px;
  opacity: 0.40;
}
```

Light mode demper opacity til 0.28 / 0.22.

---

## 8. Animasjons-tokens

### Definerte keyframes

```css
@keyframes pulseGlow {
  0%,100% { box-shadow: 0 0 0 0 oklch(0.82 0.15 155 / 0.5); }
  50%     { box-shadow: 0 0 0 8px oklch(0.82 0.15 155 / 0); }
}
.pulse-glow { animation: pulseGlow 2.4s ease-out infinite; }

@keyframes lineThrough {
  from { background-size: 0% 1px; }
  to   { background-size: 100% 1px; }
}
.bought-text {
  background-image: linear-gradient(currentColor, currentColor);
  animation: lineThrough .35s ease forwards;
  opacity: 0.45;
}
```

### Transitions

- Hover-lift: `transform .25s ease, box-shadow .25s ease` (klassen `.lift`,
  `translateY(-2px)` på hover)
- Toggles, chips, checkboxes: `transition: all .2s ease`
- Tab-bytter: implementert via state-change (ingen eksplisitt transition)

---

## 9. Custom komponenter / visuelle byggeklosser

| Komponent | CSS-klasse | Beskrivelse |
|---|---|---|
| Sjekkboks | `.chk`, `.chk.on` | 22×22, mint-gradient når på, glow-shadow |
| Progress ring | `.ring-track`, `.ring-progress` | SVG med drop-shadow-glow |
| Flame-gradient tekst | `.flame-grad` | amber→coral lineær bg-clip |
| Chip (filter) | `.chip`, `.chip.active` | 999-radius, subtil bg når aktiv |
| XP-bar fill | `.xp-fill` | mint→cyan lineær med glow |
| Striped placeholder | `.ph-stripes` | diagonal streker for meal-card placeholder |
| Scrollbar | `::-webkit-scrollbar` | 8px, transparent track, stroke-strong thumb |
| Hide-scrollbar | `.no-scrollbar` | for horisontal day-strips |
| Focus-ring | `outline: 2px solid var(--mint); outline-offset: 2px` | a11y-focus |

---

## 10. Ikonsystem

**Inline SVG (42 ikoner)** definert i objektet `I` i kildens linje 247.
Style: `stroke="currentColor"` + `strokeWidth="1.7"` (thin-lined),
`strokeLinecap="round"`, `strokeLinejoin="round"`.

Unntak: `I.flame`, `I.bolt`, `I.heart` bruker `fill="currentColor"`
(solide). `I.google` og `I.apple` er merkevare-ikoner med eksakte
farger.

**Ikoner som brukes:**
home, utensils, cart, sparkles, broom, settings, mic, plus, close, check,
chevron, clock, flame, trophy, bell, sun, moon, search, fridge, heart,
calendar, bolt, car, cake, briefcase, activity, book, medical, package,
google, apple, school, link.

**Produksjons-anbefaling:** erstatt inline SVG med `lucide-react` eller
`heroicons` — disse har tilsvarende tynn-linje-stil og tre-shakeable
imports. `google` og `apple` beholdes som custom SVG (varemerker).

---

## 11. Responsive breakpoints

| Breakpoint | Layout |
|---|---|
| `< md` (< 768px) | Fullscreen mobil-view, bottom-nav synlig |
| `>= md` (>= 768px) | Tre-spalts desktop-layout: info · mobil-ramme · skjerm-oversikt |

Desktop-visningen pakker mobil-viewet inn i en `.device-frame` med
hardkodet bredde (`400px`) og høyde (`820px`). Dette er et *design-tool*-
oppsett for presentasjon — i produksjon må denne fjernes og appen må
være responsiv for tablet/desktop (CSS grid + media queries).

**Nåværende app (`public/*`)** er primært mobil-first og bruker
`max-width`-container uten device-frame. Redesignet må fjerne frame-
delen og bygge en ekte responsiv layout i produksjon.

---

## 12. Tema-arkitektur (v1: light + dark, utvidbar)

Aktiveres via `document.documentElement.setAttribute("data-theme", <themeName>)`.
All tokens er CSS custom properties som bytter ved `[data-theme="<name>"]`-
selector. Tailwind `dark:`-klasser brukes IKKE — dette er et bevisst
valg for å holde tokens sentralisert og la flere enn to temaer
sameksistere.

**V1 temaer:** `dark` (default), `light`.

**Arkitektur for utvidelse (uten omskriving):**

```css
/* design/tokens/themes/dark.css */
html[data-theme="dark"] { --bg-0: ...; --mint: ...; /* etc */ }

/* design/tokens/themes/light.css */
html[data-theme="light"] { --bg-0: ...; /* etc */ }

/* Fremtidig — laste inn kun hvis bruker velger eller accessibility-flag */
/* design/tokens/themes/color-blind-protanopia.css */
html[data-theme="color-blind-protanopia"] { /* deut-trygge aksenter */ }

/* design/tokens/themes/high-contrast.css */
html[data-theme="high-contrast"] { /* WCAG AAA kontrast-nivåer */ }
```

**Implementerings-detaljer v1:**

1. Temavalg lagres i `localStorage('fa:theme')` + eksponeres via
   `GET /api/user/preferences`-endpoint senere (ikke v1).
2. Respekter `prefers-color-scheme` ved første-last hvis ingen lagret
   verdi.
3. Theme-switcher i app-shell returnerer en **liste** av tilgjengelige
   temaer, ikke en boolsk `dark?:true/false`. Dette holder utvidbarheten
   synlig i UI-kontrakten.
4. Settings-skjermen (v1) viser kun "Lys"/"Mørk"-valg; utvidelse til
   color-blind modus krever kun å legge til CSS-fil + utvide drop-down,
   ikke refaktorere komponent.

```typescript
// client/src/hooks/useTheme.ts (v1-skisse)
type ThemeId = 'light' | 'dark';  // union utvides når nye themes legges til

export const availableThemes: Array<{id: ThemeId, label: string}> = [
  { id: 'light', label: 'Lys' },
  { id: 'dark',  label: 'Mørk' },
  // Utvides i senere faser:
  // { id: 'high-contrast', label: 'Høy kontrast' },
  // { id: 'color-blind-protanopia', label: 'Fargeblind (protanopia)' },
];
```

**Hvordan CSS-filene lastes:**
Alle tema-filer importeres i én `tokens.css` ved app-start (bundle
inkluderer begge). Framtidige accessibility-temaer kan lazy-lastes om
bundle-størrelsen blir kritisk.

---

## 13. Opsummert token-eksport

Full CSS-variabel-tabell for copy-paste til `design-tokens.css`:

```css
:root {
  /* Dark mode (default) */
  --bg-0: oklch(0.16 0.015 95);
  --bg-1: oklch(0.20 0.018 95);
  --bg-2: oklch(0.24 0.02 95);
  --surface: oklch(0.24 0.018 95 / 0.55);
  --surface-strong: oklch(0.28 0.02 95 / 0.72);
  --stroke: oklch(1 0 0 / 0.08);
  --stroke-strong: oklch(1 0 0 / 0.14);
  --text-1: oklch(0.97 0.01 85);
  --text-2: oklch(0.78 0.015 85);
  --text-3: oklch(0.58 0.015 85);
  --mint: oklch(0.82 0.15 155);
  --mint-deep: oklch(0.55 0.14 155);
  --cyan: oklch(0.82 0.12 215);
  --cyan-deep: oklch(0.55 0.11 215);
  --amber: oklch(0.82 0.13 75);
  --coral: oklch(0.78 0.14 25);
  --shadow-glow: 0 0 60px -12px oklch(0.82 0.15 155 / 0.35);
}

html[data-theme="light"] {
  --bg-0: oklch(0.97 0.008 85);
  --bg-1: oklch(0.99 0.005 85);
  --bg-2: oklch(0.94 0.01 85);
  --surface: oklch(1 0 0 / 0.72);
  --surface-strong: oklch(1 0 0 / 0.88);
  --stroke: oklch(0 0 0 / 0.06);
  --stroke-strong: oklch(0 0 0 / 0.12);
  --text-1: oklch(0.22 0.02 85);
  --text-2: oklch(0.42 0.02 85);
  --text-3: oklch(0.58 0.015 85);
  --mint: oklch(0.58 0.14 155);
  --mint-deep: oklch(0.45 0.13 155);
  --cyan: oklch(0.60 0.11 215);
  --cyan-deep: oklch(0.48 0.10 215);
  --amber: oklch(0.68 0.14 75);
  --coral: oklch(0.62 0.16 25);
  --shadow-glow: 0 20px 50px -20px oklch(0.55 0.14 155 / 0.25);
}
```

---

## 14. Onboarding/auth-utvidelser (fra `Onboarding og Auth.html`)

Onboarding-filen bygger på **alle** tokens i §1-§13, men legger til en
liten gruppe auth-spesifikke mønstre. Alle er mekanisk kompatible med
dark/light-omskifting — onboarding-filen validerer i praksis at
lys-temaet fungerer end-to-end for en helt annen sett av skjermer enn
hovedappen.

### 14.1 Nye farge-tokens

Onboarding-filen introduserer én ny farge-token utover §1:

| Token | Dark | Light | Bruk |
|---|---|---|---|
| `--rose` | `oklch(0.72 0.16 0)` | `oklch(0.58 0.17 0)` | "Uventet feil" (500) i `ScreenError` — en tredje alarm-tone utover coral/amber |
| `--ink` | `oklch(0.97 0.01 85)` | `oklch(0.22 0.02 85)` | Primær-knapp-bakgrunn (invers av body). Samme fargebruk som tab-active-pille. |
| `--ink-contrast` | `oklch(0.15 0.02 95)` | `oklch(0.99 0.005 85)` | Tekst på `--ink`-bakgrunn. |

**Hvorfor `--ink` og `--ink-contrast` separates:** Dette gir primary-
button-styling som automatisk inverterer under tema-skifte uten
context-spesifikke overstyringer. Mønsteret bør gjenbrukes i hovedappen
også (i dag håndtert ad hoc via `color-mix` + `bg-white dark:bg-black`-
varianter).

### 14.2 Progress-indikator-tokens

Brukt i `ScreenSignup1`/`ScreenSignup2`/`ScreenBootstrap`:

```css
.pdot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--stroke-strong);
  transition: all .25s ease;
}
.pdot.active {
  width: 22px;                 /* pill-shape for aktiv step */
  background: var(--mint);
  border-radius: 3px;
}
.pdot.done {
  background: var(--mint-deep); /* ferdigstilt step */
}
```

Animerer seg inn via `transition: all .25s ease`. Dette gir en myk
pille-animasjon når bruker går videre i wizard/signup.

**Tailwind-mapping:** Ingen ren utility dekker "kompakt dot ↔ pill".
Lag en `ProgressDots`-komponent (se `components-inventory.md` §11.12)
med `.pdot`-klasser i `design/tokens/components.css`.

### 14.3 Form-input-pattern (`.field`)

```css
.field {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--stroke);
  color: var(--text-1);
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 14px;
  transition: border-color .2s ease, background .2s ease;
}
.field:hover { border-color: var(--stroke-strong); }
.field:focus {
  border-color: var(--mint);
  outline: none;
  background: var(--surface-strong);
}
.field::placeholder { color: var(--text-3); }
```

**Designkontrakt:** Alle inputs/selects/textareas i auth-skjermene bruker
denne klassen. Bakgrunn er halvgjennomsiktig `--surface` (glass-kompatibelt).
Focus-tilstand forsterker glasset + trekker opp mint-kant.

**Focus-ring for keyboard-nav:**
```css
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--mint);
  outline-offset: 2px;
}
```

### 14.4 Knapp-pattern (`.btn-primary` / `.btn-ghost`)

```css
.btn-primary {
  background: var(--ink);
  color: var(--ink-contrast);
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 500;
  transition: transform .15s ease, box-shadow .2s ease;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px -8px oklch(0 0 0 / 0.3);
}
.btn-primary:disabled {
  opacity: 0.45;
  transform: none;
  box-shadow: none;
  cursor: not-allowed;
}

.btn-ghost {
  background: transparent;
  color: var(--text-2);
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 14px;
  border: 1px solid var(--stroke);
  transition: background .2s ease, color .2s ease;
}
.btn-ghost:hover {
  background: var(--surface);
  color: var(--text-1);
}
```

**Produksjon:** Lag `<Button variant="primary" | "ghost">`-komponent i
Fase 1b. Hovedappen har liknende mønstre som er inline-stylet (§9 tabellen
viser "glass rounded-2xl" osv.) — konsolider med samme tokens for å unngå
drift.

### 14.5 Terminal-blokk (`.term`)

Brukt i `SecretGeneratorField` og `ConditionalConfigPanel`:

```css
.term {
  background: oklch(0.14 0.015 95);    /* Litt mørkere enn --bg-0 */
  color: oklch(0.82 0.15 155);         /* mint — monospace auth-green */
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 12px;
  border: 1px solid oklch(1 0 0 / 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  overflow-x: auto;
}
html[data-theme="light"] .term {
  background: oklch(0.22 0.02 85);     /* Holder dark-bakgrunn også i light mode */
  color: oklch(0.82 0.15 155);         /* Samme mint */
}
```

**Designvalg:** Terminal-blokken beholder mørk bakgrunn i light mode
bevisst — imiterer faktisk CLI-estetikk. Tekstfargen er mint for å
signalisere "hemmelig / vent her / dette er kode".

### 14.6 Screen-strip (dev-only)

```css
.strip {
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
}
.strip-btn {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-2);
  border: 1px solid var(--stroke);
  background: transparent;
  white-space: nowrap;
  transition: all .2s ease;
}
.strip-btn:hover {
  color: var(--text-1);
  border-color: var(--stroke-strong);
}
.strip-btn.active {
  background: var(--ink);
  color: var(--ink-contrast);
  border-color: transparent;
  font-weight: 500;
}
.strip-btn .num {
  font-family: 'Geist Mono';
  font-size: 10px;
  opacity: 0.6;
  margin-inline-end: 4px;
}
```

**Rolle:** Brukes kun av `ScreenStrip`-dev-verktøyet. **Skal ikke inn i
produksjon.** Unntak: hvis vi senere lager en intern "screens-gallery"-
side for QA/designer-review, kan `.strip-btn`-mønsteret gjenbrukes.

### 14.7 Copy-knapp-pattern

Inline i `SecretGeneratorField`:

```html
<button class="absolute top-2 end-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]"
        style="background:oklch(1 0 0 / 0.08); color:var(--mint);
               border:1px solid oklch(1 0 0 / 0.1);">
  {copied ? <><I.check/> Kopiert</> : <><I.copy/> Kopier</>}
</button>
```

**State-mekanisme:** `copied`-boolean flasher i 1.4s etter
`navigator.clipboard.writeText()`. Kombineres med ikon-bytte (copy→check)
og label-bytte ("Kopier" → "Kopiert"). Try/catch rundt clipboard-call
for Safari-kompat.

**Produksjon:** Lag gjenbrukbar `<CopyButton value={s}/>`-komponent som
håndterer flash-state, clipboard-API-fallback, og a11y-announcement
via `aria-live="polite"`.

### 14.8 Error-state-varianter

Fra `ScreenError`:

| Variant | Farge-token | Semantikk | Ikon |
|---|---|---|---|
| offline | `--amber` | Midlertidig, bruker kan løse selv | `I.wifi` |
| server | `--coral` | Ekstern feil, prøv igjen om litt | `I.server` |
| unknown | `--rose` | Uventet feil, hentes av Sentry | `I.alert` |

**Mønster for error-chip:**
```html
<div style="background: color-mix(in oklch, {variant.color} 10%, transparent);
            color: {variant.color};
            border: 1px solid color-mix(in oklch, {variant.color} 25%, transparent);">
  {variant.badge}
</div>
```

**Stor ikon-wrapper:**
```html
<div style="background: color-mix(in oklch, {variant.color} 14%, transparent);
            border: 1px solid color-mix(in oklch, {variant.color} 30%, transparent);
            color: {variant.color};">
  <Icon size="52"/>
</div>
```

`color-mix(in oklch, ...)` gir oss farge-varianter uten å tilføye nye
tokens. Krever Chrome 111+, Firefox 113+, Safari 16.4+.

### 14.9 Nye animasjoner

```css
@keyframes softPulse {
  0%,100% { transform: scale(1);    box-shadow: 0 0 0 0 oklch(0.82 0.15 155 / 0.4); }
  50%     { transform: scale(1.04); box-shadow: 0 0 0 20px oklch(0.82 0.15 155 / 0); }
}
.soft-pulse { animation: softPulse 2.6s ease-out infinite; }

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.slide-up { animation: slideUp .35s ease-out both; }

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-3px); }
  40%, 80% { transform: translateX(3px); }
}
.shake { animation: shake .35s ease-in-out; }

@keyframes wobble {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}
.wobble { animation: wobble 2.4s ease-in-out infinite; }
```

**Semantisk bruk:**
- `soft-pulse`: Magic-link-bekreftelse-sirkel (skjerm 06). Signaliserer "vent, noe skjer".
- `slide-up`: Alle skjerm-overganger. Entry-animasjon, 350ms.
- `shake`: Ikke brukt i mockupen, men tilgjengelig for feil-validering (bruker velger ugyldig input).
- `wobble`: `ScreenError`-ikonet. Mild bevegelse for å signalisere "noe er galt, men ikke farlig".

**A11y:** Alle disse må respektere `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  .soft-pulse, .slide-up, .shake, .wobble {
    animation: none;
  }
}
```

### 14.10 Device-frame (dev-only)

Samme mønster som i `Familieassistenten.html` men re-definert lokalt i
onboarding-filen. Et lite avvik: onboarding bruker 860px fast høyde
med `overflow-y: auto; no-scrollbar` inni, mens hovedappen er mer
responsiv. Dette er et design-tool-valg — device-frame skal fjernes i
produksjon og erstattes med ekte responsiv layout.

### 14.11 Dark/light — light mode er fullt støttet også for onboarding

Verifikasjon under gjennomgang 2026-04-23: Alle 7 onboarding-skjermer
har `:root` + `html[data-theme="light"]` -tokens, og alle inline
style-blokker bruker `var(--mint)`/`var(--surface)` osv. Ingen
hardkodede farger. Tema-bytte vil fungere end-to-end for hele auth-
flyten fra dag én — ingen ekstra arbeid i Fase 1b utover `tokens.css`.

Samme gjelder aurora-bakgrunnen: `.aurora::before/::after` har `opacity`-
overstyringer for light mode (0.28 / 0.22) — identisk med hovedappen.

---
