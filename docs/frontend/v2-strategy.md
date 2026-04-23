# Frontend v2 — strategi og rute-design

**Status:** Fase 1a ferdig 2026-04-23. Oppdateres etter hver underfase.

**Relevant:** `design/2026-04-redesign/extracted/locked-decisions.md`
(THE REFERENCE for alle design-beslutninger).

---

## Hva og hvorfor

Familieassistenten bygger ny frontend fra grunnen i **Vite + React 18 +
TypeScript (strict) + Tailwind v3 + React Router**. Kildekoden ligger i
`client/`; bygget output havner i `public/v2/` (gitignored).

Backend fortsetter uendret. Den gamle appen (vanilla JS i `public/*`)
fortsetter å fungere byte-identisk på `/`. Den nye appen kjøres på
**`/v2/*`**.

Når redesignet er komplett (sannsynligvis uke 8-10) byttes rollene:
`/v2/*` blir til `/`, og gammel app flyttes til `/v1/*` i en
overgangsperiode før den fjernes.

---

## Rute-strategi

### Hva blir servert fra hvor?

| URL-mønster | Kilde | Serveres av |
|---|---|---|
| `/api/*` | Express-ruter i `server/routes.js` + `server/auth/*` | Eksisterende backend |
| `/metrics`, `/health`, `/ready` | Eksisterende backend | Eksisterende backend |
| `/v2` | `public/v2/index.html` | Ny `tryServeV2App`-handler |
| `/v2/` | `public/v2/index.html` | Ny `tryServeV2App`-handler |
| `/v2/<filnavn>` | `public/v2/<filnavn>` | Ny `tryServeV2App`-handler (direct hit) |
| `/v2/<client-side-route>` | `public/v2/index.html` (fallback) | Ny `tryServeV2App`-handler (SPA-fallback) |
| `/` | `public/index.html` | Eksisterende `tryServeSpaFallback` |
| `/<asset>` | `public/<asset>` (hvis finnes) | Eksisterende `tryServeSpaFallback` |
| Ukjent path | `public/index.html` (legacy) | Eksisterende `tryServeSpaFallback` |

### `tryServeV2App`-handleren

Definert i `server/http/server.js`. Kalles **før** `tryServeSpaFallback`
i request-flyten. Matcher **KUN** `/v2` og `/v2/*` — ingen generisk
prefix-matching. Når vi legger til `/v3` senere, får den egen handler.

```js
// Pseudocode
function tryServeV2App(pathname, res) {
  if (pathname !== '/v2' && !pathname.startsWith('/v2/')) return false;
  if (!fs.existsSync('public/v2')) return false;

  // Direct file hit for assets (e.g. /v2/assets/main.js)
  // → serve file
  // Fallback to public/v2/index.html
  // → let React Router take over
}
```

### Hvorfor eksplisitt over generisk?

Christer valgte (2026-04-23) en dedikert handler i stedet for å utvide
eksisterende `tryServeSpaFallback` med generisk sub-app-logic. Tre
grunner:

1. **Eksplisitt over implisitt:** Generisk prefix-matching er "magisk"
   — hvem som helst som lager `public/foo/index.html` ville utilsiktet
   opprette en ny sub-app.
2. **Minimal regresjonsrisiko:** Eksisterende `tryServeSpaFallback`
   er uendret. Testsuite for legacy-serving påvirkes ikke.
3. **Enkel test-isolering:** Ny test `tests/v2-app-serving.test.js`
   tester kun `tryServeV2App` + sam-eksistens med legacy. Ingen
   kopplinger på tvers.

---

## Utviklings-flyt

### Starter du frontend-arbeid?

```bash
# Backend (egen terminal)
npm start                    # Express på :7777

# Frontend (ny terminal)
npm run dev:client           # Vite dev-server på :5173 med /api-proxy
```

Åpne `http://localhost:5173/v2/` — Vite server HMR med automatisk
re-rendering. API-kall til `/api/*` proxies til backend på 7777.

### Vil du se hvordan prod-bygget ser ut?

```bash
npm run build:client         # bygger public/v2/
npm start                    # Express på :7777
# Åpne http://localhost:7777/v2/
```

### Typecheck

```bash
npm run typecheck:client     # tsc --noEmit for client/
npm run typecheck            # tsc --noEmit for server/ (som før)
```

---

## Hvor legger man ting?

```
client/
  index.html                  # Vite entry HTML
  vite.config.ts              # Vite-config (base: '/v2/', outDir: ../public/v2)
  tsconfig.json               # TS-config for client (strict mode)
  tailwind.config.ts          # Tailwind v3-config (fylles i Fase 1b)
  postcss.config.js           # Tailwind + Autoprefixer

  src/
    main.tsx                  # React entry + BrowserRouter(basename="/v2")
    App.tsx                   # Router + Routes (placeholder for nå)
    index.css                 # Tailwind base/components/utilities
    screens/                  # Top-level route-komponenter (kommer)
    components/               # Gjenbrukbare UI-komponenter (kommer)
    lib/                      # Utilities, hooks, services (kommer)
```

**Regler:**

- Importer relative til `@/` alias (`@/components/Button`) — konfigurert i `tsconfig.json`
- Tailwind-utilities i JSX; egen CSS kun for tokens/keyframes
- Design-tokens fra `design/2026-04-redesign/extracted/design-system.md` §13 — kommer i Fase 1b
- **Ingen inline styles** i produksjons-komponenter — kun i placeholder-kode eller svært dynamiske kartlegginger

---

## Co-existence-periode

| Fase | Gammel app på `/` | Ny app på `/v2/` |
|---|---|---|
| Fase 1 (toolchain, design-system, shell) | Full funksjonalitet | "Hello v2" + design-tokens + shell |
| Fase 2 (skjermer mot eksisterende backend) | Full funksjonalitet | Dashboard, Meals, Shopping, Chores basic |
| Fase 3 (utvidelser) | Full funksjonalitet | Pantry-location, unpreferred, Settings |
| Fase 4 (nye features) | Full funksjonalitet | Kalender, achievements, week-goals |
| **Overgang** | Flyttes til `/v1/` temporarily | Blir `/` |
| **Nedfasing** | Fjernes | Er appen |

Denne strukturen gjør at vi kan gradvis teste ny app med pilot-familier
(de får lenken `/v2/`) mens produksjons-bruk fortsetter på `/`.

---

## Hva IKKE er i Fase 1a

- Design-tokens (OKLCH-farger, typografi, glassmorphism) — kommer Fase 1b
- i18n-oppsett — kommer Fase 1c
- Responsiv navigasjon (bunnmeny mobil, sidemeny desktop) — kommer Fase 1d
- Skjermer (Dashboard, Meals, ...) — kommer Fase 2+
- Auth-flyt — venter på claude.ai/design-oppfølging (D1)

---

## Referanser

- `client/vite.config.ts` — Vite-oppsett
- `server/http/server.js` — `tryServeV2App` + `tryServeSpaFallback`
- `tests/v2-app-serving.test.js` — serving-tester
- `design/2026-04-redesign/extracted/locked-decisions.md` — låste valg (D1-D6)
- `design/2026-04-redesign/extracted/architecture-fit.md` — kjør-overalt-krav
- `docs/vision/integration-platform-future.md` — post-pilot visjon
