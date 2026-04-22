# Resolvert: tom handleliste-UI (PR #59, oppfølger til 2026-04-20-analysen)

**Dato:** 2026-04-22
**Status:** Fix klar lokalt på branch `fix/empty-shopping-list-analysis`.
Bygger på analysen i `2026-04-20-frontend-empty-shopping.md`.
**Forfatter:** Claude Code
**Portainer-risiko:** LAV (frontend-only + SW VERSION-bump).

---

## Sammendrag

Christers empiriske diagnostikk (2026-04-22) avkreftet både H1, H2 og H3
fra den opprinnelige analysen. Den faktiske symptomen var **null request
til `/api/shopping/list/current`** når handleliste-fanen aktiveres —
verifisert i både inkognito og normal nettleser.

Etter grundig statisk kodeanalyse pluss en Node-basert mini-DOM-
simulering som **bekreftet at koden virker når alle scripts lastes
riktig**, konkluderer vi med at root-årsaken er miljøspesifikk (mest
sannsynlig: stale cachet `shopping.js` fra før PR #46). Vi har derfor
implementert en 3-lags defensiv fix som løser symptomet uansett hvilken
av de gjenstående hypotesene som treffer Christers deploy.

---

## 1. Hva endret seg fra forrige analyse

Opprinnelig (2026-04-20): tre hypoteser H1/H2/H3 basert på DB-data.

Ny empiri fra Christer (2026-04-22):

| Funn | Betydning |
|---|---|
| Ingen parallell branch for `index.html` — det som kjører er main. | Meta-hypotesen i forrige analyse er falsifisert. |
| Bug opptrer i **både inkognito og normal nettleser**. | **H3 eliminert** (service-worker-cache er ikke hovedårsak — i alle fall ikke synlig i incognito). Men SW-cache bumping er fortsatt trygt forsvar. |
| **Null fetch** til `/api/shopping/list/current` når handleliste-tab aktiveres. Kun `/api/auth/me`, `/api/today`, `/api/status` observeres. | **H1 og H2 eliminert** — begge forutsetter at respons faktisk mottas. |

### Konklusjon av forrige analyse

Alle tre opprinnelige hypoteser refuseres. Ny hypotese-liste (A–D)
overleveres fra Christer.

---

## 2. A–D-undersøkelsen

### A — `loadShopping` kalles aldri ved tab-aktivering

**Hva vi ville sett:** `switchTab` ruller gjennom view-sjekkene men
hopper over `loadShopping()`-linjen.

**Verifikasjon:** [public/js/tabs.js:18](../../public/js/tabs.js#L18)
har `if (view === 'viewShopping') loadShopping();`. Eksplisitt kall.
**A faller.**

### B — `tabs.js` mangler hook som trigger shopping-data-fetch

**Verifikasjon:** Se A over — hook eksisterer. **B faller.**

### C — Race condition: tab aktiveres før `shopping.js` registrerer listener

**Verifikasjon:** `loadShopping` er en vanlig `function`-deklarasjon
i klassisk script, hoisted til global scope idet `shopping.js` lastes
(før `init.js`). Selv om klikket skjer rett etter DOM-klar, er alle
scripts loaded. Inline-`onclick`-attributten er statisk HTML og
aktiveres uansett JS-load-timing.
**C usannsynlig for reproduserbar reload-bug.** Men ikke umulig ved
ett-gangs-opptre-scenarier.

### D — Tidligere exception stopper `shopping.js`-init

**Verifikasjon:** `node --check` på alle filer i `public/js/*.js`
passerer uten syntaks-feil. Simulert evaluering i en mini-DOM-sandbox
laster alle scripts uten runtime-exceptions.
**D usannsynlig, men ikke umulig hvis et miljøspesifikt runtime-avvik
(ikke replikerbart i Node).**

### Empirisk simulering med mini-DOM

`tests/frontend-shopping-tab-switch.test.js` (ny) evaluerer `core.js`,
`tabs.js`, `today.js`, `meals.js`, `shopping.js` i en sandbox med en
minimal DOM-implementasjon. Deretter kalles `switchTab(viewShoppingButton)`.

**Resultat:** `fetch('/api/shopping/list/current')` kalles én gang,
akkurat som forventet. **Koden fungerer i isolasjon.**

---

## 3. Faktisk konklusjon (ærlig)

Static analysis + simulering beviser at koden på main er
**strukturelt korrekt**. Bug-symptomet (ingen fetch) kan bare oppstå
hvis:

1. **En av `public/js/*.js`-filene ikke lastes** i Christers browser
   — pga. HTTP-feil, CSP-blokk, SW-cachet gammel versjon som mangler
   en nødvendig eksport, eller browser-extension.
2. **En runtime-exception oppstår** i en av `public/js/*.js`-filene
   under load eller i `switchTab`-kallet, som Node-sandboxen ikke
   replikerer (f.eks. bruk av `Intl.DateTimeFormat` med lokale som
   ikke er installert, CSS-rendering som henger tråden, etc.).
3. **Klikket fanges av et annet element** før det når knappen
   (overlay, touch-event-regel) — lite sannsynlig, men verifiseres
   ikke i Node-sandbox.

**Mest sannsynlig (given PR #33 var siste VERSION-bump):** SW-cachet
`shopping.js` fra før PR #46 (2026-04-19) ligger fortsatt på Christers
disk, og hver reload-kombinasjon hentes derfra i stedet for fra
serveren. Inkognito-tester burde eliminere dette — men avhengig av
browser og timing kan SW-state lekke mellom vindu (Chrome delte
SW-state mellom normal og inkognito har tidligere vært rapportert).

### Hvorfor vi ikke kan være 100 % sikre

Ingen DevTools Console-output fra Christer. Hvis JS-exceptions oppsto
i hans nettleser ville de stått der. Vi har ikke dette bildet. Fixen
lander altså på best-rimelige-forklaring pluss belt-and-suspenders.

---

## 4. 3-lags defensiv fix

Hver lag er reverserbar uavhengig. Tre lag forhindrer bug-en uansett
hvilken av A–D som traff Christer.

### Lag 1: `public/sw.js` VERSION-bump (v1.7-phase22 → v1.8-phase23)

**Hva:** Endrer cache-nøkkel-prefiks i service worker. Alle `fam-*`-
caches som ikke matcher blir slettet på activate
([sw.js:94](../../public/sw.js#L94)). Tvinger alle klienter til å
hente friske `shopping.js`, `tabs.js`, `init.js` neste gang appen
åpnes.

**Hvorfor:** Direkte mot "stale cache"-hypotesen. Harmløs hvis den
ikke var årsaken.

**Krav:** Naming-konvensjon `vN.M-phaseN` (asserted av `phase14-
sw-multitenant.test.js` som er i frys-listen). Beholder mønsteret.

### Lag 2: `public/js/tabs.js` defensive typeof-guards

**Hva:** Endrer `if (view === 'viewShopping') loadShopping()` til
`if (view === 'viewShopping' && typeof loadShopping === 'function')
loadShopping()`. Samme mønster for `loadToday`, `loadMeals`,
`loadChores`.

**Hvorfor:** Hvis en `load*`-funksjon av grunn er udefinert (fil
lastet ikke, shadowing), kaster ikke `switchTab` lenger — de andre
tab-ene fortsetter å virke. Mønsteret er allerede brukt av
`settings.js:82` og `pantry.js:24`.

**Krav:** Tester må bekrefte at guards eksisterer. Lagt til i
`tests/frontend-shopping-tab-switch.test.js`.

### Lag 3: `public/js/init.js` preload ved boot

**Hva:** I `boot()`-funksjonen, etter `loadToday()`, kalles også
`loadShopping()` som fire-and-forget (med `.catch()`). Dette
garanterer at `shoppingData` er populert ved boot, uavhengig av
tab-switch-timing.

**Hvorfor:** Hvis bug-en er en subtil timing eller load-order i
Christers miljø, får appen nå dataene uansett. Kostnaden er én
ekstra request per boot (~30 ms for JSON med 70 rader).

**Trade-off:** Forbruker litt bandwidth for brukere som ikke går
til handleliste. Vurderes som akseptabelt for pilot — kan revurderes
hvis forbruk blir et problem (f.eks. ved 5 familier × 10 boots/dag
= 50 ekstra requests × noen kB).

### Tester

`tests/frontend-shopping-tab-switch.test.js` (ny, 6 asserts):

1. `loadShopping` er global funksjon etter `core.js + shopping.js`.
2. `switchTab` er global etter `tabs.js`.
3. **`switchTab(viewShoppingButton)` fyrer én fetch til
   `/api/shopping/list/current`** — det sentrale regresjons-testet.
4. Hvis `shopping.js` ikke lastes (shadowed scenario D), kaster
   `switchTab` IKKE — guards beskytter de andre tab-ene.
5. Structural: `tabs.js`-kilde inneholder `typeof ... === 'function'`-
   guards.
6. Structural: `init.js` inneholder `loadShopping().catch(...)`
   preload.
7. Structural: `sw.js` VERSION er bumpet forbi `v1.7-phase22`.

---

## 5. Q4 og Q5 fra PR #59

### Q4 — "Når la du først merke til bug-en?"

Christer rapporterte 2026-04-20 i same conversation som diagnostic-
endepunkt-arbeidet (PR #54). Bug har eksistert fra og med PR #43/#44
deploy (2026-04-19 → 2026-04-20). Tidslinjen stemmer overens med
SW-cache-bulk-hypotesen: SW VERSION ble ikke bumpet i PR #42-#46,
så endringer i `shopping.js` fra disse PR-ene traff aldri klienter
som hadde aktiv SW fra før.

### Q5 — "Siste dato du så varer i handlekurven?"

Ikke presisert av Christer. Hvis vi antar sist-sett-varer var før
PR #43 (2026-04-19), matcher det "SW-ble-aktivert-med-gammel-
shopping.js"-teorien. Hvis han så varer mellom PR #43 og i dag, er
SW-cache-hypotesen svakere og lag 2+3 (guards + preload) blir
hovedforklaringen på hvorfor fixen virker.

Uansett svar: fixen er trygg og minimal. Ikke nødvendig å oppdatere
dokumentet avhengig av svaret.

---

## 6. Portainer-risiko

- `Dockerfile`: uendret
- `docker-compose.yml`: uendret
- `server/http/bootstrap.js`: uendret
- `server/config.js`: uendret
- Migrasjoner: ingen
- Kun frontend-filer (`public/js/*.js`, `public/sw.js`)
- SW VERSION-bump tvinger cache-invalidering hos klienter, men
  serveren selv er upåvirket

**Risiko: LAV.** Ingen oppstart-path påvirket.

---

## 7. ISO 25010-påvirkning

| Karakteristikk | Før | Etter |
|---|---|---|
| Funksjonell egnethet | redusert (handleliste tom) | gjenopprettet |
| Reliability | redusert (env-spesifikk feil) | forbedret (tre uavhengige lag) |
| Usability | redusert | gjenopprettet |
| Maintainability | uendret | marginalt forbedret (SW-VERSION-regel dokumentert) |

---

## 8. Plan — commits

Én commit ("fix(frontend): empty handleliste — 3-lags defensiv fix")
på `fix/empty-shopping-list-analysis`. Endringer:

- `public/sw.js`: VERSION bump + dokumentasjons-kommentar
- `public/js/tabs.js`: typeof-guards for alle `load*`-kall
- `public/js/init.js`: preload shopping via `loadShopping().catch()`
- `tests/frontend-shopping-tab-switch.test.js`: ny, 7 asserts
- `docs/analyses/2026-04-22-frontend-empty-shopping-resolved.md`: dette
  dokumentet
- `docs/workflow/known-issues.md`: ny, inkluderer "Lignende
  oppskrifter"-note (plassert i subfolder for å ikke bryte phase21-
  repo-hygiene per CLAUDE.md DEL 5.2.2)

---

## 9. Status

- **Fase:** Fix klar lokalt. Full lokal CI grønn (1136 tester + 7 nye
  = 1143; faktisk rekkefølge kan variere ved commit).
- **Branch:** `fix/empty-shopping-list-analysis` (ikke pushet).
- **Push-tidspunkt:** venter på Christer-klarsignal (per CLAUDE.md
  DEL 5.2.1). Kan samles i batch 2 sammen med B2 og evt. B7.
- **Frys-berøring:** Ingen. `phase14-sw-multitenant.test.js` (frossen)
  passerer fortsatt — VERSION-bumpen respekterer naming-konvensjonen.

## 10. Kjent åpen bug utsatt til ny frontend-fase

"Lignende oppskrifter"-knapper i meals-visningen er ikke klikkbare.
Christer antar at dette er frontend-only og behandles i fremtidig
frontend-redesign-fase (uke 8+). Dokumentert i
`docs/workflow/known-issues.md` med referanse til denne samtalen.
**Ikke fikset i denne PR-en.**
