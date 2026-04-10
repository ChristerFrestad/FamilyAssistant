# Plan: Logikk-review + end-to-end shopping flow

**Dato:** 2026-04-10 (oppdatert 13:30)
**Kontekst:** Brukeren ba om en logikk-gjennomgang av den fulle kjeden Pantry → Familieoppskrifter → Middagsforslag → Ukeplan → Handleliste → Butikk → Pantry, for å se om vi har hoppet over steg før vi fortsetter på Kassal-integrasjon (fase 3b+). Det har vi. Flere.

## STATUS PER 2026-04-10 13:30

- **Fase A:** ✅ FERDIG (22/22 tester grønne). Migration 007, shoppingLists-repo, `isWeekComplete`, `generateForWeek`, alle 5 routes, autogenerer-hook, `confirmReceipt` capture-hook — alt levert.
- **Fase B:** 🟡 HALVVEIS. `shopping-list-enricher.service.js` er skrevet (enrichList + enrichPendingLists + enrichInBackground + delayMs=1100), og `shoppingLists.listPendingEnrichment` er lagt til repo. **Gjenstår:** wire `enrichInBackground` inn i `POST /api/shopping/generate` + `maybeAutogenerateShoppingList`, ny `POST /api/shopping/list/:id/enrich`-route, ny cron-jobb `shoppingEnrichmentJob`, tester (mock global.fetch).
- **Fase C:** ❌ IKKE STARTET. EN↔NO ordbok/normalisering mangler fortsatt.
- **Fase D:** ❌ IKKE STARTET. Recipe-upload (tekst + bilde) mangler fortsatt.

**Neste anbefalte skritt:** fullfør Fase B (rørlegger-jobb, ~2–3t) før C eller D.

---

## Brutal sannhet først

**Iterasjon 3a (fullført) ga oss en SKU-resolver som ingenting bruker.** `product-resolver.service.js` kalles i dag kun fra tester. Den er ikke koblet til:

- `receipt.service.confirmReceipt` (fase 3b — vi stoppet før dette)
- `shopping-list.service.buildShoppingList` (denne gjør 0 Kassal-kall, uansett)
- Noen som helst "bruker kjøpte dette"-flow

**Handlelisten i systemet er ikke en entitet.** `GET /api/shopping/current` bygger en liste i minne fra `meal_plans + inventory + consumables + shopping_extras` og returnerer den. Det finnes **ingen `shopping_lists`-tabell**. Det betyr:

- Bruker kan ikke "merke som kjøpt" persistent — `PUT /api/shopping/check` skriver til `inventory.addPurchase`, men listen selv har ingen state
- Ingen Kassal-berikelse kan lagres på lista
- Ingen "jeg har ikke denne likevel"-hook mot pantry
- Listen genereres på nytt hver eneste request

**"Uken er komplett" finnes ikke som konsept.** `meal_plans.status` har `planned/cooked/skipped/away`, men ingen kode sjekker om hele uken er "ferdig valgt" før handleliste genereres. Handlelisten bygges alltid on-demand for `weekYear`.

**Oppskrift-opplasting finnes ikke.** Eneste recipe-endepunkter er `GET /api/recipes`, `GET /api/recipes/:id`, og `POST /api/llm/recipe` (LLM *genererer* en oppskrift fra query). Ingen tekst-paste. Ingen bilde-OCR. Ingen Pinterest-import.

**EN→NO oversettelse finnes ikke.** Engelske ingrediensnavn går rett inn i Kassal-søk som de er.

---

## Gap-tabell (kun det viktige)

| # | Fra brukerens flow | Status |
|---|---|---|
| G1 | Last opp oppskrift (tekst + bilde, NO + EN) | **MANGLER** |
| G2 | Pinterest-bibliotek → middagsforslag | **MANGLER** (kun `recipes.pinterest_url`-kolonne) |
| G3 | Pantry auto-fyller fra bekreftede kvitteringer | **FINNES** (`confirmReceipt` → `inventory.upsertManual`) |
| G4 | Pantry auto-fyller fra "kjøpt i handleliste" | **DELVIS** (skriver til `inventory.addPurchase` men ikke `inventoryLog`, ingen Kassal-kobling, ingen `productResolutions.incrementConfirmed`) |
| G5 | Middagsvalg + "ikke hjemme"-markering | **DELVIS** (`status='away'` finnes, men ingen `removed`-tilstand, ingen UI-flow) |
| G6 | "Uken er komplett"-trigger | **MANGLER** |
| G7 | Handleliste = middager − pantry | **DELVIS** (logikk finnes i `buildShoppingList`, men uten persistens) |
| G8 | Handleliste persistert (kan merke kjøpt, kan berikes) | **MANGLER** (ingen `shopping_lists`-tabell) |
| G9 | "Jeg har ikke denne varen likevel" → flytt til kjøpsliste | **MANGLER** |
| G10 | EN↔NO ingrediens-matching | **MANGLER** |
| G11 | Kassal-oppslag per handleliste-vare, rate-limited (55 RPM, 60s backoff) | **MANGLER** (token bucket finnes i `kassal-client`, men kalles aldri fra handleliste-flow) |
| G12 | Bulk-kø for mange varer i én generering | **MANGLER** |
| G13 | "Merk som kjøpt" → pantry + `incrementConfirmed` på resolution | **MANGLER** |
| G14 | Multi-bruker / husholdning | **MANGLER** (ingen `users`-tabell, alt globalt) |

**Sum:** 10 mangler, 3 delvise, 1 fungerer. Iterasjon 3a bygde et bibliotek uten kallesteder. Iterasjon 2 (kvitteringer) bygger persona-data som ingen bruker av enda.

---

## Retning: Gjør handlelisten til hjørnesteinen

Jeg foreslår å ikke starte på 3b (capture i `processUpload`) enda. I stedet **gjør handlelisten til en førsteklasses entitet** og la alt annet henge seg på den. Grunnen:

1. Handlelisten er **det stedet hvor brukerens intent møter Kassal**. Det er her rate-limit-disiplin faktisk har konsekvens.
2. Handlelisten er **det naturlige stedet å merke vare som kjøpt**. Når brukeren trykker "kjøpt", oppdaterer vi pantry **og** `productResolutions.incrementConfirmed` — det gir oss fase 3b gratis, og det gir oss det adaptive persona-signalet.
3. Handlelisten **trenger EN→NO og resolver** for å fungere, så begge de bitene blir brukt umiddelbart.
4. "Uken er komplett"-triggeren er motivasjonen for hvorfor handlelista skal persisteres i det hele tatt.

Recipe-upload og Pinterest er egne arbeidspakker som kan gå parallelt eller etterpå — de blokkerer ikke handleliste-flowen så lenge det finnes en håndfull recipes i basen (og det gjør det via seed).

---

## Fase-inndeling

Jeg deler arbeidet i 4 faser. Hver fase er leverbar alene og etterlater systemet i grønn tilstand.

---

### Fase A — Persistent handleliste + "uke komplett"-trigger

**Mål:** `shopping_lists` blir en tabell. "Uken komplett" trigger generering. Manuell regenerering også støttet.

**Leveranser:**

1. **Migration 007 — `shopping_lists` + `shopping_list_items`**
   ```sql
   CREATE TABLE shopping_lists (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     week_year          TEXT NOT NULL,
     status             TEXT NOT NULL CHECK (status IN (
                          'draft',       -- automatisk generert, ikke aktivert
                          'active',      -- bruker handler fra den
                          'done',        -- alt hake, lukket
                          'superseded'   -- ny liste generert over denne
                        )),
     generated_at       TEXT NOT NULL DEFAULT (datetime('now')),
     confirmed_at       TEXT,
     notes              TEXT,
     enrichment_status  TEXT NOT NULL DEFAULT 'pending'
                        CHECK (enrichment_status IN ('pending','running','done','partial','failed')),
     enrichment_started_at TEXT,
     enrichment_finished_at TEXT,
     UNIQUE (week_year, status) -- kun én 'active' per uke
   );

   CREATE TABLE shopping_list_items (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     list_id            INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
     source_type        TEXT NOT NULL CHECK (source_type IN (
                          'meal_ingredient','consumable','extra','manual'
                        )),
     source_ref         TEXT,                  -- recipe_id / consumable_id / extra_id
     ingredient_name    TEXT NOT NULL,         -- orig ingrediensnavn fra recipe (NO eller EN)
     ingredient_name_no TEXT,                  -- normalisert/oversatt NO (fylles i fase C)
     product_key        TEXT,                  -- vårt interne nøkkel hvis kjent
     qty                REAL,
     unit               TEXT,
     brand_hint         TEXT,
     pantry_has         INTEGER NOT NULL DEFAULT 0,  -- 1 = finnes i pantry
     needs_buy          INTEGER NOT NULL DEFAULT 1,  -- 0 = dekket fra pantry
     bought_at          TEXT,
     bought_qty         REAL,
     kassal_product_id  INTEGER REFERENCES kassal_products(id),
     resolution_id      INTEGER REFERENCES product_resolutions(id),
     resolution_candidates_json TEXT,
     resolution_confidence REAL,
     estimated_price    REAL,
     sort_order         INTEGER NOT NULL DEFAULT 0,
     notes              TEXT
   );
   CREATE INDEX idx_shopping_items_list ON shopping_list_items(list_id);
   CREATE INDEX idx_shopping_items_needs ON shopping_list_items(list_id, needs_buy);
   CREATE INDEX idx_shopping_items_kassal ON shopping_list_items(kassal_product_id);
   ```

2. **Ny tilstand `removed` på `meal_plans.status`**
   Migrer CHECK-constraint: `planned | cooked | skipped | away | removed`.
   - `away` = "ikke hjemme, ikke lag mat" (valid uke-komplett-tilstand)
   - `removed` = "dag eksplisitt tomstilt etter at middag var valgt" (valid uke-komplett-tilstand)
   - `skipped` = "bruker hopper over denne dagen" (valid uke-komplett-tilstand)
   - `null recipe_id + status='planned'` = **IKKE komplett**

3. **`repos.mealPlans.isWeekComplete(weekYear)`**
   Returnerer `true` iff alle 7 dager har `recipe_id IS NOT NULL OR status IN ('away','skipped','removed')`.

4. **`repos.shoppingLists`-repository** (new)
   - `create({ weekYear, items })` — transaksjon: insert list, insert items
   - `getById(id)` + `getActive(weekYear)` + `getByWeek(weekYear)`
   - `markItemBought({ itemId, qty })`
   - `markItemUnpantry({ itemId })` → setter `pantry_has=0, needs_buy=1`
   - `markDone(listId)` → setter `status='done', confirmed_at`
   - `supersede(listId)` → setter gammel til `superseded`

5. **`shopping-list.service.generateForWeek(repos, weekYear, { force=false })`** — refaktorer eksisterende `buildShoppingList`:
   - Hvis `!force && !mealPlans.isWeekComplete(weekYear)` → kast `{ code: 'WEEK_NOT_COMPLETE' }`
   - Eksisterende aggregering (meals + consumables + extras + pantry-subtraksjon) — men skriv resultatet til `shopping_list_items` i stedet for å returnere in-memory
   - Markerer forrige `active` handleliste for samme uke som `superseded` før den nye aktiveres
   - Returnerer `{ listId, itemCount, needsBuyCount }`
   - **Ingen Kassal-kall i denne fasen** — berikelse er fase B

6. **Routes:**
   - `POST /api/shopping/generate` body `{ weekYear }` → kaller `generateForWeek`
   - `GET /api/shopping/list/:id` → full liste m/ items
   - `GET /api/shopping/current` → **bytter** fra on-demand-bygg til `getActive(currentWeek)` + seed-fallback hvis ingen finnes (bakoverkompatibelt)
   - `PUT /api/shopping/items/:id/bought` body `{ qty? }` → `markItemBought` + `inventory.addPurchase` + `inventoryLog(reason='shopping_bought')` + hvis `kassal_product_id` og `resolution_id` finnes → `productResolutions.incrementConfirmed`
   - `PUT /api/shopping/items/:id/unpantry` → `markItemUnpantry` + `inventory.correctQty(product_key, 0, notes='user removed from pantry during shopping')`
   - `POST /api/shopping/list/:id/done` → lukker lista

7. **Autogenerer-hook:** I `PUT /api/meals/status` og `PUT /api/meals/swap`, etter oppdatering — sjekk `isWeekComplete`. Hvis true OG ingen `active` handleliste finnes for uka → kall `generateForWeek(weekYear)` inline (synkront, raskt siden ingen HTTP). Dette gir brukeren "lista dukker opp automatisk når uken er satt".

8. **Tester (`tests/iteration3b.test.js`):**
   - `isWeekComplete` — 7 dager med recipe = true; 1 dag null + planned = false; 1 dag null + away = true; 1 dag null + removed = true; blandet = true når siste dag får `removed`
   - `generateForWeek` nekter når uken ikke er komplett (force=false)
   - `generateForWeek` lager liste, `needs_buy=0` for items som finnes i pantry
   - `generateForWeek` kjørt to ganger → gammel blir `superseded`, ny blir `active`
   - `markItemBought` oppdaterer pantry + inventoryLog med riktig reason
   - `markItemBought` på item med `resolution_id` → `times_confirmed` øker
   - `markItemUnpantry` flytter pantry_has til 0 + needs_buy til 1
   - Autogenerer-hook via `/api/meals/status` trigger lista når siste dag settes
   - Hele `/api/shopping/current` returnerer active liste etter generering

**Definition of done:**
- Migration 007 applikert, alle eksisterende tester fortsatt grønne
- Handlelista lever i DB, bruker kan merke kjøpt og pantry oppdateres korrekt
- Fase 3b (capture/confirm-hook) er **indirekte levert** via `/api/shopping/items/:id/bought` → `incrementConfirmed`
- `incrementConfirmed` også levert fra `confirmReceipt` (bonus — samme linje kode)

**Estimert kompleksitet:** Medium. Mest SQL-skjema + enkelt repository-arbeid. Eneste subtile biten er `superseded`-håndteringen (UNIQUE constraint + oppgrader gammel rad før ny inserteres).

---

### Fase B — Kassal-berikelse av handlelista (rate-limited bulk)

**Mål:** Når handleliste genereres, kjører en asynkron enricher som resolver hver `needs_buy`-item mot Kassal, én om gangen, innenfor 55 RPM. Ved rate-limit-treff: vent 60s, fortsett. Aldri kast feil mot bruker.

**Leveranser:**

1. **`server/services/shopping-list-enricher.service.js`** (new)
   ```
   enrichList(repos, listId, { logger }) — async:
     list = shoppingLists.getById(listId)
     if list.enrichment_status === 'running' → return (idempotent)
     shoppingLists.setEnrichmentStatus(listId, 'running')
     items = items where needs_buy = 1 AND kassal_product_id IS NULL
     for each item (sequential, no Promise.all):
       if circuit open → break, status='partial'
       res = await productResolver.resolveByLine(repos, {
         name: item.ingredient_name_no || item.ingredient_name,
         qty: item.qty,
         unit: item.unit,
         brandHint: item.brand_hint,
         productKey: item.product_key,
       })
       if res?.kassalProductRowId:
         repos.shoppingLists.attachResolution(itemId, {
           kassal_product_id, resolution_id, resolution_candidates_json,
           resolution_confidence, estimated_price
         })
       else if res?.candidates:
         repos.shoppingLists.attachCandidates(itemId, res.candidates, res.confidence)
       await delayForRateLimit()  // se under
     shoppingLists.setEnrichmentStatus(listId, finalStatus)
   ```

2. **`delayForRateLimit()`** i enricher (ikke i kassal-client — der er token-bucket):
   ```
   const MIN_INTERVAL_MS = 60000 / 55  // ~1091 ms mellom hvert kall
   await sleep(MIN_INTERVAL_MS)
   ```
   Dette gir sikker marsjhastighet selv uten å sjekke token-bucket. Hvis `cachedFetch` likevel returnerer null på grunn av 429 (eller stale-fallback sier "rate limit"), lar vi `kassal-client`s eksisterende circuit breaker håndtere det: ved 3 rate-limit-feil åpner circuit i 5 min, enricher oppdager `isCircuitOpen`, pauser i 60s med `setTimeout`, prøver igjen. Maks 3 pauser, så setter vi `status='partial'` og lar cronen plukke opp resten.

3. **Bakgrunnskjøring:** I `shopping-list.service.generateForWeek`, etter commit:
   ```
   setImmediate(() => enricher.enrichList(repos, listId).catch(logger.warn))
   ```
   Ingen await. Lista returneres som `enrichment_status='pending'`. Frontend kan polle `GET /api/shopping/list/:id` og se progresjon.

4. **Ny route:** `POST /api/shopping/list/:id/enrich` — manuell retry hvis status er `partial` eller `failed`.

5. **Cron-hook** (valgfri men billig): I `server/cron.js`, hver 10. minutt — finn lister med `status='active' AND enrichment_status IN ('pending','partial') AND enrichment_started_at < now - 15min` og kjør enricher på nytt. Dette gir automatisk recovery.

6. **Tester (utvid `iteration3b.test.js` eller ny `iteration3c.test.js`):**
   - Mock `fetch` med 5 produkter, verifiser at enricher prosesserer dem sekvensielt
   - Mock `fetch` med `sleep`-spy — verifiser at `delayForRateLimit` kalles mellom items
   - Mock `fetch` til å returnere 429 tre ganger → circuit åpner → enricher setter `status='partial'`
   - Etter `POST /api/shopping/list/:id/enrich` med fresh mock → fullfører
   - `generateForWeek` returnerer umiddelbart (< 100ms) mens berikelse foregår i bakgrunn

**Definition of done:**
- 20-varers liste berikes uten å overskride 55 RPM (verifiserbart via token-bucket-telling i test)
- Rate-limit-treff fører til `partial` status, ikke crash
- Bruker ser progresjon via `enrichment_status`-feltet
- Eksisterende `productResolver`-biblioteket er nå brukt i hovedflowen

**Estimert kompleksitet:** Medium-høy. Fallgruvene er sekvensialitet, idempotens, og riktig håndtering av circuit-breaker-tilstand i worker.

---

### Fase C — EN↔NO ingrediens-oversettelse + normalisering

**Mål:** "chicken breast" → "kyllingfilet" før Kassal-søk. Gjelder recipe-ingredienser fra engelske kilder (Pinterest, frityr-oppskrifter, Amerika-inspirerte ting).

**Leveranser:**

1. **`server/services/ingredient-normalizer.service.js`** (new)
   - **Statisk ordbok** først: `server/data/ingredient-dictionary-en-no.json` med ~300 vanlige matord (chicken, beef, flour, sugar, butter, onion, garlic, ...). Håndskrevet, ikke LLM.
   - **Deteksjon:** heuristikk — hvis alle ordene i en ingrediensstreng er rent ASCII [a-z ] og matcher minst én engelsk ordbok-nøkkel, antas EN. Ellers NO.
   - **Oversettelse:**
     - Token-for-token gjennom ordboka — rask, deterministisk, null LLM-kostnad
     - Hvis minst 80% av tokens finnes i ordboka → godta resultatet
     - Ellers → fallback til LLM (`llm.complete` med cache-nøkkel `ingredient_translate:${raw}`), lagre svar i `llm_cache` (finnes allerede)
   - **Normalisering:**
     - Pakkestørrelse-utvinning: regex `(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|stk|dl)` → `{ qty, unit }`
     - Mengde-parsing: `1/2 cup flour` → `{ qty: 0.5, unit: 'cup', name: 'flour' }` → oversett `flour` → `hvetemel` → `{ qty: 120, unit: 'g', name: 'hvetemel' }` (cup-til-gram tabell for vanlige tørrvarer)
     - Stopp-ord: `fresh`, `organic`, `fine`, `large`, `small` osv. fjernes
   - **API:**
     ```
     normalizeIngredient({ name, qty, unit }) →
       { nameOriginal, nameNo, qty, unit, confidence, source: 'dict'|'llm'|'passthrough' }
     ```

2. **Hook i `shopping-list.service.generateForWeek`:** Før `shopping_list_items.insert`, kjør hver ingrediens gjennom normalizer. Lagre `ingredient_name` (orig) og `ingredient_name_no` (normalisert) separat.

3. **Hook i enricher (fase B):** Bruk `ingredient_name_no` som Kassal-søketermin hvis satt, ellers `ingredient_name`.

4. **Tester:**
   - Ordbok-treff: `chicken breast` → `kyllingfilet`
   - Ordbok-miss med LLM-fallback (mock LLM)
   - Pakkestørrelse: `400g ground beef` → `{ qty: 400, unit: 'g', nameNo: 'kjøttdeig' }`
   - Cup-konvertering: `1 cup flour` → `{ qty: 120, unit: 'g', nameNo: 'hvetemel' }`
   - Norsk input er passthrough: `kjøttdeig 400g` → uendret navn, utvunnet qty/unit
   - Cache: samme input to ganger → én LLM-call

**Definition of done:**
- Engelske oppskrifter (når de kommer i fase D) blir matchet like godt som norske
- `llm_cache` bygger seg opp over tid, LLM-kostnad synker

**Estimert kompleksitet:** Lav-medium. Det meste er dataarbeid (ordbok + cup-tabell).

---

### Fase D — Oppskrift-opplasting (tekst + bilde)

**Mål:** Bruker kan lime inn oppskrift som tekst eller laste opp som bilde, og systemet parser ingredienser + steg og lagrer i `recipes` + `recipe_ingredients`.

**Leveranser:**

1. **`server/services/recipe-import.service.js`** (new)
   - `importFromText({ title?, text, sourceUrl?, language? })`
     - Språk-deteksjon (heuristikk eller LLM)
     - LLM-prompt: "Du er en kokkebok-parser. Returner JSON: `{ name, prepTimeMin, servings, ingredients: [{ name, qty, unit }], steps: [string] }`"
     - Normaliser hver ingrediens via `ingredient-normalizer.service` (fase C)
     - `repos.recipes.insert` + `recipe_ingredients`-rader
   - `importFromImage({ buffer, mime, title? })`
     - Gjenbruk `tesseractOcr` fra `receipt.service.js` (flytt til `ocr.service.js` hvis den ikke er det allerede)
     - OCR → tekst → `importFromText`

2. **Routes:**
   - `POST /api/recipes/import` (multipart eller JSON)
     - Hvis `body.text` → `importFromText`
     - Hvis `file` → `importFromImage`
   - `GET /api/recipes/import/:id/status` — hvis vi gjør det async

3. **Tester:**
   - Mock LLM med forhåndsdefinert JSON → verifiser at recipe + ingredients lagres
   - Mock OCR → tekst → LLM → samme verifisering
   - Språk-deteksjon: engelsk input → normaliseres via fase C
   - Validering: manglende name/ingredients → 400

**Definition of done:**
- Bruker kan paste en oppskrift fra Matprat/BBC Good Food/hvor som helst og den havner i DB med parsed ingredienser
- Ingrediensene er umiddelbart brukbare i handlelista (fordi fase C er ferdig)

**Estimert kompleksitet:** Medium. LLM-prompt må være robust for variasjoner i oppskriftformat. OCR fungerer allerede.

---

### Deferred (ikke del av denne planen, men notert)

- **Pinterest-bibliotek-import.** Krever scraping eller Pinterest API (OAuth). Mest verdi når 100+ oppskrifter er i basen. Gjør det separat når brukeren faktisk har et Pinterest-bibliotek å importere.
- **Multi-bruker / multi-husholdning.** Stor schema-migrasjon (user_id overalt). Gjør det kun hvis faktisk behov dukker opp.
- **LLM-rerank i fase 3c.** Nevnes i kommentarer i `product-resolver.service.js` — vi bygger det først når scoring-terskelen 0.30 viser seg å være utilstrekkelig i praksis.

---

## Sekvens + "hvorfor denne rekkefølgen"

```
Fase A (Persistent liste + uke-komplett-trigger)
  │
  ├──► Umiddelbar gevinst: handleliste virker end-to-end for ETING-flow (uten Kassal)
  │    og fase 3b (capture) er levert via bought-routen
  │
  ▼
Fase B (Kassal-berikelse, rate-limited bulk)
  │
  ├──► Tar i bruk iteration 3a-biblioteket for første gang
  │    og verifiserer at 55 RPM-disiplin faktisk fungerer
  │
  ▼
Fase C (EN↔NO normalisering)
  │
  ├──► Løfter match-raten på enricher'en i fase B
  │    og er nødvendig for fase D
  │
  ▼
Fase D (Recipe-upload tekst + bilde)
  │
  └──► Låser opp Pinterest-flow og bruker-egne oppskrifter.
       Ikke avhengig av A/B/C for å fungere, men blir mye bedre med C.
```

**Viktig:** Jeg foreslår å **ikke** gjøre A-D i én stor PR. Hver fase har egen testsuite, stopper ved DoD, rapporterer, og venter på bruker-godkjenning før neste.

---

## Key files

| Fil | Operasjon | Fase |
|---|---|---|
| `server/migrations/007_shopping_lists.sql` | NEW | A |
| `server/repositories.js` | Extend (+shoppingLists, +mealPlans.isWeekComplete, +removed status migration) | A |
| `server/services/shopping-list.service.js` | Refactor (`buildShoppingList` → `generateForWeek`, skriv til DB) | A |
| `server/routes.js` | Add 5 nye routes (generate, get by id, items/bought, items/unpantry, list/done) | A |
| `server/routes.js` | Hook i meals/status og meals/swap → autogenerer hvis uke komplett | A |
| `server/services/receipt.service.js` | Legg til `productResolutions.incrementConfirmed` i `confirmReceipt` (fase 3b, leveres som biprodukt) | A |
| `tests/iteration3b.test.js` | NEW | A |
| `server/services/shopping-list-enricher.service.js` | NEW | B |
| `server/cron.js` | Legg til recovery-cron for partial enrichment | B |
| `server/services/ingredient-normalizer.service.js` | NEW | C |
| `server/data/ingredient-dictionary-en-no.json` | NEW | C |
| `server/services/recipe-import.service.js` | NEW | D |
| `server/services/ocr.service.js` | NEW (flytt fra receipt.service.js) | D |

---

## Risikoer og mitigering

| Risiko | Fase | Mitigering |
|---|---|---|
| `shopping_lists` UNIQUE(week_year, status) lar oss ikke ha to 'active' samtidig. Race condition ved dobbel-klikk på generate | A | Bruk transaksjon: `UPDATE … SET status='superseded' WHERE week_year=? AND status='active'` før INSERT |
| Autogenerer-hook på meals/status kan trigger dyr operasjon midt i en HTTP-request | A | `generateForWeek` i fase A har ingen Kassal-kall, så den er rask. Berikelse går på `setImmediate` i fase B. |
| Hvis enricher krasjer midtveis, står lista i `running` for alltid | B | Cron-recovery + timeout-sjekk (`enrichment_started_at < now - 15min`) som flytter tilbake til `pending` |
| LLM-oversettelse kan hallusinere ingredienser | C | Ordbok-first med 80%-terskel. LLM brukes bare når ordboka ikke dekker. Cache per streng. |
| Ordbok EN→NO blir aldri "ferdig" | C | Start med 300 termer, logg alle cache-misses, legg til manuelt etter hvert. LLM-fallback dekker resten. |
| OCR av oppskriftsbilder er mer komplisert enn kvittering (større bilder, blandet layout) | D | Gjenbruk Tesseract-config. Hvis resultatet er dårlig, fallback til "paste text manuelt"-meldingen. |
| Fase A bryter eksisterende iterasjon-1/2-tester hvis `buildShoppingList` API-et endres | A | Behold gammel eksport-signatur + navn som wrapper rundt `generateForWeek({ force: true }).then(list → formater som gammelt objekt)`. Ingen eksterne konsumenter bryter. |

---

## Utenfor scope (bekreft hvis uenig)

- **Frontend.** Alle disse endringene er backend-routes og tjenester. All frontend-implementasjon **må** gå via `/frontend-design`-skill per din faste instruks i memory. Jeg foreslår at vi leverer fase A's backend først, så går frontend-arbeidspakken parallelt med fase B.
- **Multi-bruker.** Nevnt som mangel men ikke adressert. Legg til som egen plan når faktisk behov oppstår.
- **Pinterest-scraping/API.** Egen plan når du har et bibliotek å importere.

---

## SESSION_ID (N/A)

Multi-model wrapper (codex/gemini) er ikke installert i dette miljøet — planen er generert fra Claude + Explore-agent alene. Det finnes ingen `CODEX_SESSION` eller `GEMINI_SESSION` for denne planen.

---

## Hvilken fase vil du starte med?

- **A** (anbefalt startpunkt — lavest risiko, størst nytte, leverer 3b-capture-hook som gratis biprodukt)
- **B** (hvis du vil gå rett på Kassal-integrasjonen, men da trenger du A først uansett)
- **C** (hvis du allerede har engelske oppskrifter du vil bruke med en gang)
- **D** (hvis opplasting er viktigst akkurat nå)
- **Modifiser planen** — fortell hva som skal endres
