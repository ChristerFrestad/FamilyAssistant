# Design-system — Familieassistenten redesign (april 2026)

Kilde: `source/Familieassistenten.html`. Kildekoden er én enkelt HTML-fil
(2845 linjer) med inline React via Babel standalone + Tailwind via CDN.
Dette dokumentet ekstraherer designtokenene slik at implementering i
produksjon-stack (Next.js/Vite + Tailwind-build eller CSS modules) kan
matche det visuelle uttrykket 1:1.

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

## 12. Dark mode-implementering

Aktiveres via `document.documentElement.setAttribute("data-theme", "dark|light")`.
All tokens er CSS custom properties som bytter ved `[data-theme="light"]`-
selector. Tailwind `dark:`-klasser brukes IKKE — dette er et bevisst
valg for å holde tokens sentralisert.

Brukeren kan overstyre med knapp i TopBar (sun/moon-ikon). Preferanse
lagres ikke i `localStorage` i mockup-en (kun `tab`-state persisteres).

**Implementerings-anbefaling:** persister tema i `localStorage` + respekter
`prefers-color-scheme` ved første-last. Settings-skjermen har allerede
UI for dette.

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
