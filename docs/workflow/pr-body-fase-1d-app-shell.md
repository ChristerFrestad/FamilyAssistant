## Sammendrag

Fase 1d — AppShell + responsive nav. Legger på det visuelle rammeverket som alle skjermer i Fase 2 vil sitte inne i: header med logo/tema-toggle/språk-switch/bruker-meny, BottomNav (mobil), SideNav (desktop), AuthGuard med mocked auth, og 8 placeholder-skjermer wirret opp via `react-router-dom`.

## Stack-tillegg

| Pakke | Versjon |
|-------|---------|
| `lucide-react` | 1.14.0 |

`react-router-dom@6.30.3` var allerede installert. `npm audit --omit=dev` rapporterer 0 vulnerabilities.

## Nye komponenter

| Komponent | Plassering | Rolle |
|-----------|------------|-------|
| **AppShell** | `client/src/app/components/layout/AppShell.tsx` | Hovedchrome — header + main + bottom-nav + side-nav |
| **BottomNav** | `client/src/app/components/layout/BottomNav.tsx` | Mobil-only, 5 ikoner (Dashboard / Familie / Måltider / Handleliste / Kalender) |
| **SideNav** | `client/src/app/components/layout/SideNav.tsx` | Desktop-only, 5 + Settings |
| **UserMenu** | `client/src/app/components/layout/UserMenu.tsx` | Avatar-dropdown med Min konto + Logg ut |
| **AuthGuard** | `client/src/app/components/auth/AuthGuard.tsx` | Rute-guard, redirector til `/login` |
| **ThemeToggle** (prod) | `client/src/app/components/form/ThemeToggle.tsx` | System/Lys/Mørk-tre-valg, `fa:theme` localStorage |
| **nav-items** | `client/src/app/components/layout/nav-items.ts` | Single source of truth for primary + secondary nav |

## Hooks og placeholder-skjermer

- **`useAuth`-hook** (`client/src/app/hooks/useAuth.ts`) — mocket i Fase 1d (`isAuthenticated: true`); reell implementasjon kommer i Prompt 5. Konsumenter (AuthGuard, UserMenu) er allerede skrevet mot final shape, så Fase 1e-bytte er body-only.
- **8 skjerm-placeholders** under `client/src/app/screens/`: Dashboard, Family, Meals, Shopping, Calendar, Settings, NotFound, Login. Hver har en i18n-`<h1>` + en kort "kommer-i-Fase-2X"-kropp slik at routing kan verifiseres ende til ende.

## Routing

`client/src/app/App.tsx` er omskrevet fra placeholder til full Routes-tre:

- `/login` — utenfor AppShell (auth-flow har egen layout via PageShell)
- `*` — i AuthGuard → AppShell → indre Routes:
  - `/` → redirect til `/dashboard`
  - `/dashboard`, `/family`, `/meals`, `/shopping`, `/calendar`, `/settings`
  - `*` → NotFound (404 med Dashboard-link)

`BrowserRouter basename="/v2"` lå allerede i `main.tsx`, så hver `<Route path>` matcher mot `/v2/*` i URL-en.

## i18n

`common.json` (NO + EN) får tre nye seksjoner: `nav` (6 nøkler), `userMenu` (4 nøkler), `theme` (4 nøkler), `appShell` (2 nøkler). Parity-test bekreftet — NO og EN-bundlene har identisk shape.

## Tester

| Fil | Tester | Tema |
|-----|-------:|------|
| `AppShell.test.tsx` | **7** | Banner/main-landmark, skip-link, brand-link, samtidig BottomNav + SideNav i DOM, UserMenu-trigger |
| `BottomNav.test.tsx` | **9** | 5 items, aria-label, active highlighting på alle ruter, `/` → dashboard alias, child-route highlighting, precision-checks |
| `SideNav.test.tsx` | **5** | 6 items inkl. Settings, primary/secondary split, Dashboard + Settings active highlighting |
| `UserMenu.test.tsx` | **9** | Trigger ARIA, dropdown open/close, menuitem-roller, Escape, click-outside, logout-invocation |
| `AuthGuard.test.tsx` | **4** | Loading-view, redirect-til-login, render-children, custom redirectTo |
| `ThemeToggle.test.tsx` | **6** | Radiogroup, default System, Light/Dark/System-bytter, localStorage-persistens, mount-tid-leasing |
| `screens.test.tsx` | **8** | Hver placeholder rendrer riktig i18n-heading; NotFound har Dashboard-link; Login rendrer |

**Totalt:** 48 nye tester. Klient-suite går fra 200 → **250 tester** (alle pass). Server-suite uendret 1306/1308 (2 skipped pre-existing).

## Active-route-detektering

NavLink ble forsøkt først, men Reacts Router NavLink overstyrer `aria-current` med sin egen pathname-equality-matcher — det betyr at `/` ikke kunne aliase til `/dashboard`. Bytter til vanlig `<Link>` + manuell `isActive()`-funksjon. Logikken sitter i `BottomNav.tsx` og `SideNav.tsx` med hjelperen som behandler `/` ↔ `/dashboard` og `pathname.startsWith()` for nestede ruter (`/meals/add` highlighter `/meals`).

## Design-gap notert

Mockupen `Familieassistenten.html` viser kun mobil-BottomNav — desktop-vinduet rendres som telefon-frame i en `md:max-w-[1400px]`-wrapper. SideNav er derfor utvikler-initiert tolkning konsistent med design-system-tokens. Lagt til entry "Desktop SideNav er ikke designet — kun BottomNav er i mockup" i `design/2026-04-redesign/design-gaps.md` for fremtidig design-runde (rail-bredde, Settings-plassering, header-rail-koordinasjon, hover/aktiv-tilstand, eventuell collapse-modus).

## Bundle-impact

| Asset | Etter Fase 1c | Etter Fase 1d |
|-------|--------------:|--------------:|
| Prod JS | 209.68 kB | **251.29 kB** |
| Prod JS (gzipped) | 68.30 kB | **81.06 kB** |
| Prod CSS | 26.22 kB | **29.41 kB** |
| Prod CSS (gzipped) | 5.97 kB | 5.97 kB |

+41.6 kB ungzipped / +12.8 kB gzipped — kostet av 6 lucide-ikoner + react-router-dom-konsumenter + AppShell/BottomNav/SideNav/UserMenu/ThemeToggle/AuthGuard + 8 placeholder-skjermer. Tree-shaking holder lucide-react minimal (kun de 7 ikonene vi importerer havner i bundlen, ikke hele 1500+-settet).

## Test plan

- [x] `npm run lint` — clean (0 errors)
- [x] `npm run typecheck` — clean
- [x] `npm run typecheck:client` — clean
- [x] `npm run test` (server) — **1306/1308** (uendret baseline)
- [x] `npm run test:client` — **250/250** (200 før + 50 nye)
- [x] `npm run audit:prod` — 0 vulnerabilities
- [x] `npm run build:client` — clean

## Etter merge

Klar for **Prompt 5 (Fase 1e — Auth-flyt)**. AuthGuard og useAuth har final shape; Fase 1e bytter useAuth's body fra mock til reell `/api/auth/*`-flyt + bygger Login-skjermen.
