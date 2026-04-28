# Fase 1b Sluttrapport — Frontend-fundament

**Dato skrevet:** 2026-04-28
**Branch:** `feat/fase-1b-design-system`
**Status:** Klar for PR-diskusjon

---

## Oversikt

| Felt | Verdi |
|------|-------|
| Første commit | `bfdcc72` — 2026-04-23 19:09 (`analysis(frontend-redesign): extract design-bundle + 4 analysis docs`) |
| Siste commit | `c45afb1` — 2026-04-28 20:20 (`feat(client): add Modal overlay component (Phase 1b.3 part 2 / Batch G)`) |
| Total kalenderdager | **6 dager** (23. — 28. april 2026) |
| Antall sesjoner | ~5 (basert på commit-grupperinger og PreCompact-stempler) |
| Hovedmål | Bygge frontend-fundament: design-tokens, theme-system, base-komponenter, test-infra, governance-rutiner |

Fasen ble strukturert i fire del-faser som ble utført sekvensielt:

| Del-fase | Hva | Antall commits |
|----------|-----|---------------:|
| 1b.0 — preludium | Pre-deploy cleanup-plan, app/dev-isolation, Vite 5→6, ESLint/security-fundamenter | ~10 |
| 1b.2 — design-system | OKLCH-tokens, fonts, theme-system, Tailwind-integrasjon, preview-side | ~7 |
| 1b.3 part 1 | Test-infra (Vitest), Button + Field + governance-dokumenter | ~5 |
| 1b.3 part 2 (A–G) | 14 ekstra komponenter på 6 batches | ~13 |
| Slutt-rapport (denne filen) | Fase 1b sluttrapport + PR-prep | 1+ |

---

## Hva som er bygd

### Infrastruktur (Fase 1b.0 + 1b.1 + 1b.1.5)

Fundamentet før selve design-systemet kunne bygges:

- **Pre-deploy cleanup-plan** (`1f23050`) — 11-uke-plan med reaktiveringsfase + CI-mønstre. Lagret i `docs/workflow/pre-deploy-cleanup-plan.md`.
- **App/dev-folder-isolasjon med Vite-plugin** (`96ed1af`) — `client/vite-plugins/enforce-isolation.ts` forbyr import fra `client/src/dev/` inn i `client/src/app/`. Tre-shake-garanti uavhengig av menneskelig disiplin.
- **Vite 5 → 6 migrering** (`16ef861`) — sammen med fix av alle dev-dependency-CVEer. `npm audit --omit=dev` rapporterer **0 vulnerabilities**.
- **ESLint flat config** (`ae9c599`) — baseline-regler for `client/src/`. Senere utvidet med `no-restricted-imports` (`71b7657`) som dobbel-håndhever app/dev-grensen som en linter-regel.
- **Vitest + jsdom + React Testing Library** (`c20e55a`) — test-runner med JSX-support, DOM-emulering og a11y-aware matchers. Setup-fil registrerer `cleanup()` eksplisitt fordi `globals: false` ikke automatisk wirer hooket.

### Design-system (Fase 1b.2)

OKLCH-baserte tokens og theme-aware utility-klasser:

- **Token-fil** (`a84d1f5`) — `client/src/app/styles/tokens.css` med OKLCH-farger for canvas, surface, stroke, text, brand-accents (mint/cyan/amber/coral/rose), ink/ink-contrast invert-paret, type-skala, spacing, radius, shadows. Light + dark + system-default via `data-theme`-attributt og `prefers-color-scheme`-fallback.
- **Selvhostet web-fonts** (samme commit) — Geist (variable), Geist Mono, Instrument Serif. Lagret i `client/src/app/styles/fonts/` og lastet via `@font-face`.
- **Tailwind-integrasjon** (`c1607e1`) — `client/tailwind.config.ts` mapper hver token til en utility (`bg-canvas-2`, `text-text-1`, `font-display`, etc.). Dev-mode scanner `client/src/dev/`, prod-mode ekskluderer den så preview-utility-strenger ikke leaker.
- **Theme-system** (`5ab107f`) — system/light/dark via ThemeProvider + localStorage. 200 ms transition på color-properties (ikke transform/opacity), respekterer `prefers-reduced-motion`.
- **Preview-side** (`0a07741`) — `client/dev.html` + `client/src/dev/preview/PreviewPage.tsx` med navigasjon mellom seksjoner. Lever per design utelukkende i dev-tre.
- **Token-rename `--bg-*` → `--canvas-*`** (`c560846`) — fjerner stuttering i utility-navn (`bg-bg-0` → `bg-canvas-0`).

### Base-komponenter (Fase 1b.3)

16 komponenter, alle med komponent-fil + test-fil + preview-fil. Mappe-strukturen reflekterer rolle:

| Kategori | Mappe | Komponenter |
|----------|-------|-------------|
| Action | `base/`, `form/` | Button, CopyButton |
| Form | `form/` | Input, Field, Toggle, PortionFactorSlider |
| Layout | `layout/` | Card, Stack, Row, PageShell |
| Display | `display/` | Avatar, Badge, Tag, ProgressDots, Term |
| Overlay | `overlay/` | Modal |

**Eksporterte helpers (3 funksjoner + 3 konstanter):**

| Helper | Plassering |
|--------|------------|
| `getInitials(text)` | `display/Avatar.tsx:114` |
| `getPortionFactorDefault(role)` | `form/PortionFactorSlider.tsx:69` |
| `getPortionLabel(value)` | `form/PortionFactorSlider.tsx:92` |
| `MIN_PORTION` | `form/PortionFactorSlider.tsx:47` |
| `MAX_PORTION` | `form/PortionFactorSlider.tsx:48` |
| `STEP_PORTION` | `form/PortionFactorSlider.tsx:49` |

**26 type-eksporter** dekker variant-typer, size-skalaer, og prop-interfaces — én eller flere per komponent.

**180 tester** (16 test-filer) med følgende coverage-profil:

- Statements: **98.08%** (256/261)
- Branches: **94.35%** (184/195)
- Functions: **97.82%** (45/46)
- Lines: **100%** (241/241)

Resterende uncovered statements/branches er defensive null-sjekker i Modal (TypeScript-narrowing-artefakter) og lignende uniform-logging-fallbacks som ikke kan trigges fra realistiske test-scenarier.

**Tree-shake bekreftet:**

`grep` mot prod-bundle (`public/v2/assets/main-*.js`) for unike komponent-/helper-navn (`PortionFactorSlider`, `PageShell`, `ProgressDots`, `CopyButton`, `getInitials`, `getPortionFactorDefault`, `getPortionLabel`, `MIN_PORTION`, `FOCUSABLE_SELECTOR`) returnerer **0 matches**. Generic-name-matches (`Button` 0, `Stack` 5, `Row` 4, `Tag` 1, `Input` 9) er fra React-internals (`componentStack`, `gridRow`, `textInput`, `Symbol.toStringTag`) — bekreftet via context-grep. Ingen av våre komponenter er i prod-bundle.

### Governance

Prosess-fundament som er ferdigskrevet i denne fasen:

- **Pre-deploy cleanup-plan** — `docs/workflow/pre-deploy-cleanup-plan.md`. 11-uke-plan med reaktiveringsfase.
- **Config-protected files** (`7b8316a`) — `docs/workflow/config-protected-files.md` med decision-tabell for hvilke filer som krever audit-log før edit.
- **Pending-decisions tracking** — `docs/workflow/pending-decisions.md`. Levende dokument; oppdatert med kalender-arkitektur (`85bf11c`) som siste entry.
- **Design-gaps tracking** (`7b8316a`) — `design/2026-04-redesign/design-gaps.md`. Levende dokument med Active + Resolved-seksjoner.
- **`CLAUDE.md` DEL 7.10** — design-mangler-protokoll: 1) entry i design-gaps.md, 2) flag i fase-rapport, 3) dokumentert temporær løsning.
- **`CLAUDE.md` DEL 9.1** — git stash-disiplin: kun for arbeid-i-prosess, aldri for diagnostikk.

---

## Statistikk

| Metrikk | Verdi |
|---------|-------|
| Total commits på branch | **37** (36 før denne rapporten + selve summary-commiten) |
| Total filer endret/nye | **114** (105 nye + 9 modifiserte) |
| Total linjer endret | **+24 423 / −1 022** |
| Klient-spesifikke filer | 80 (+7 055 linjer) |
| Komponenter | 16 |
| Test-filer | 16 |
| Tester | **180** |
| Coverage statements | 98.08% |
| Coverage branches | 94.35% |
| Coverage functions | 97.82% |
| Coverage lines | 100% |
| Prod JS bundle | **150.50 kB** (uminified, 48.80 kB gzipped) |
| Prod CSS bundle | **26.22 kB** (uminified, 5.33 kB gzipped) |
| Vulnerabilities | **0** (`npm audit --omit=dev`) |
| Helper-eksporter | 3 funksjoner + 3 konstanter |
| Type-eksporter | 26 |

**Bundle-vekst usikkerhet:** En presis "CSS-vekst gjennom Fase 1b" krever git-arkæologi gjennom 36 commits og separate build-kjøringer per snapshot. Vi har ikke målt det punktvis. **Best estimate:** CSS-bundlen startet på ~0 kB ved 1b.0 (ingen Tailwind-utilities scannet ennå) og endte på 26.22 kB. Veksten er nesten utelukkende design-system + komponent-utilities.

---

## Hovedlæringer

1. **Token-rename er trivielt med disiplin, katastrofalt uten.** `--bg-*` → `--canvas-*` (`c560846`) ble levert som én atomisk commit. En mindre disiplinert commit-strategi ville krevd en revert-rebase-skala-prosess i flere dager. Lærdom: rename-arbeid bør altid være én commit, aldri inkrementell.

2. **`exactOptionalPropertyTypes: true` fanger ekte feil**, men det krever et eksplisitt `?: T \| undefined`-mønster på "injectable"-prop-interfaces (Field-komponenten oppdaget dette). Dokumentert i komponentens kommentar slik at fremtidige forfattere ikke gjenoppdager det.

3. **`globals: false` i Vitest krever eksplisitt `cleanup()`-registrering.** Uten det leakes DOM-noder mellom tester og `getByTestId` ser N kopier. Setup-fil må wire hookket selv. Funn dokumentert med begrunnelse i `client/src/test-setup.ts`.

4. **Test-skriving avslører design-flaws.** I Modal var Escape-handler opprinnelig gated på `isOpen` (animasjons-flagg). Test-skrivingen avdekket at brukeren forventer at Escape virker umiddelbart når modal er på skjermen, ikke vente på entrance-animasjon. Rotårsak fikset, ikke symptom.

5. **Tema-toggle krever `<r> <g> <b>`-format for alpha-modifier.** OKLCH som hele `var()`-strenger støtter ikke `bg-token/80`. Modal valgte `bg-black/40` (idiomatisk modal-pattern, tema-agnostisk) heller enn å introdusere `--backdrop-overlay`-token midt i komponent-arbeidet. Polish flagget i fase-rapport.

6. **Bug-rapportering vinner over test-jakt.** Primary-button-kontrast-bug ble fanget av Christer i visuell sjekk, ikke av tester. Tester verifiserte `bg-mint`-class men ikke faktisk kontrast. Lærdom: visuell QA og automatiske tester er komplementære, ikke utbyttbare.

7. **`peer-checked:` cascader bare gjennom sibling-combinator.** Toggle måtte ha thumb som SØSKEN (ikke etterkommer) av input for at peer-pattern skulle nå fram. Ny pattern dokumentert i komponent-fil.

8. **Native dialog vs custom dialog er en design-system-beslutning.** Vi valgte custom for å få full kontroll over OKLCH + glassmorphism + bottom-sheet-layout. Kostnaden var ~30 linjer manuell focus-trap + scroll-lock — håndterbar.

9. **`requestAnimationFrame` flusher ikke under `await Promise.resolve()` i jsdom.** Test-pattern: `act(async () => await Promise.resolve())` gjør jobben for én tick, men sammenstilt med `vi.useFakeTimers()` må man advance timer eksplisitt. Dokumentert i Modal-tests.

10. **Mount-delay-pattern (`shouldRender` + `isOpen`) er en gjenbrukbar arkitektur** for alle overlays/transitions hvor exit-animasjon må kjøre før unmount. Pattern dokumentert i Modal-fil for fremtidig Toast/Drawer/Popover.

---

## Kjente begrensninger / Pending

Disse er enten flagget i `design/2026-04-redesign/design-gaps.md`, oppdaget under Fase 1b-arbeidet, eller dokumenterte i `docs/workflow/pending-decisions.md`:

| Tema | Status | Plassering |
|------|--------|------------|
| Light-mode primary button-kontrast (under WCAG AA) | Aktiv design-gap | `design/2026-04-redesign/design-gaps.md` (Active) |
| Modal backdrop-overlay tema-agnostisk | Polish-kandidat | Notert i `Modal.tsx`-kommentar |
| Pre-Phase-2 WCAG-revisjon på alle komponenter | Planlagt | Skal kjøres før Fase 2 |
| Kalender-arkitektur (Fase 2) | Pending decision (hybrid foretrukket) | `docs/workflow/pending-decisions.md` |
| React Router v7 future-flag warnings | Kosmetisk støy | Opt-in når v7 lander |
| Diabetes-støtte | Utsatt til Fase 2+ | `docs/workflow/pending-decisions.md` |
| Per-medlem-diett UI | Pending før pilot-invitering | `docs/workflow/pending-decisions.md` |
| Data-retensjon for inaktive familier | Pending før pilot | `docs/workflow/pending-decisions.md` |
| Sikkerhetsarkitektur (RLS, rate-limit, server-side validering) | Pre-pilot security-arbeid | `docs/workflow/pending-decisions.md` |

Kun de tre første punktene er direkte konsekvenser av Fase 1b. Resten er fanget tidligere i prosjektets arkitektur-arbeid og listes her for komplettheten.

---

## Hva som kommer i neste fase

Etter PR-merge er den planlagte sekvensen:

- **Fase 1c — i18n** (react-i18next med NO/EN). Forventes 2-3 sesjoner.
- **Fase 1d — AppShell + responsive nav** (mobil bottom-nav, desktop side-nav, header med theme-toggle og avatar). Forventes 4-5 sesjoner.
- **Fase 1e — Auth-flyt + 7 onboarding-skjermer + backend-endpunkter** (magic-link, e-post-bekreftelse, husholdnings-onboarding-wizard). Forventes 6-8 sesjoner.

Pre-Phase-2 WCAG-revisjon må kjøres mellom Fase 1d og Fase 1e for å fange opp light-mode-kontrastissues før de leveres til pilot-brukere.

---

## Verifisering kjørt for denne rapporten

| Sjekk | Resultat |
|-------|----------|
| 16 komponent-filer + 16 test-filer + 16 preview-filer eksisterer | ✅ |
| `index.tsx` registrerer alle 16 preview-komponenter i 5 kategorier | ✅ |
| `npx tsc --noEmit` på hele `client/src` | ✅ TYPECHECK_OK |
| `npx eslint client/src --max-warnings=0` | ✅ LINT_OK (0 warnings) |
| `npx vitest run` | ✅ 180/180 |
| `npm run build:client` | ✅ 32 modules transformed, 1.37s |
| Tree-shake-grep mot prod-bundle | ✅ 0 matches på unique component/helper navn |
| Interaktiv preview-test via Vite dev-server (`/v2/dev.html`) | ✅ Alle 7 seksjoner + 16 komponenter rendrer |
| Tema-toggle (System / Light / Dark) endrer `data-theme` + `bg` på documentElement | ✅ Bekreftet via DOM-eval |
| Modal-portal renderer som direkte barn av `document.body` | ✅ Bekreftet via `dialog.parentElement.parentElement === document.body` |
| Modal scroll-lock setter `body.style.overflow = 'hidden'` ved åpning og fjerner ved lukk | ✅ Bekreftet |
| Console-logs: 0 errors, kun React Router future-flag warnings | ✅ |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
