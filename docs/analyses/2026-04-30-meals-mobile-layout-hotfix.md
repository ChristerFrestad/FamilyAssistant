# Hotfix: Meals mobile layout — BottomNav sticky regression

**Dato:** 2026-04-30
**Branch:** `hotfix/meals-mobile-layout`
**Type:** Bug fix (DEL 5.3 — krever Christer-godkjenning)

---

## Symptom (rapportert av Christer)

> "Bottom nav på mobil Meals er for langt nede. Toolbar er ikke låst
> til bunnen av skjermen når den veksler fra pc/web til mobil. Det er
> bare Meals som har dette problemet — alle andre skjermer (Dashboard,
> Familie, Shopping) fungerer korrekt i mobile-mode. Virker som
> Meals-siden bare er zoomet inn."

**Påvirket:** kun `/v2/meals` på mobile-breakpoint (< `md` = 768px).
**Ikke påvirket:** `/v2/dashboard`, `/v2/family`, `/v2/shopping`.

---

## 1. Reisen

```
1. Bruker åpner /v2/meals på mobil (390 × 844 px)
   1.1. AppShell rendres
        1.1.1. Header (sticky top)
        1.1.2. Main (flex-1 px-4 py-6 pb-24)
        1.1.3. BottomNav (fixed bottom-0 inset-x-0 z-30)
   1.2. Meals-screen rendres inne i main
        1.2.1. Header (uke-tittel)
        1.2.2. DayStrip (7 day-pills, hver 72px wide, flex-shrink-0)
        1.2.3. MealHero (full-bredde card)
        1.2.4. RecipeIngredients (full-bredde liste)
        1.2.5. WeekList (7 rader, full-bredde)
2. Browser layout-pass beregner sidebredde
   2.1. DayStrip's <ul> krever 7×72 + 6×8 = 552px (children min-content)
   2.2. <nav> wrapper har overflow-x-auto — SKAL reset min-width til 0
   2.3. Hvis reset feiler, <main> tvinges til 552px
   2.4. <main> sitt parent flex-container blir 552px
   2.5. <body>.scrollWidth = 552, .clientWidth = 390 → horisontal scroll
3. Mobile browser tilpasser visning
   3.1. Layout-viewport blir 552px
   3.2. Visual viewport forblir 390px
   3.3. Browser auto-zoomer ut for å vise 552px innhold
   3.4. position:fixed BottomNav anker til layout-viewport (552px)
   3.5. Fra visual viewport ser BottomNav ut til å være "for langt nede"
        og hele siden ser "zoomet inn" ut
```

## 2. Domenemodell-påvirkning

Ingen domeneendring. Rent presentasjons-/layout-fix.

Filer berørt:
- `client/src/app/components/layout/AppShell.tsx` — defensiv `min-w-0`
  på `<main>` for å hindre flex-item-vekst basert på child min-content
- `client/src/app/components/meals/DayStrip.tsx` — fjerne redundant
  `min-w-full` (overflødig når children er bredere) og verifisere
  `overflow-x-auto` containment
- `client/src/app/screens/Meals.tsx` — fjerne potensiell skeleton-state
  overflow-leak (samme pattern som DayStrip i loading-state)

## 3. Edge-cases

1. **iPhone SE (320 × 568) — minste mobile** — DayStrip pills 7×72=504
   px overstiger viewport. Må scrolle horisontalt **innenfor** strip,
   ikke på side-nivå.
2. **iPhone 12 Pro (390 × 844)** — Christers rapporterte test-case.
3. **iPhone 11 Pro Max (414 × 896)** — pills passer fortsatt ikke
   (504+48 > 414), så samme containment må gjelde.
4. **iPad Mini portrait (768 × 1024)** — `sm:` breakpoint (640px) +
   `md:` breakpoint (768px). På 768px bytter SideNav inn, BottomNav
   ut. DayStrip's `sm:mx-0 sm:px-0` kicker også inn — undoer den
   negative-margin-trikset.
5. **Desktop 1024+ (rotert iPad eller PC)** — DayStrip vises uten
   horisontal scroll (har plass), SideNav synlig.
6. **Resize fra desktop til mobile** — orientationchange/resize event,
   må ikke etterlate stale layout. Reactive Tailwind-klasser
   (`md:hidden`, `sm:px-0`) håndterer dette.
7. **Skeleton-state** — DayStrip-pillsene er ikke rendret, men
   skeleton har egen `<div className="flex gap-2 overflow-x-auto pb-2">`
   med 7 fixed-width 72px-children. Samme containment-krav.
8. **Mocked data med < 7 slots** — defensive "selectedSlot ===
   undefined" returns `<Card>meals-empty</Card>`. Ingen DayStrip → ingen
   bug. Test-coverage allerede.
9. **Ny screen kommer i Sprint 5+** — hvis en fremtidig screen
   introduserer fixed-width row-content, samme `min-w-0` på `<main>`
   beskytter mot regresjon.

## 4. Konsekvenser på tvers

- `AppShell.tsx` endring påvirker ALLE skjermer. Endring er defensiv
  (`min-w-0` lar flex-item krympe under min-content) — kan ikke bryte
  layouts som allerede fungerer.
- `DayStrip.tsx` endring er Meals-spesifikk.
- `Meals.tsx` skeleton-endring er Meals-spesifikk.
- Tester: nye assertions for layout-containment (computed width
  ikke større enn viewport-bredde).
- Ingen API-endringer, ingen migrasjoner, ingen DOMAIN_MODEL-endring.

## 5. Beslutninger

### BESLUTNING 1: Hvor plasseres fix-en?

**ANBEFALING:** Defensiv `min-w-0` på `<main>` i AppShell + opprydning i
DayStrip. Kombinasjons-fix gir både umiddelbar bug-løsning og fremtidig
beskyttelse.

**HVORFOR:** Rot-årsak er trolig flexbox `min-width: auto` (= min-
content) på `<main>` som ikke har `min-w-0`. Når DayStrip's children
har `flex-shrink-0` med fixed-width, kan deres min-content propagere
opp gjennom skreddersydde flex-strukturer. `overflow-x-auto` på
DayStrip's nav SKAL resette min-content til 0, men i praksis ser vi
at det ikke alltid skjer — særlig med `-mx-4` som forskyver boksen.

`min-w-0` på `<main>` er en velkjent flexbox-pattern som eksplisitt
sier "denne flex-item kan krympe under sine barns min-content".
Forhindrer at fremtidige skjermer faller i samme felle.

**ALTERNATIVER:**
- **Bare `overflow-x-clip` på `<main>`**: maskerer symptomer, men
  hider potensielle layout-bugs. Christer ville se BottomNav riktig,
  men ikke vite at innholdet kuttes.
- **Bare DayStrip-fix (fjerne `-mx-4` på mobil)**: målrettet, men
  beskytter ikke mot fremtidige skjermer. Også: `-mx-4` er en
  edge-to-edge-design-intensjon (mockup viser DayStrip strekker fra
  kant til kant), så å fjerne den endrer designet.
- **Bytte til `overflow-x-hidden` på `<body>`**: bryter sticky-header
  og fixed-positioned BottomNav i enkelte browsere. Anti-pattern.

**KONSEKVENS HVIS ANNERLEDES:** Hvis kun DayStrip-fix: virker for
Meals nå, men identisk bug kan oppstå i Calendar (Sprint 5+),
Settings tabs, eller hvilken som helst horisontal scroll-row. Hvis
kun overflow-clip: bug-en er kamuflert, ikke løst — kan ramme oss
igjen i annen kontekst.

### BESLUTNING 2: Skal `<ul>` i DayStrip beholde `min-w-full`?

**ANBEFALING:** Fjerne. Den er redundant.

**HVORFOR:** `min-w-full` (`min-width: 100%`) skulle sørge for at
ul-en fyller nav når det er færre items enn nav-bredde. Med 7 items
av 72px (= 504px+) er ul ALLTID bredere enn nav-content-box (~358px
på mobil). Klassen har null effekt og er forvirrende.

**ALTERNATIVER:**
- Beholde for "safety" — koster ingenting, men dødkode.
- Konvertere til `w-full` for å få den faktiske bredden samme som nav
  — men da kan vi miste horizontal scroll når den er nødvendig.

**KONSEKVENS HVIS ANNERLEDES:** Hvis beholdt: kosmetisk dødkode,
ingen funksjonell effekt. Hvis fjernet: koden blir tydeligere.

### BESLUTNING 3: Skeleton-state-fix?

**ANBEFALING:** Inline-skeleton i Meals.tsx flyttes til samme
overflow-pattern som DayStrip-nav (eller verifiseres at den allerede
contains). Sjekkes manuelt i samme PR.

**HVORFOR:** Skeleton vises kun under første GET-request (typisk
< 200ms), så bug-eksponering er minimal. Men hvis skeleton lekker,
første frame ser feil ut og bekrefter Christers hypotese om at
"Meals-siden bare er zoomet inn".

**ALTERNATIVER:**
- Ignorere skeleton — sannsynlig at hovedfix dekker det.
- Egen test for skeleton-layout.

**KONSEKVENS HVIS ANNERLEDES:** Hvis ignorert og det lekker:
Christer kan se kort flash av zoomed-in på første load. Akseptabel
kostnad i bytte for fokusert PR-scope.

## 6. Portainer-oppstartsrisiko-sjekk

Berører ingen av:
- `Dockerfile`, `.dockerignore` — nei
- `docker-compose.yml` — nei
- `server/http/bootstrap.js` — nei
- `server/config.js` — nei
- `server/index.js` — nei
- `server/db.js`, `server/migrations/**` — nei
- `install.sh` — nei
- `bootstrap.json`-lesning/-skriving — nei
- ENV-vars for oppstart — nei

**Portainer-risiko: NEI.** Rent frontend layout-fix uten
backend-implikasjoner.

## 7. ISO 25010-påvirkning

- **Brukbarhet (Usability) 8.6 → 8.7** (+0.1) — fikser konkret
  layout-bug som ødelegger bunnnav-tilgang på mobil. Kjernebrukere
  (mobil-fokuserte familier) vil oppleve mindre frustrasjon.
- **Vedlikeholdbarhet 8.4 → 8.5** (+0.1) — `min-w-0` på AppShell
  forhindrer fremtidige tilbakeslag av samme art. Defensiv
  beskyttelse uten kostnad.
- **Pålitelighet 8.6 → 8.6** (uendret).
- **Andre karakteristikker:** ikke berørt.

Ingen karakteristikk trekkes under 8.0.

## 8. Plan

```
1. docs(analysis): add hotfix analysis for meals-mobile-layout
2. fix(layout): add min-w-0 to <main> in AppShell to prevent
   flex-item growing beyond viewport
3. refactor(meals): clean up DayStrip's redundant min-w-full + verify
   overflow-x containment
4. test(layout): add layout-containment regression tests for AppShell
   and DayStrip
5. docs(agent-log): hotfix entry in AGENT_LOG.md
```

Hver commit selvstendig og under 200 linjer diff.

## 9. Kompleksitet-vurdering

Bugfix er liten i diff-størrelse (< 30 linjer kode total), men
diagnose krevde grundig flexbox-analyse. Visual repro er blokkert av
port-konflikt (Christers dev-server kjører på 7778 og kan ikke
drepes per CLAUDE.md DEL 7.8), så manuell verifisering blir
Christers ansvar etter at fix er pushet.

**Risiko:** hvis hovedhypotese (flexbox min-content) er feil,
fix-en har null effekt. Mitigering: fix er defensiv (skader ingenting),
og Christer kan verifisere på 30 sekunder med hot-reload på 7778.

---

## Sikkerhetssjekkliste (DEL 4)

- **Input:** ikke relevant — ingen brukerinput.
- **Auth:** ikke relevant — ingen auth-endringer.
- **Hemmeligheter:** ikke relevant — ingen secrets.
- **Data:** ikke relevant — ingen data-endringer.
- **Frontend:** ingen `innerHTML`, ingen eksterne lenker, CSP-nøytralt.

Ingen sikkerhetsimplikasjoner.
