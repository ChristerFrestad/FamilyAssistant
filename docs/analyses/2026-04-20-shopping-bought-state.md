# 2026-04-20 — Shopping bought-state: rotårsaksanalyse og plan

> Status: ANALYSE. Ingen kode skrevet. Leveres for Christer-review før
> implementasjon.
> Opprinnelig rapport: PR #46 hevdet å fikse at handleliste-rader vises
> "kjøpt" ved oppstart. Etter pull-and-redeploy av nytt image ser
> Christer fortsatt rader som er merket "kjøpt" og "grået ut", også på
> varer som ligger i pantry.

---

## SAMMENDRAG OG ANBEFALING

**ANBEFALING:** Ikke lag en ny "nullstill"-migrasjon. Rotårsaken er
sannsynligvis én av tre, og alle tre må diagnostiseres hos Christer
før vi rører kode:

1. **H1 — Migrasjon 018 har ikke kjørt på Christers DB.** Enten fordi
   Portainer bruker et cachet image-lag, fordi den aktive containeren
   ikke ble restartet, eller fordi `DB_PATH` peker et annet sted enn
   der migrasjonene mente. Diagnostikk: `SELECT * FROM schema_migrations
   WHERE version='018'` og telling av `shopping_list_items` med
   `bought_at IS NOT NULL`. Ett SSH/exec-kall avgjør saken.

2. **H2 — Symptomet er ikke `checked-off`, det er `is-pantry`.**
   `pantryHas=1`-rader rendres via `renderPantryLinkedItem` og får
   en myk-grønn glass-boble (`public/css/components-extended.css:181`).
   I enkelte farge­temaer kan den leses som "dempet / dekt av pantry",
   ikke som "kjøpt". Samme data Christer beskriver. Diagnostikk: ett
   skjermbilde av hovedtema + dark/light, og vi kan avgjøre om det
   er `.checked-off` eller `.is-pantry` på feil rad. Ser den ut som
   en *grønn*-aktig boks med "🏠 I pantry"-tekst? H2. Ser den ut som
   et rent flatt tekst-oppsett med strikethrough? H1 (eller H3).

3. **H3 — Service-worker-cache serverer gammel CSS/JS.** PWA cacher
   `public/css/base.css` og `public/js/shopping.js`. Hvis SW ikke
   oppdateres ved deploy får browseren pre-PR-#46-styler (`opacity:
   0.4 + line-through`). Underliggende data er riktig, men UI-et
   bruker det gamle CSS-regelsettet. Diagnostikk: hard-refresh
   (Ctrl+Shift+R) på Christers nettleser. Hvis visningen blir ren
   etter det: H3 var medskyldig.

**Hvorfor ikke en ny migrasjon 019 som nullstiller igjen:** Det løser
bare symptomet (hvis symptomet overhodet er "bought_at" — H2 viser at
det ikke trenger være det), og fjerner signal som trengs for å finne
den ekte rotårsaken. Hvis H1 gjelder, er det selve applyeringen av
migrasjon 018 som feilet; en ny migrasjon har nøyaktig samme risiko.

**Alternativer vurdert:**

- *Lag en `POST /api/shopping/items/reset-bought`-admin-endpoint.*
  Forkastet: løser samme symptom som migrasjon, men maskerer fortsatt
  rotårsaken og introduserer ny admin-flate som må testes.
- *Legg inn en oppstarts-health-check som logger rad-tellinger.*
  Vurderes i §8 som en del av fix-planen etter at rotårsaken er kjent
  — men er ikke i seg selv en fiks.

**Konsekvens hvis Christer overprøver ANBEFALING og ber om migrasjon
019:** Pilot er igjen ren i 1 time, deretter samme tilstand ved neste
Kjøpt-klikk. Vi lærer ikke hvorfor 018 sviktet, og ISO-svakheten i §8
står igjen.

---

## 1. REISEN — Shopping-item-tilstanden fra ende til ende

```
1. Oppskrifter seedes i DB
   1.1. server/services/seed.service.js → seedIfEmpty(repos)
   1.2. server/seed.js (statiske oppskrifter + ingredienser)
   1.3. recipe_ingredients-rader refererer product_key i products
2. Meal plan opprettes
   2.1. Bruker åpner ukesmeny
   2.2. ensureCurrentWeek(repos) seeder default meal_plan
   2.3. meal_plans(week_year, day_of_week, recipe_id)
3. Handleliste genereres
   3.1. POST /api/shopping/generate kaller generateForWeek()
   3.2. generateForWeek → computeShoppingListForWeek()
   3.3. For hver unik (product_key, unit)-aggregering:
        3.3.1. hasHome = inventory.qtyRemaining (pantry-snapshot)
        3.3.2. stillNeed = max(0, totalQty - hasHome)
        3.3.3. pantryHas = hasHome > 0 && stillNeed === 0
        3.3.4. needsBuy = stillNeed > 0
   3.4. shoppingLists.createActive() gjør:
        3.4.1. UPDATE shopping_lists SET status='superseded'
               WHERE week_year=? AND status='active'
        3.4.2. INSERT INTO shopping_lists (...) → new list_id
        3.4.3. For hver item: INSERT INTO shopping_list_items (...)
               — bought_at settes IKKE (kolonnen er ikke i INSERT-listen,
               defaulter til NULL)
4. Frontend leser listen
   4.1. GET /api/shopping/list/current → repos.shoppingLists.getActive()
   4.2. Server mapper rader til objekt:
        4.2.1. checkedOff = !!it.boughtAt  (server/routes.js:781)
        4.2.2. isPantry = it.pantryHas
        4.2.3. Ingen filter — bought-rader forblir i lista (PR #43)
5. Render i shopping.js
   5.1. renderShopping itererer data.categories[].items
   5.2. Per item:
        5.2.1. if item.source === 'consumable' → renderConsumableItem
        5.2.2. else if item.isPantry → renderPantryLinkedItem
               — legger på class "shop-item is-pantry" (myk grønn boble)
               — label: "🏠 I pantry — har nok hjemme"
               — knapp: "↩ Trenger likevel"
        5.2.3. else → renderRecipeItem
               — class "shop-item checked-off" hvis item.checkedOff
               — knapp: grå "Kjøp" ↔ grønn "✓ Kjøpt" (toggleBought)
6. Bruker klikker Kjøp
   6.1. toggleBought(id, 0) → PUT /api/shopping/items/:id/bought
   6.2. markItemBought: UPDATE shopping_list_items
        SET bought_at = datetime('now'), bought_qty = ?,
            needs_buy = 0
        WHERE family_id = ? AND id = ?
   6.3. inventory.addPurchase() oppdaterer pantry
   6.4. inventoryLog.insert reason='shopping_bought'
   6.5. Frontend reloadShopping + reloadPantry
7. Bruker klikker grønn "✓ Kjøpt" igjen
   7.1. toggleBought(id, 1) → PUT /api/shopping/items/:id/unbought
   7.2. markItemUnbought: SET bought_at=NULL, bought_qty=NULL,
        needs_buy=1
   7.3. inventory.qtyRemaining rulles IKKE tilbake
   7.4. Frontend reloadShopping + reloadPantry
8. Migrasjon 018 kjører
   8.1. initDB() → runMigrations(db)
   8.2. Les filer 001_*…018_*.sql, sorter
   8.3. Per fil: hopp over hvis version finnes i schema_migrations
   8.4. UPDATE shopping_list_items SET bought_at=NULL, bought_qty=NULL
        WHERE bought_at IS NOT NULL
   8.5. INSERT INTO schema_migrations VALUES ('018')
   8.6. Transaksjons-commit
```

Rendering kan altså gi tre visuelt distinkte tilstander for én og
samme rad-ID:

- **Normal**: `.shop-item` (hvitt/mørkt, grå "Kjøp"-knapp)
- **Kjøpt**: `.shop-item.checked-off` (etter PR #46 = samme visuelt som
  normal + grønn "✓ Kjøpt"-knapp)
- **Pantry-dekket**: `.shop-item.is-pantry` (myk grønn glass-boble + 🏠
  "I pantry"-label)

---

## 2. DATAMODELL — hvilke tabeller og kolonner styrer "bought"?

### `shopping_list_items` (migrasjon 007)

Primærbærer av kjøpt-state.

- `id` PK
- `family_id` (NOT NULL, migrasjon 014 + 016)
- `list_id` FK → `shopping_lists(id)`
- `product_key` FK (nullable) → `products(key)`
- `qty`, `unit`, `pack_size`, `pack_unit`, `pack_count`
- `pantry_has` INTEGER — 1 hvis dekket av pantry ved generering
- `pantry_qty` REAL — hvor mye som lå i pantry ved generering
- `needs_buy` INTEGER (default 1)
- **`bought_at`** TEXT (nullable) — ISO-datetime, NULL hvis ikke kjøpt
- **`bought_qty`** REAL (nullable)
- `sort_order`, `notes`, `category`
- Kassal-berikelse-kolonner (ikke relevant her)

### `shopping_lists` (migrasjon 007)

- `id` PK
- `family_id`
- `week_year`
- `status` — 'active' | 'superseded' | 'done' (én aktiv per uke)
- `total_est_price`, `generated_at`, `confirmed_at`, …

### `inventory` (migrasjon 001 + 004 + 008)

- `product_key` PK-lignende per family
- `qty_remaining` — øker ved `addPurchase`, reduseres ved cron-depletion
- `last_purchased`, `expires_est`
- `shelf_days_learned`, `shelf_days_sample_count` (migrasjon 017)

### `inventory_log` (migrasjon 004)

Audit av qty-endringer. `reason='shopping_bought'` skrives når
markItemBought lykkes.

### `recipes`, `recipe_ingredients` (migrasjon 001)

Bestemmer hva som havner i handlelisten ved generering. Ikke
direkte knyttet til bought_at.

### `products`

`shelf_days`, `shelf_days_learned`, `pack_size` — driver kalkulering
av `pantry_has` ved generering (via `hasHome` og `stillNeed`).

### `schema_migrations`

`version` PK, `applied_at` datetime. Hver migrasjon registreres
her ved commit.

---

## 3. HVOR KAN `bought_at`/`bought_qty` SKRIVES?

Uttømmende grep — kun to SQL-writes:

| Fil | Linje | Hva |
|-----|-------|-----|
| `server/repositories/shopping.repo.js` | 272–283 | `markItemBought(itemId, boughtQty)`: SET bought_at=datetime('now'), bought_qty=?, needs_buy=0 |
| `server/repositories/shopping.repo.js` | 309–315 | `markItemUnbought(itemId)`: SET bought_at=NULL, bought_qty=NULL, needs_buy=1 |

Migrasjon 018 er eneste ad-hoc-write (NULL, engangs).

**Kallere:**

- `markItemBought` ← kun `PUT /api/shopping/items/:id/bought`
  (`server/routes.js:856`) via `toggleBought(id, 0)` i frontend.
- `markItemUnbought` ← kun `PUT /api/shopping/items/:id/unbought`
  (`server/routes.js:907`) via `toggleBought(id, 1)` i frontend.

**Ingen automatiske writes.** Ingen receipt-scan, ingen seed, ingen
shopping-list-generering setter bought_at. Generering via
`shoppingLists.createActive` har ikke `bought_at` i INSERT-listen
(`shopping.repo.js:58–66`). Nye rader har alltid `bought_at = NULL`.

---

## 4. HVA MIGRASJON 018 FAKTISK GJØR

Fullt innhold av `server/migrations/018_reset_stale_bought_at.sql`:

```sql
UPDATE shopping_list_items
SET bought_at = NULL, bought_qty = NULL
WHERE bought_at IS NOT NULL;
```

Det er alt. Det finnes **ingen** WHERE-klausul på list_id eller
family_id — alle rader med `bought_at IS NOT NULL` i hele DB-en
nullstilles.

Migrasjonsrammeverket (`server/migrations/index.js`) kjører hver
migrasjon én gang:

1. `schema_migrations`-tabellen opprettes hvis den ikke finnes.
2. Per `.sql`-fil: hvis `version` (de tre første tegnene) finnes i
   `schema_migrations`, hoppes den over.
3. Ellers: `db.exec(sql)` i transaksjon, deretter
   `INSERT INTO schema_migrations VALUES ('018')`.

Konsekvens: **migrasjon 018 kan bare påvirke DB-tilstanden én gang
per fysiske SQLite-fil.** Hvis volumet er det samme ved hver deploy,
ville en kjøring skjedd første gang container startet med denne koden.
Etterfølgende oppstarter hopper over 018.

Det betyr også at hvis rad X får `bought_at = datetime('now')` ETTER
at 018 kjørte — feks fra et Kjøpt-klikk post-deploy — er migrasjonen
maktesløs. Den er en engangs-cleanup, ikke en permanent garanti.

---

## 5. PORTAINER-OPPSTARTSSEKVENS

Utløser Steg 3b (PORTAINER-RISIKO) fordi migrasjonen er en
oppstartshendelse.

```
Portainer pull-and-redeploy
│
├─ 1. Image pull
│    ghcr.io/christerfrestad/familyassistant:main
│    pull_policy: always (docker-compose.yml)
│    SHA: whatever ble publisert sist av docker.yml
│
├─ 2. Container create
│    Volume mount: ./data → /app/data (bind mount på host)
│    ENV: TAG, PILOT_BYPASS, PILOT_BYPASS_PRODUCTION_ACK, evt AUTH_TOKEN
│
├─ 3. Container start (ENTRYPOINT: node server/index.js)
│    │
│    ├─ 3.1. config.js lastes
│    │       Env validert, BOOTSTRAP_MODE detektert
│    │
│    ├─ 3.2. initDB() — server/db.js
│    │       ├─ ensureDataDir(): mkdir /app/data + /app/data/backups
│    │       ├─ better-sqlite3 åpner DB_PATH
│    │       │   (default /app/data/familieassistenten.db)
│    │       ├─ WAL-mode, FK=ON
│    │       └─ runMigrations(db) ← MIGRASJON 018 KJØRER HER
│    │
│    ├─ 3.3. seedIfEmpty(repos) — server/services/seed.service.js
│    │       ├─ products.count() === 0? → seed.products
│    │       ├─ recipes.count() === 0? → seed.recipes
│    │       └─ chores.count() === 0? → seed.chores
│    │
│    ├─ 3.4. ensureCurrentWeek(repos)
│    │       ├─ Meal-plan for inneværende uke finnes? ellers seed
│    │       └─ Chore-schedule for uken finnes? ellers seed
│    │
│    ├─ 3.5. registerRoutes(router, { repos, serverState })
│    │
│    ├─ 3.6. server.listen(7777, '0.0.0.0')
│    │
│    └─ 3.7. startCronJobs + scheduleDailyBackup + ...
│
└─ 4. Healthcheck
     node -e "fetch('http://localhost:7777/health')..." 3s intervall
```

### Hvor kan det gå galt — punktvis

- **2:** Hvis Christers Portainer-stack har blitt re-konfigurert mellom
  deploys slik at volumet peker til en ANNEN host-path, jobber den
  nye containeren mot en ny, tom DB som aldri ble migrert før 018
  landet. Usannsynlig uten endring i `docker-compose.yml`, men verd å
  sjekke.
- **3.1:** `config.js` kaller `process.exit(1)` hvis AUTH_TOKEN mangler
  i produksjon uten PILOT_BYPASS. Vil ikke forårsake 018-bug, men vil
  hindre migrasjonen fra å kjøre. Loggen viser dette tydelig.
- **3.2:** Hvis `ensureDataDir` feiler (EACCES/EPERM/EROFS), returnerer
  server.js med feil før migrasjoner kjører. Loggen vil si "Kan ikke
  opprette datakatalog". Ikke vår sak nå.
- **3.2:** Hvis 018 krasjer i transaksjon (feks ved manglende tabell
  `shopping_list_items` — umulig fordi 007 alltid går først), rulles
  den tilbake og hele `startServer()` kaster. Loggen viser
  `[MIGRATE] ✗ FEIL i 018_...`. Christer kan se dette.
- **3.2:** Hvis 018 FAKTISK kjørte, stammer det én linje i loggen:
  `[MIGRATE] ✓ Applikert 018_reset_stale_bought_at.sql`. Ved påfølgende
  restart står det bare `Ingen nye migrasjoner (18 allerede applikert)`.

### Rollback-strategi

Migrasjon 018 er destruktiv på data (nullstiller bought_at). Reversibel
kun via backup-restore. Dette betyr: hvis vi finner ut at migrasjonen
kjørte feil sted og nullet legitim bought-state, må vi gjenopprette
fra `server/backup.js`-snapshot. Konkret backup-fil: siste rad i
`/app/data/backups/*.db`.

---

## 6. RENDERING-PATHS — tre visuelle spor per rad

Frontend bestemmer layout pr rad:

| Betingelse | Render-funksjon | CSS-klasse | Hva brukeren ser |
|-----------|-----------------|------------|------------------|
| `item.source === 'consumable'` | `renderConsumableItem` | `.consumable-item` | Kort med depletion-info |
| `item.isPantry === true` | `renderPantryLinkedItem` | `.shop-item.is-pantry` | Myk grønn glass-boble + "🏠 I pantry" |
| ellers | `renderRecipeItem` | `.shop-item` + evt `.checked-off` | Flat rad med "Kjøp"/"✓ Kjøpt"-knapp |

### Visuell spesifikasjon post-PR #46

- `.shop-item.checked-off` etter PR #46: `opacity: 1`, ingen
  strikethrough. Rad skal se **lik ut som normal**, kun knappen endres
  til grønn "✓ Kjøpt".
- `.shop-item.is-pantry`: myk grønn bakgrunn (`rgba(78, 204, 163,
  0.08)`), backdrop-blur, myk grønn border, rundede kanter.
  `public/css/components-extended.css:181`.

**Nøkkelspørsmål til Christer:** Ser de berørte radene ut som:

(A) Rene flate rader med grønn "✓ Kjøpt"-knapp → `checked-off`
(B) Rundede grønnaktige bobler med "🏠 I pantry"-tekst → `is-pantry`
(C) Rader med strikethrough + svak opacity → gammel cached CSS (H3)

Denne distinksjonen avgjør rotårsaken.

---

## 7. CI-GAP — hvorfor grønn CI ikke fanget dette (ISO-Reliability)

CI kjørte `tests/shopping-toggle-and-delete.test.js` som verifiserer:

- Kjøpte items forblir på lista (`checkedOff: true`)
- PUT /unbought reverserer tilstand
- DELETE /items/:id fjerner rad

Ingen test verifiserer:

- At migrasjon 018 faktisk endrer eksisterende `bought_at`-rader
  (migrasjonen er en `.sql`-fil med UPDATE-statement — ingen
  integrasjonstest mot den spesifikt).
- At en fresh-deploy-scenario (stale DB + ny kode) ender med alle
  rader med `bought_at = NULL`.
- At rendering-path-valget (`renderRecipeItem` vs `renderPantryLinkedItem`)
  matcher brukerens mentale modell.
- At service-workeren oppdaterer CSS etter deploy (vi har sw.js men
  ingen test på versjonsbumping).

**ISO 25010 Reliability — nåværende svakhet:**

> "Functional correctness" dekkes for nye endepunkter, men
> "functional completeness" ift data-migrasjoner og PWA-cache-oppdatering
> er lav. Test suite validerer kode-endringer isolert, ikke
> migrate-stale-state-flyten.

**Hva som må gjøres for å lukke gapet (spesifikasjon, ikke kode ennå):**

1. Ny test-kategori: "migration data contract"-tester. Før hver
   migrasjon som endrer data: sett DB i pre-migrasjon-state, kjør
   `runMigrations`, assert ny state. Referansemønster: bruk helpers.js
   til å åpne isolert DB, kjør alle migrasjoner opp til N-1, INSERT
   stale rader, kjør migrasjon N, verifiser.
2. En boot-smoke-test: gitt en vilkårlig DB-fil, `initDB()` + første
   sideload. Hvis noen shopping-items har `bought_at` satt fra
   før-migrate-state, må de være null etter migrasjon.
3. SW cache-bust: versjonsbump i `public/sw.js` per release tag,
   verifisert i `tests/phase14-sw-multitenant.test.js`-kategori.
4. Eksplisitt `bought_at ∈ {NULL}`-assertion i en integrasjonstest
   som kjører GET /api/shopping/list/current etter en simulert
   rydder-migrasjon.

---

## 8. EDGE-CASES (≥ 8, relevant for rotårsaken)

1. **Pre-018-DB med legitim bought-state.** Migrasjon 018 sletter
   alle `bought_at` uten discrimination. Hvis Christer faktisk klikket
   Kjøpt tidligere i samme session han nå observerer, har han mistet
   den klikken. Ikke kritisk for pilot (det er hans egen data), men
   dokumenteres i RUNBOOK.
2. **Volumet mountes på ny path.** Ny container → fresh DB → 018 kjører
   mot tomme tabeller → ingen effekt. Brukerens stale bought_at sitter
   fortsatt i det GAMLE volumet.
3. **To shopping_lists med status='active' for samme uke.** Skal være
   umulig (supersede-logikken i createActive), men hvis race skjedde
   ville items i begge listene telles.
4. **Service-worker cacher gammel shopping.js.** Kode bruker `checkedOff`
   på fraværende felt (gammel frontend leser bought_at direkte). Vil
   kaste ReferenceError eller vise fra uoppdatert mental modell.
5. **Bruker har flere nettlesere åpne samtidig.** Én fane klikker
   Kjøpt, en annen fane viser stale data inntil reload. Krever
   websocket eller polling for live sync.
6. **Migrasjon 018 kjørte riktig, men inventory.qtyRemaining er
   fortsatt høyt.** Hvis Christer hadde mange Kjøpt-klikk, har pantry
   akkumulert qty. Etter 018 ser shopping rent ut, men neste
   generering av handleliste får `pantryHas=1` på mange rader.
   Dette er IKKE en bug — det er korrekt pantry-tracking — men kan
   mistolkes.
7. **Bootstrap-wizard ble kjørt etter 018 landet.** Wizarden oppretter
   `bootstrap.json` og restarter prosessen. Migrasjonen er allerede
   applikert, så andre-gangs-oppstart hopper over. Ingen effekt på
   bug.
8. **Container startes med `--rm` eller tilsvarende flyktig volum.**
   Neste pull-and-redeploy mister alle migrasjoner. Ikke Christers
   setup per `docker-compose.yml`, men verd å bekrefte.
9. **Christer kjører nettleser i private-modus.** Ingen SW cache, men
   heller ingen cookies → pilot-bypass-knappen trigges per session.
10. **Christer er logget inn som annen bruker enn pilot@local.**
    `family_id` kan være ulikt. Migrasjon 018 WHERE-clause har ingen
    `family_id`-filter, så det gjelder uansett — men hvis Christer
    har flere familier og ser en annen families data, er det en helt
    annen bug (tenant-lekkasje, vesentlig mer alvorlig).

---

## 9. PORTAINER-OPPSTARTSRISIKO-SEKSJON (Steg 3b)

Gjelder for den endelige fix-PR-en, ikke denne analyse-PR-en.

**Svar på sjekklisten i CLAUDE.md DEL 3, 2.6:**

| Berøres | Hvordan |
|--------|---------|
| Dockerfile / .dockerignore | Nei — forventet |
| docker-compose.yml | Nei — forventet |
| server/http/bootstrap.js | Nei — forventet |
| server/config.js oppstartsvalidering | Muligens — avhengig av valgt fix |
| server/index.js startup-sekvens | Nei — forventet |
| server/db.js eller server/migrations/** | **Ja, hvis vi kjører ny migrasjon. Alternativt: nei** |
| install.sh | Nei |
| bootstrap.json-lesning | Nei |
| Miljøvariabel-krav for oppstart | Nei |

Hvis fixen (etter Christer-godkjenning) blir "legg til ny migrasjon":
**Ja** på `server/migrations/**`, og da må Steg 3b fullføres med full
oppstarts-sti-analyse + tests/phase22-bootstrap-mønster-tester
+ Christer-godkjenning før merge.

Hvis fixen blir "lag admin-endpoint" eller "dokumenter og la
Christer manuelt rydde": **Nei** på migrasjons-stien, men vi må
fortsatt teste at admin-endepunktet ikke tømmer legitime bought-state.

---

## 10. REPRODUKSJONSSTRATEGI

### Steg A — Verifiser hypotese hos Christer (lese-only)

1. SSH/Portainer-exec til container:
   `sqlite3 /app/data/familieassistenten.db "SELECT version FROM
   schema_migrations ORDER BY applied_at DESC LIMIT 5"`
   → Forventet: `018` øverst.
2. Telle stale-rader:
   `sqlite3 /app/data/familieassistenten.db "SELECT COUNT(*) FROM
   shopping_list_items WHERE bought_at IS NOT NULL"`
   → Forventet: `0` etter 018.
3. Telle pantry-dekte rader i aktiv liste:
   `sqlite3 /app/data/familieassistenten.db "SELECT COUNT(*) FROM
   shopping_list_items si JOIN shopping_lists sl ON sl.id=si.list_id
   WHERE sl.status='active' AND si.pantry_has=1"`
   → Høyt tall: forklarer det visuelle. H2.
4. Sjekk SW-registrering:
   Nettleser DevTools → Application → Service Workers. Hvis SW er
   registrert men sist oppdatert før PR #46-merge: H3.

### Steg B — Rotårsak per utfall

| §A.1 | §A.2 | §A.3 | Rotårsak |
|------|------|------|----------|
| 018 ikke i lista | — | — | H1: migrasjonen kjørte ikke. Undersøk DB-path, volum-mount, container-start-logg. |
| 018 i lista | > 0 | — | H-ny: noe skriver bought_at ETTER 018 kjørte. Kanskje en race eller et automatisk kall. Krever tettere logging. |
| 018 i lista | = 0 | høy | H2: symptomet er `is-pantry`-rendering. Bruker tolker grønn-boble som "grået ut". Fix er CSS eller copy. |
| 018 i lista | = 0 | lav | H3 eller feilrapport. Sjekk SW + be om nytt skjermbilde. |

### Steg C — Verifiser fix

Avhenger av valgt fix per rotårsak. Skrives etter Christer-godkjenning
av hypotese-retning.

---

## 11. BESLUTNINGER CHRISTER MÅ TA

### BESLUTNING 1: Hvilken diagnostikk kjører vi først?

**ANBEFALING:** Kjør Steg A.1 + A.2 via Portainer-exec (SSH til
containeren, sqlite3-kommandoer fra §10). Tar 2 minutter.

**HVORFOR:** Alle tre hypoteser avgjøres av om `bought_at IS NOT NULL`
finnes i DB etter at 018 skal ha kjørt. Billigste signal først. Hvis
count = 0, vi vet det IKKE er en data-bug og kan fokusere på rendering
eller SW-cache.

**ALTERNATIVER:**

- *Skjermbilde først.* Forkastet: tvetydig visuelt signal. Bruker kan
  ikke være sikker på om det er `checked-off` eller `is-pantry`.
- *Hopp rett til å skrive admin-reset-endpoint.* Forkastet: løser
  potensielt et ikke-eksisterende problem.

**KONSEKVENS HVIS ANNERLEDES:** Vi gjetter på rotårsak og kan
implementere feil fiks.

### BESLUTNING 2: Skal vi backfille `docs/DOMAIN_MODEL.md` med
shopping-lifecycle som del av fix-PR-en?

**ANBEFALING:** Ja — opprett entitet `ShoppingListItem` + forretningsregel
`BR-001: bought_at settes kun via eksplisitt brukerhandling` som del
av fix-PR-en. Dette er første gang vi rører domenet etter
DOMAIN_MODEL.md ble innført.

**HVORFOR:** Forretningsregelen er ikke-triviell og blir referanse
for fremtidige auditorer. Skaper presedens for hvordan regler
dokumenteres.

**ALTERNATIVER:**

- *Vent til vi vet rotårsaken.* Forkastet: dokumentasjonen stemmer
  uansett utfall.
- *Dropp DOMAIN_MODEL-oppdatering helt.* Forkastet: bryter
  CLAUDE.md DEL 3 Steg 9.

**KONSEKVENS HVIS ANNERLEDES:** DOMAIN_MODEL vokser ikke organisk
som planlagt.

### BESLUTNING 3: Trenger vi en ny migrasjon (019) eller en
admin-endpoint for å rydde?

**ANBEFALING:** Verken eller — inntil diagnostikken viser at det faktisk
er stale data. Hvis diagnostikken viser count = 0 (018 virket), er
svaret frontend-fiks (is-pantry-rendering eller SW-cache).

**HVORFOR:** Løser symptomet ikke rotårsaken. Sett avgjørelsen etter
§10-diagnostikk.

**ALTERNATIVER:**

- *Kjør migrasjon 019 (kopi av 018) for sikkerhets skyld.*
  Forkastet: dobbelnullstilling maskerer rotårsak og mister all
  legitim bought-state.
- *Admin-endpoint POST /api/admin/reset-bought.* Vurderes hvis
  diagnostikken viser at vi trenger manuell ryddekanal, men ikke
  uten test-dekning og audit-log.

**KONSEKVENS HVIS ANNERLEDES:** Risikerer tapte reelle klikk, og
får ikke lukket ISO-Reliability-gapet.

---

## 12. PLAN (hvis hypotese etter §10)

**Note:** Endelig commit-plan skrives først ETTER diagnostikken.
Følgende er *betingede* løp:

### Hvis H1 (migrasjon 018 kjørte ikke)

1. Finn hvorfor. Ikke skriv 019 som patch før vi vet hvorfor.
2. Når årsaken er funnet: skriv en test som vil fange samme feil
   neste gang (feks en oppstart-assertion som logger schema_migrations-
   diff ved startup).
3. Dokumenter årsak + fix i RUNBOOK og DOMAIN_MODEL.
4. Implementer fix.
5. Teste end-to-end på staging/pilot.

### Hvis H2 (is-pantry visuell tolkning)

1. Dempe `.shop-item.is-pantry` eller endre label til noe enda mer
   eksplisitt, feks "🏠 Du har denne hjemme — ikke kjøp".
2. Skjermbilde i PR-en for å verifisere.
3. Oppdatere DOMAIN_MODEL med rendering-kontrakt.

### Hvis H3 (SW-cache)

1. Versjonsbump i `public/sw.js` per commit, eller cache-bust via
   query-string på `<link rel="stylesheet">` i HTML.
2. Test som verifiserer SW invalideres ved ny deploy.
3. Dokumentere i DEPLOY.md §14.

Ingen av disse er hastefiks. Analysen + Christer-godkjenning er
gjenstående blokker.

---

## 13. ISO 25010-PÅVIRKNING (for fix-PR-en, ikke denne)

For de tre grenene:

- **H1-fix:** Reliability 8.4 → 8.6 (+0.2, ny data-contract-test-
  kategori). Maintainability 8.3 → 8.3 (uendret).
- **H2-fix:** Usability 8.7 → 8.8 (+0.1, tydeligere visuell
  distinksjon). Ikke effekt på andre.
- **H3-fix:** Reliability 8.4 → 8.5 (+0.1, SW-cache-invalidering).
  Compatibility 8.6 → 8.6 (uendret).

For denne analyse-PR-en: 0 kode-endring, 0 ISO-effekt.

---

## 14. STOPP-TRIGGERE (fra CLAUDE.md DEL 2) AKTIVT HER?

- Scope > 3 domeneområder: Nei, kun shopping + pantry + rendering.
- Ny datamodell: Nei (ennå).
- Ny npm eller SaaS: Nei.
- Ny database-migrasjon: Ikke denne PR-en; potensielt i fix-PR-en.
- Sikkerhet: Nei.
- Data-sletting: Migrasjon 018 eksisterer allerede; ikke vår sak nå.
- CI/CD-endringer: Nei.
- Railway/multi-tenant-frysen: Nei — berører ikke server/auth/.

**Resultat:** ingen stopp-trigger utløst av selve analysen. Fortsett
til Christer-review.

---

## VEDLEGG A — Kritiske filstier

- `server/migrations/018_reset_stale_bought_at.sql` (8 linjer)
- `server/migrations/index.js` (101 linjer) — runner
- `server/db.js` (144 linjer) — initDB + migration-call
- `server/index.js` (261 linjer) — startup-sekvens
- `server/repositories/shopping.repo.js` (~450 linjer) — skrive-punkter
- `server/routes.js:747–810` (`/api/shopping/list/current`)
- `server/routes.js:823–884` (`/api/shopping/items/:id/bought`)
- `server/routes.js:896–918` (`/api/shopping/items/:id/unbought`)
- `server/services/shopping-list.service.js:82–145` (generering)
- `public/js/shopping.js:32–110` (renderShopping)
- `public/js/shopping.js:134–202` (renderRecipeItem)
- `public/js/shopping.js:223–238` (renderPantryLinkedItem)
- `public/css/base.css:440–447` (`.checked-off` post-PR #46)
- `public/css/components-extended.css:181–201` (`.is-pantry`)

## VEDLEGG B — Relevante PR-er i historikk

- PR #43 — Original shopping/pantry UX: fjernet filteret som skjulte
  bought-rader. **Kritisk kontekst.**
- PR #44 — Hotfix: display:none/flex for inline-paneler.
- PR #45 — PR A.2 shelf-life learning.
- PR #46 — Migrasjon 018 + cross-tab refresh + CSS-strikethrough-fjerning.
  **Direkte årsak til dagens diagnose-PR.**
