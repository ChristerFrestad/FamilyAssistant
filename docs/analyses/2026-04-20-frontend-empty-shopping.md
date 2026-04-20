# Analyse: UI viser 0 varer i handleliste mens DB har 70 rader

**Dato:** 2026-04-20
**Forfatter:** Claude Code (agent)
**Baseline:** `main` commit `d7a5c38` (etter merge av PR #54/#57/#58)
**Symptom rapportert av:** Christer, 2026-04-20 etter at `GET /api/debug/shopping-state` ble kjørt

> **VIKTIG:** Denne analysen er skrevet mot `main`-koden slik den ser ut på
> `d7a5c38`. Christer har signalisert at han **jobber parallelt i
> `public/index.html`** — den branch-en er ikke inkludert i baseline. Før
> fiks-fasen starter trenger vi commit-SHA for det arbeidet slik at vi
> ikke overrasker hverandre. Se § **Spørsmål til Christer**.

---

## Utgangsdata fra diagnostikk (PR #54, endepunktet fjernet i #57)

```
shopping_list_items.total_rows        = 70
shopping_list_items.bought_rows       = 0
shopping_list_items.sample_bought     = []
pantry_entries.total_rows             = 35
migrations.applied_total              = 18
```

UI: **0 varer synlige i handlekurv-tab**. Dette er post-PR #44 og #46.
Test-0.2-bug-en ("defaulter til bought") er allerede fikset.

---

## 1. Reisen — fra app-åpning til tom handleliste

### 1. Bruker åpner appen i nettleser

1.1 **Service worker-aktivering** ([public/sw.js:16](../../public/sw.js#L16))

1.1.1 `VERSION = 'v1.7-phase22'` — cache-key er `fam-static-${VERSION}`
      og `fam-api-${VERSION}`. Hvis ikke bumpet siden sist kode-endring
      serveres gammel `shopping.js` fra cache.

1.1.2 Pre-cachede assets inkluderer alle `/js/*.js` inkludert
      `/js/shopping.js` og `/js/core.js` ([sw.js:23-57](../../public/sw.js#L23)).
      Når klient har cached disse på en tidligere VERSION og VERSION
      ikke har endret seg, får klienten gammel kode selv etter deploy.

1.1.3 Cache-invalidering skjer på `activate`-event
      ([sw.js:94](../../public/sw.js#L94)) — ALLE `fam-*`-caches som ikke
      matcher nåværende VERSION slettes. Dette skjer **kun når VERSION
      endres** (ny sw.js med ny VERSION installeres).

1.2 **Første render** ([public/js/init.js](../../public/js/init.js))

1.2.1 `bootAuth()` kjører først — returnerer `false` hvis
      ikke-autentisert, da overstyres hele app-shellen til `/login.html`.
      Dev-mode uten AUTH_TOKEN returnerer `true` via
      LOCAL_USER-fallbacken.

1.2.2 `loadToday()` er første tab som lastes — den treffer
      `/api/meals/week/current` og `/api/today`, **ikke** handleliste.
      Shopping-lasting skjer først ved tab-klikk (se steg 2).

1.2.3 Service worker registreres og polles for oppdateringer hver
      time ([init.js:27](../../public/js/init.js#L27)). Ved ny sw
      vises toast "Ny versjon tilgjengelig — last siden på nytt".

### 2. Bruker navigerer til handleliste-tab

2.1 **Tab-switch event** ([public/js/tabs.js:3](../../public/js/tabs.js#L3))

2.1.1 `switchTab(el)` fanger `onclick` på `<button class="tab"
      data-view="viewShopping" onclick="switchTab(this)">`
      ([index.html:205](../../public/index.html#L205)).

2.1.2 CSS-synlighet styres av `.view.active` vs `.view` — shopping-
      panelet (`#viewShopping`) får `.active` og vises. Handlingen er
      ren DOM-klasse-toggle, ingen display:flex/none fra PR #44 er
      involvert her.

2.1.3 DOM-elementet som fylles med handlelisten er
      `<div id="shoppingContent" aria-busy="true">`
      ([index.html:62-70](../../public/index.html#L62)). Skeleton-
      kortet vises til `renderShopping()` setter `innerHTML`.

2.2 **Data-lasting** ([public/js/shopping.js:13](../../public/js/shopping.js#L13))

2.2.1 `loadShopping()` kaller `api('/api/shopping/list/current')`. Ingen
      query-parameters, ingen kategori-filter på klient.

2.2.2 `api()` (core.js) legger til `Authorization: Bearer <TOKEN>` når
      token er tilgjengelig, og `Content-Type: application/json`.

2.2.3 Fetch går gjennom service worker hvis registrert. Siden
      `/api/shopping/list/current` ikke matcher `NO_CACHE_API_PREFIXES`
      ([sw.js:61-72](../../public/sw.js#L61)), brukes `apiNetworkFirst()`
      ([sw.js:166](../../public/sw.js#L166)): nettverk prioriteres, men
      forrige vellykket respons caches og returneres hvis nettverk
      feiler.

2.3 **Respons-mottak** ([public/js/shopping.js:13-22](../../public/js/shopping.js#L13))

2.3.1 Respons parses til `shoppingData` (global variabel i
      [core.js:73](../../public/js/core.js#L73)).

2.3.2 `currentShoppingListId` settes til `data.id || null`. Hvis backend
      returnerer `id: null` (se steg 3.2 nedenfor), vil
      `retryEnrichment()` og andre list-id-avhengige handlinger være
      no-ops.

2.3.3 `renderShopping()` kalles direkte — ingen explicit event-trigger.

2.4 **Rendering til DOM** ([public/js/shopping.js:32-99](../../public/js/shopping.js#L32))

2.4.1 `renderShopping()` bygger HTML-streng, starter med en segmentert
      toggle (Å kjøpe / Pantry) basert på `shoppingSubView` (default:
      `'buy'` fra [core.js:77](../../public/js/core.js#L77)).

2.4.2 Hvis `shoppingSubView === 'pantry'`: delegerer til
      `renderPantryInline()` + `loadPantry()`. Dette er en alternativ
      render-sti. Hvis `shoppingSubView` av ukjent grunn er `'pantry'`
      ved oppstart (f.eks. localStorage gjenoppretter den, eller bug i
      init), ville UI vise pantry-visningen og ikke shopping-lista.

2.4.3 **Filter-logikken:** `for (const cat of data.categories || []) {
      ... for (const item of cat.items) { ... } }`
      ([shopping.js:68](../../public/js/shopping.js#L68)). Hvis
      `data.categories` er `[]`, løkken har null iterasjoner og kun
      segmented toggle + tom total + legg-til-form rendres. **Dette er
      det mest sannsynlige observerte symptomet.**

### 3. Server bygger responsen

3.1 **Rute-handler** ([server/routes.js:747](../../server/routes.js#L747))

3.1.1 `ensureCurrentWeek(repos)` returnerer `seed.getWeekYear()` — i
      dag (2026-04-20, mandag): `'2026-W17'`.
      ([seed.js:2296](../../server/seed.js#L2296))

3.1.2 `repos.shoppingLists.getActive(wk)` gjør SQL:
      ```
      SELECT ... FROM shopping_lists
      WHERE family_id = ? AND week_year = ? AND status = 'active'
      LIMIT 1
      ```
      ([shopping.repo.js:134-153](../../server/repositories/shopping.repo.js#L134))

3.1.3 **Hvis ingen aktiv liste for uken:** returnerer tomt skall
      med `categories: []` ([routes.js:753-762](../../server/routes.js#L753)):
      ```js
      { id: null, weekYear: wk, status: null,
        enrichmentStatus: 'done', items: [], categories: [],
        totalEstPrice: 0 }
      ```

3.2 **Hvis aktiv liste finnes:** itererer over items, grupperer etter
    `item.category || 'Tørrvarer & annet'`
    ([routes.js:766-787](../../server/routes.js#L766)). Bought items
    forblir i lista (toggle-ikke-skjul siden test 0.2) med
    `checkedOff: true`.

3.3 **`family_id` kommer fra `getFamilyId()`**
    ([family-context.js:36](../../server/auth/family-context.js#L36)),
    som leser AsyncLocalStorage-kontekst. Default-fallback er
    `LEGACY_FAMILY_ID = 1` for single-tenant-deploy uten auth.

---

## 2. Tre hovedhypoteser

### H1 — UKE-MISMATCH (høy sannsynlighet)

**Påstand:** De 70 radene i `shopping_list_items` tilhører en
`shopping_lists`-rad for en **tidligere uke** (f.eks. `2026-W16`).
Ingen aktiv liste eksisterer for `2026-W17`, så `getActive(wk)`
returnerer `null` → API svarer med `categories: []` → UI tom.

**Verifikasjon:**

- Kjør i container:
  ```js
  const db = require('better-sqlite3')('/app/data/familieassistenten.db', { readonly: true });
  db.prepare(`SELECT id, family_id, week_year, status, generated_at
              FROM shopping_lists ORDER BY generated_at DESC LIMIT 10`).all();
  db.prepare(`SELECT list_id, family_id, COUNT(*) as c
              FROM shopping_list_items GROUP BY list_id, family_id`).all();
  ```
- Forventet hvis H1 sann: `shopping_lists.week_year != '2026-W17'` eller
  ingen rad har `status = 'active'` for `2026-W17`.

**Involverte filer:**
- [server/services/seed.service.js:61](../../server/services/seed.service.js#L61)
  `ensureCurrentWeek` — seeder meal-plans for ny uke, men IKKE
  shopping-lister
- [server/routes.js:69-84](../../server/routes.js#L69)
  `maybeAutogenerateShoppingList` — oppretter shopping-liste KUN når
  uke er "komplett" og kalles kun fra meal-mutasjoner
- Ingen cron eller auto-handler seeder `shopping_lists` ved uke-rollover

**Sannsynlighet:** HØY. Nåværende auto-generering er betinget
(`isWeekComplete(weekYear)` + meal-plan-mutasjon). Hvis Christer ikke
har endret meal-plan i inneværende uke, blir ingen liste laget.

### H2 — STATUS-MISMATCH (middels sannsynlighet)

**Påstand:** En shopping-liste for `2026-W17` eksisterer, men har
`status != 'active'` (f.eks. `'confirmed'` etter "Ferdig handlet",
`'archived'`, eller en migrasjon endret feltet). `getActive()`
filtrerer den bort.

**Verifikasjon:**

- Samme SQL som H1, se etter `status`-kolonnen. Hvis rader finnes for
  `2026-W17` men ingen er `'active'`, er H2 sann.
- Søk i kodebase for `UPDATE shopping_lists SET status =`:
  ```
  confirmed : mulig satt av confirm-handler
  archived  : sett av archive-handler
  active    : default ved insert (create)
  ```

**Involverte filer:**
- [server/repositories/shopping.repo.js](../../server/repositories/shopping.repo.js)
  (create, confirm, archive)
- [server/routes.js](../../server/routes.js) shopping/confirm- og
  shopping/archive-endepunkter

**Sannsynlighet:** MIDDELS. Status-felter er sjelden feilstilt, men
en uoppmerksom `confirm`-klikk tidligere denne uken ville falle under
H2.

### H3 — SERVICE-WORKER-CACHE AV GAMMEL `shopping.js`

**Påstand:** Klientens service worker har cached en gammel versjon av
`shopping.js` (pre-PR #46) hvor rendering-filter er buggy.
`VERSION='v1.7-phase22'` har ikke blitt bumpet siden PR #46 merget,
så clients med cached sw.js fra før #46 får gammel fil-cache uten å
oppdatere.

**Verifikasjon:**

- Be Christer teste i **inkognito-vindu** (ingen service worker). Hvis
  bug forsvinner: H3 bekreftet.
- Sjekk commit-log for PR #46 (`1b9bd9d`) og senere: ble `sw.js`
  VERSION bumpet?
- I DevTools → Application → Service Workers: verifiser aktiv
  VERSION og cache-innhold.

**Involverte filer:**
- [public/sw.js:16](../../public/sw.js#L16) `VERSION = 'v1.7-phase22'`
- [public/js/shopping.js](../../public/js/shopping.js)

**Sannsynlighet:** LAV-MIDDELS. Nettverk-først for API betyr at selv
med cached shopping.js vil respons fra backend være fersk. Bug-en må
ligge i render-koden. Inkognito-test er billig og avgjør raskt.

### Meta-hypotese: CHRISTERS PARALLELLE ARBEID I `index.html`

Christer jobber på en branch som endrer `public/index.html`. Mulige
scenarier på den branch-en som ville forklare bug-en **uavhengig av
H1/H2/H3 over:**

- `#shoppingContent`-id er omdøpt → `renderShopping()` kaller
  `document.getElementById('shoppingContent')` som returnerer `null`
  → `if (el)`-vernen på [shopping.js:93-98](../../public/js/shopping.js#L93)
  sluker feilen stille. Ingenting rendres.
- Tabben er erstattet med ny layout hvor klikk ikke lenger kaller
  `switchTab(this)` med `data-view="viewShopping"`. `loadShopping()`
  kalles aldri.
- Script-rekkefølgen i `<head>` er endret slik at `shopping.js`-
  funksjoner ikke er definert når `init.js` kjører.

Alle disse er konkrete å sjekke når branch-en er tilgjengelig. Fram
til da er meta-hypotesen uavhengig av H1-3 og må re-vurderes.

---

## 3. Edge-cases (minst 8)

1. **Bruker har flere browser-vinduer** i forskjellige tabs. Ett vindu
   kjører gammel sw, det andre ny. Rendering kan variere.
2. **Bruker har gammel sw cached, åpner appen på 4G**. `apiNetworkFirst`
   faller tilbake til cached respons hvis nettverk er tregt nok til
   å timeoute.
3. **API returnerer 200 med tom `categories: []`** — ingen feil, bare
   tom data (H1/H2).
4. **API returnerer 200 med 70 rader, men i `items`-arrayet, ikke
   `categories`** — render-løkken ignorerer `items` helt
   ([shopping.js:68](../../public/js/shopping.js#L68)).
5. **Response har `categories: undefined`** — `data.categories || []`
   ([shopping.js:68](../../public/js/shopping.js#L68)) faller tilbake
   til `[]`, ingen crash, ingen rendring.
6. **`shoppingSubView` er `'pantry'`** fra tidligere sesjon (hvis en
   av de parallelle frontend-endringene introduserer persistering til
   localStorage, ikke til stede i dag). Render går direkte til pantry-
   sub-view, og buy-lista vises aldri.
7. **Race condition:** tab-bytte trigger `loadShopping()` før forrige
   fetch er ferdig. Hvis 1. fetch svarer sist, kan gammel respons
   overskrive ny.
8. **localStorage har gammel `familyId` eller token.** Auth-middleware
   kan sette feil `family_id` i AsyncLocalStorage → `getActive(wk)`
   kjører med feil family_id → finner ikke familien sin liste.
9. **Field-navn-mismatch:** Hvis server en gang returnerer `category`
   (snake_case) mens frontend forventer `categories` (plural),
   ville frontend aldri se rader. Sjekk SQL-kolonner vs rute-output.
10. **Bruker er logget ut.** `api()` ville få 401 → toast vises, men
    fetch-promise rejecter. Render kalles ikke. Skeleton-kortet blir
    stående. Dette ville være synlig som "evig skeleton", ikke som "tom
    liste". Utelukk etter bekreftelse på UI-utseende.
11. **Service worker serverer offline-fallback 503** (eget Response-
    objekt ved nettverksfeil) — `api()` ville throw. Skeleton blir
    stående.
12. **DB-låst / WAL-write pågår** på RPi-SD-kortet — `getActive`
    kaster. `api()` får 500. Ikke likely siden better-sqlite3 er
    synkron og robust.

---

## 4. Konsekvenser på tvers

- **pantry.js** har tilsvarende render-mønster (`for (const item of
  data.items)`). Hvis bug ligger i responsformat, kan pantry-tab også
  være påvirket — men Christers rapport sier 35 pantry-rader er
  synlige. Så rendering er OK. Det peker mot H1 eller H2 (data-nivå),
  ikke render-nivå.
- **meals.js** bruker `currentWeek` fra samme response. Hvis
  week-mismatch (H1), er også meal-plan-visningen sårbar — men
  `ensureCurrentWeek` seeder meal-plans automatisk, ikke shopping-
  lister. Asymmetrien forklarer hvorfor bare shopping er tom.
- **Tenant-isolation-tester** fanger ikke denne situasjonen — de
  sjekker at family A ikke ser family B sine rader, ikke at family
  A ser egne rader for nåværende uke.
- **E2E-tester** for shopping finnes i [tests/](../..) og bruker seed-
  data. De simulerer ikke uke-rollover og kjører derfor ikke inn i
  H1-tilstanden.

---

## 5. Portainer-oppstartsrisiko-sjekk

- **Rører fixen `Dockerfile`, `docker-compose.yml`,
  `docker-entrypoint.sh`?** Nei uansett hvilken hypotese.
- **Rører fixen `server/http/bootstrap.js` eller `server/config.js`?**
  Nei.
- **Rører fixen migrasjoner?** Mulig hvis H1 løses med ny
  `ensureCurrentWeekShoppingList`-seed-hook i `server/services/` —
  men dette er SQL-insert ved oppstart, ikke schema-migrasjon.
- **Kan fixen påvirke hvordan containere starter opp?** Svak risiko
  kun hvis H1 krever seed-hook som kjører ved boot. I så fall:
  logging + try/catch slik at bygge-oppstart ikke brekker. Ikke
  destruktiv migrasjon.

**Konklusjon:** Ingen Portainer-risiko for H3 (cache) eller H2
(status-fix). Lav risiko for H1 hvis vi legger til seed-hook; håndteres
med samme defensive pattern som `ensureCurrentWeek` bruker for
meal-plans.

---

## 6. ISO 25010-påvirkning

| Karakteristikk | Før | Etter fix | Kommentar |
|---|---|---|---|
| Usability | redusert | forbedret | hovedfunksjon gjenopprettet |
| Funksjonell egnethet | redusert | forbedret | shopping-lista er kjerne-feature |
| Reliability | uendret | forbedret | regresjonstest fanger gjentakelse |
| Performance | uendret | uendret | ingen nye queries |
| Security | uendret | uendret | ingen auth-endringer |
| Compatibility | uendret | uendret | |
| Maintainability | uendret | forbedret | tydeligere auto-generering |
| Portability | uendret | uendret | |
| Safety | uendret | uendret | |

Tall-verdier ikke satt — krever baseline-måling fra uke 17-rapporten.
Kvalitativ effekt dokumentert.

---

## 7. Plan — konkrete commits per hypotese

### Plan for H1 (uke-mismatch)

Commit A: `fix(shopping): auto-generate active shopping list for new week`
- Ny funksjon i `server/services/seed.service.js`:
  `ensureCurrentWeekShoppingList(repos)` som seeder en tom aktiv liste
  hvis ingen finnes for nåværende uke.
- Kalles fra `server/index.js:107` sammen med `ensureCurrentWeek(repos)`.
- Idempotent; rører ikke eksisterende lister.

Commit B: `test(shopping): regression test for week-rollover empty list`
- `tests/shopping-week-rollover.test.js`: simuler uke-rollover via
  stubbed `getWeekYear()`, verifiser at GET `/api/shopping/list/current`
  returnerer ikke-tom `categories` etter `ensureCurrentWeek*`.

Commit C: `docs: update RUNBOOK for shopping list auto-generation`
- Noterer hva som seeder hva ved boot.

### Plan for H2 (status-mismatch)

Commit A: `fix(shopping): getActive should also return confirmed lists if no active exists`
- I `getActive(weekYear)`: hvis ingen `status='active'`, fallback til
  nyeste i uken uansett status (unntatt `archived`). Eller: endre UI
  til å håndtere `status='confirmed'` eksplisitt med "Denne handle-
  listen er låst"-melding.
- Beslutning må tas med Christer siden UX-semantikken er viktig.

Commit B: `test(shopping): confirmed-status list should still render`
- Regresjonstest.

Commit C: `docs(domain): clarify shopping list status lifecycle`
- Oppdater DOMAIN_MODEL.md.

### Plan for H3 (SW-cache)

Commit A: `fix(sw): bump VERSION to invalidate stale cached shopping.js`
- `public/sw.js`: `VERSION = 'v1.8-phase23'` (eller tilsvarende
  neste).
- Ingen test — cache-adferd testes manuelt via inkognito og DevTools.

Commit B: `docs(sw): add checklist for bumping cache version`
- README-notat om at enhver PR som endrer `public/js/*` må bumpe
  VERSION.

---

## 8. Spørsmål til Christer (må besvares før fix-fase)

1. **Hvilken branch jobber du på i `public/index.html`**, og **siste
   commit-SHA**? Er arbeidet pushet til remote enda? Hvis ikke: kort
   beskrivelse av hva du endrer (feks. layout-refaktor, ny tab-
   struktur, responsivt design) slik at jeg vet hva som ligger
   utenfor scope av denne analysen.

2. **Hvilken nettleser ser du bug-en i** — Chrome, Safari, Firefox
   eller annet? Og: **opptrer bug-en også i inkognito-modus**? Dette
   utelukker/bekrefter H3 (service-worker-cache) umiddelbart.

3. **Kan du åpne DevTools (F12) → Network-fanen**, klikke på
   handleliste-tab-en, finne `GET /api/shopping/list/current`-kallet
   og kopiere:
   - **Response-body** (hele JSON-et). Er `categories` en tom array,
     eller har den faktiske rader?
   - **Response-headers**, spesielt `X-SW-Cache` (hvis tilstede betyr
     det at sw serverte stale cache).

4. **Når la du først merke til bug-en?** Og: har du nylig klikket på
   en "Ferdig handlet" / "Arkiver liste"-knapp i shopping-tabben?
   Det ville peke mot H2.

5. **Hvilken dato var det sist du så varer i handlekurven?**
   Hvis det var før mandag 2026-04-20, peker det sterkt mot H1
   (uke-rollover).

Ikke start kode før disse er besvart. H1 vs H2 vs H3 har tre helt
forskjellige fiks-planer.

---

## Status

- **Fase:** Analyse (draft PR — kun dette dokumentet)
- **Neste:** Christer svarer på spørsmål. Deretter velges konkret
  plan (H1 / H2 / H3) og fiks-fase starter med ny commit på samme
  branch.
- **Portainer-risiko:** LAV (alle tre plans).
- **Frysen berøres:** Nei.
