# Meals-domain — current-state inventering før Sprint 11

Dato: 2026-05-06
Branch: `chore/sprint-11-analyse`
Forfatter: agent (read-only)

> **Note om filplassering:** Christers spec sa `docs/analysis/`, men eksisterende
> konvensjon (verifisert mot `docs/analyses/` + CLAUDE.md DEL 5.2.2) er
> `docs/analyses/`. Filen er lagt der phase21-hygiene-testen forventer den.

## Formål

Inventering av Måltider-domenet som beslutningsgrunnlag for Sprint 11
(Kassal-aktivering + utvidelser). Read-only analyse — ingen kode-, migrasjon-
eller test-endringer.

---

## 1. Database

### 1.1 Migrasjonsoversikt

29 migrasjoner (siste: `029_invitation_message_locale.sql`). Måltider-relevante:

| # | Migrasjon | Måltider-relevans |
|---|---|---|
| 001 | `initial_schema` | products, recipes, recipe_ingredients, inventory, meal_plans, consumables, consumable_log, shopping_extras, purchase_log, meal_history, sunday_drafts, llm_audit |
| 004 | `pantry_pricing_state` | inventory_log, price_references, price_history |
| 005 | `receipts` | receipts, receipt_items |
| 006 | `product_resolution` | **kassal_products, product_resolutions, kassal_cache** + receipt_items utvidelser |
| 007 | `shopping_lists` | shopping_lists, shopping_list_items + meal_plans status='removed' + inventory_log reason='shopping_bought' |
| 008 | `pantry_total_size` | inventory.total_size |
| 009 | `family_profile` | family_profile (singleton: members/allergies/dislikes/preferences) |
| 011 | `recipe_sources` | recipes.source_type, recipe_sources |
| 013 | `chain_preferences` | family_profile.preferred_chain + secondary_chain |
| 014 | `auth_and_multi_family` | familie-scoping av alle 13+ tabeller (meal_plans, inventory, shopping_lists, recipes, recipe_ingredients, recipe_sources, sunday_drafts, …) |
| 016 | `drop_family_id_defaults` | rydding for 4 tabeller |
| 017 | `shelf_observations` | product_shelf_observations + products.shelf_days_learned |
| 018 | `reset_stale_bought_at` | data-reset |
| 020 | `member_diets` | family_profile_members.{allergies,dislikes,diet_tags,custom_diet_note} |
| 023 | `portion_factor_user_and_tighter_range` | users.portion_factor + tightened CHECK |
| 024 | `family_id_strict_constraints` | 17 tabeller får ON DELETE CASCADE FK + DROP DEFAULT 1 |

Migrasjoner 002, 003, 010, 012, 015, 019, 021, 022, 025-029 er auth-/observability-/family-relaterte og berører ikke meals-domenet direkte.

### 1.2 Tabeller (måltider-relevante)

**`recipes`** (family-scoped)
```sql
id INTEGER PK AUTOINCREMENT
name TEXT NOT NULL
category TEXT NOT NULL CHECK (IN 'rask','comfort','helg')
prep_time TEXT
source TEXT, url TEXT, pinterest_url TEXT
servings INTEGER DEFAULT 2
equipment_json TEXT, notes TEXT
times_cooked INTEGER DEFAULT 0, last_cooked TEXT, rating REAL
source_type TEXT NOT NULL DEFAULT 'manual' (CHECK kun via app: manual|ai|imported)
created_at TEXT DEFAULT (datetime('now'))
family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
INDEX(category), INDEX(source_type), INDEX(family_id)
```

**`recipe_ingredients`** (family-scoped)
```sql
id PK AUTOINCREMENT
recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE
product_key TEXT (nullable; lenker til products.key)
name TEXT NOT NULL, qty REAL NOT NULL, unit TEXT NOT NULL
optional INTEGER DEFAULT 0
sort_order INTEGER DEFAULT 0
family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
```

**`meal_plans`** (family-scoped)
```sql
id PK AUTOINCREMENT
family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
week_year TEXT NOT NULL (ISO uke f.eks. '2026-W18')
day_of_week INTEGER NOT NULL CHECK (BETWEEN 0 AND 6)
meal_type TEXT DEFAULT 'middag'
recipe_id INTEGER REFERENCES recipes(id) (nullable)
status TEXT DEFAULT 'planned' CHECK (IN planned|cooked|skipped|away|removed)
notes TEXT
UNIQUE(family_id, week_year, day_of_week, meal_type)
INDEX(family_id), INDEX(family_id, week_year), INDEX(recipe_id), INDEX(status)
```

**`inventory`** (family-scoped, composite PK)
```sql
family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
product_key TEXT NOT NULL
qty_remaining REAL NOT NULL DEFAULT 0
unit TEXT NOT NULL DEFAULT ''
last_purchased TEXT
last_pack_size REAL
expires_est TEXT
purchase_count INTEGER DEFAULT 0
avg_days_between_purchase REAL
total_size REAL (mig. 008 — for progress-bar/lav-trigger)
updated_at TEXT DEFAULT (datetime('now'))
PRIMARY KEY (family_id, product_key)
INDEX(family_id), INDEX(expires_est)
```

**`inventory_log`** (family-scoped — append-only audit)
```sql
id PK AUTOINCREMENT
family_id, product_key, qty_delta REAL, new_qty REAL, unit TEXT
reason TEXT NOT NULL CHECK (IN
  manual | receipt | cron_depletion | correction
  | shelf_life_expired | initial_seed | shopping_bought)
source_id INTEGER, source_table TEXT, notes TEXT
logged_at TEXT NOT NULL DEFAULT (datetime('now'))
INDEX(family_id, product_key, logged_at DESC), INDEX(reason), INDEX(source_table, source_id)
```

**`shopping_lists`** (family-scoped)
```sql
id PK AUTOINCREMENT
family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
week_year TEXT NOT NULL
status TEXT NOT NULL DEFAULT 'active' CHECK (draft|active|done|superseded)
generated_at, confirmed_at TEXT
enrichment_status TEXT NOT NULL DEFAULT 'pending' CHECK (pending|running|done|partial|failed)
enrichment_started_at, enrichment_finished_at TEXT
total_est_price REAL
PARTIAL UNIQUE INDEX (family_id, week_year) WHERE status='active'
```

**`shopping_list_items`** (family-scoped — Kassal-berikelse innebygd)
```sql
id PK AUTOINCREMENT
list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE
source_type TEXT NOT NULL CHECK (meal_ingredient|consumable|extra|manual)
source_ref TEXT (recipe_id / consumable_id / extra_id)
ingredient_name TEXT NOT NULL
ingredient_name_no TEXT (normalisert NO etter EN→NO)
product_key TEXT
qty REAL, unit TEXT
brand_hint TEXT, category TEXT
pack_size REAL, pack_unit TEXT, pack_count INTEGER
est_price REAL
pantry_has INTEGER DEFAULT 0, pantry_qty REAL
needs_buy INTEGER NOT NULL DEFAULT 1
bought_at TEXT, bought_qty REAL
-- Kassal-berikelse (mig. 006 + 007 + 014 + 024)
kassal_product_id INTEGER REFERENCES kassal_products(id)
resolution_id INTEGER REFERENCES product_resolutions(id)
resolution_candidates_json TEXT
resolution_confidence REAL
resolved_via TEXT
-- Kontekst
meals_json TEXT (JSON-array av middag-navn)
dairy_note TEXT
sort_order INTEGER, notes TEXT
family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
```

**`products`** (NOT family-scoped — global katalog, 88 seed-rader)
```sql
id PK AUTOINCREMENT
key TEXT UNIQUE NOT NULL
product_name, category TEXT NOT NULL
pack_size REAL NOT NULL, unit TEXT NOT NULL
est_price REAL, shelf_days INTEGER
store TEXT DEFAULT 'Kiwi', ean TEXT
dairy_rule TEXT (røros_only | røros_preferred | null)
shelf_days_learned INTEGER (mig. 017 — fra observations)
shelf_days_sample_count INTEGER NOT NULL DEFAULT 0
created_at, updated_at TEXT
```

**`product_shelf_observations`** (family-scoped — driver shelf_days_learned)
```sql
id PK AUTOINCREMENT
family_id INTEGER NOT NULL
product_key TEXT NOT NULL
purchased_at TEXT NOT NULL ('YYYY-MM-DD')
expires_at TEXT NOT NULL
days_lasted INTEGER NOT NULL (denormalisert)
observed_at TEXT
source TEXT NOT NULL CHECK (shopping_bought|pantry_edit|pantry_add)
INDEX(family_id, product_key, observed_at DESC)
```

**`kassal_products`** (NOT family-scoped — global SKU-katalog)
```sql
id PK AUTOINCREMENT
kassal_id TEXT UNIQUE NOT NULL
ean TEXT (INDEXED), name, brand, vendor, category TEXT
pack_size REAL, pack_unit TEXT
image_url TEXT
last_seen_price REAL, last_seen_store TEXT, last_seen_at TEXT
raw_json TEXT (full Kassal-payload for re-parse)
first_captured_at, updated_at TEXT
capture_source TEXT NOT NULL CHECK (receipt|meal_plan|manual_add|lookup|bootstrap)
```

**`product_resolutions`** (mange-til-mange product_key ↔ kassal_products)
```sql
id PK AUTOINCREMENT
product_key TEXT (nullable!)
kassal_product_id INTEGER NOT NULL REFERENCES kassal_products(id) ON DELETE CASCADE
resolved_via TEXT NOT NULL CHECK (ean|llm_name|user_pick|brand_learn|manual)
confidence REAL NOT NULL DEFAULT 0.5
times_confirmed, times_seen INTEGER DEFAULT 0
last_seen_at, last_confirmed_at TEXT
user_locked INTEGER DEFAULT 0
UNIQUE(product_key, kassal_product_id)
```

**`kassal_cache`** (HTTP-request-cache med TTL)
```sql
id PK AUTOINCREMENT
cache_key TEXT UNIQUE NOT NULL ('search:kjottdeig' | 'ean:7038…' | 'id:54321')
endpoint TEXT NOT NULL CHECK (search|ean|id)
response_json TEXT NOT NULL
fetched_at, expires_at TEXT NOT NULL
hit_count INTEGER DEFAULT 0
INDEX(expires_at), INDEX(endpoint)
```

**`consumables`** + **`consumable_log`** (family-scoped, husholdningsvarer med depletion-modell)

**`shopping_extras`** (family-scoped, manuelt tillagte varer pre-generering)

**`receipts`** + **`receipt_items`** (family-scoped, OCR/LLM-parset, kobler til kassal_product_id)

**`recipe_sources`** (family-scoped, type ∈ pinterest|godt|rss|html|unknown, sync hver 6t)

**`sunday_drafts`** (family-scoped, LLM-foreslått ukeplan venter på godkjenning)

**`meal_history`** (family-scoped, append-only når mark-cooked)

**`family_profile`** (singleton-per-familie: members/allergies/dislikes/preferences/preferred_chain/secondary_chain)

**`family_profile_members`** (per-medlem: name/category/portion_factor/allergies/dislikes/diet_tags/custom_diet_note)

**`price_references`** + **`price_history`** (NOT family-scoped, master-pris-data + historikk)

**Tabeller jeg så etter men IKKE finnes:** `meal_plan_items`, `pantry_items`, `pantry_entries`, `family_food_preferences`, `meal_pattern_favorites`, `ingredient_preferences`. (Disse er foreslått i `design/2026-04-redesign/extracted/backend-requirements.md` for fremtidig arbeid.)

### 1.3 Eksempel-data (Christers dev-DB)

Verifisert mot `data/familieassistenten.db` (better-sqlite3 read-only):

| Tabell | Rader |
|---|---|
| `recipes` | 36 |
| `meal_plans` | 14 (uke 18 + 19) |
| `inventory` | 11 |
| `shopping_lists` | 3 (1 superseded, 2 active) |
| `products` (seed) | 88 |
| `consumables` | 39 |
| `family_profile_members` | 1 (Christer alene) |
| **`kassal_products`** | **0** |
| **`product_resolutions`** | **0** |
| **`recipe_sources`** | **0** |

Sample fra `recipes`:
```json
[ {"id":37,"name":"Kylling red curry med jasminris","category":"rask","prep_time":"25 min","servings":2,"source_type":"manual"},
  {"id":38,"name":"Laks i airfryer med potetbåter og brokkolini","category":"rask","prep_time":"20 min","servings":2,"source_type":"manual"},
  {"id":39,"name":"Pasta med scampi, hvitløk og chili","category":"rask","prep_time":"20 min","servings":2,"source_type":"manual"} ]
```

Sample fra `inventory`:
```json
[ {"product_key":"melk","qty_remaining":0,"unit":"ml","expires_est":"2026-05-12"},
  {"product_key":"saft","qty_remaining":0,"unit":"","expires_est":null},
  {"product_key":"bananer","qty_remaining":0,"unit":"","expires_est":null} ]
```

Sample fra `shopping_lists`:
```json
[ {"id":1,"week_year":"2026-W18","status":"superseded","enrichment_status":"done"},
  {"id":2,"week_year":"2026-W18","status":"active","enrichment_status":"pending"},
  {"id":3,"week_year":"2026-W19","status":"active","enrichment_status":"done"} ]
```

`enrichment_status: 'pending'` på liste #2 indikerer at Kassal-enricher har en jobb klar — men avbrytes umiddelbart fordi `KASSAL_API_KEY` er ikke satt (se §5).

---

## 2. Backend-routes

### 2.1 Komplett liste (måltider-relevante)

Server bruker custom node:http-router (NOT Express), registrert via `server/routes.js`. Auth-middleware kjørt i kjede; `requireRole('adult'|'owner')` markert per rute.

**`/api/today`** — composite dagsvisning
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/today` | 2119 | required | Returnerer `{dayName, dayOfWeek, weekYear, meal: {…recipe}, chores[], events[]}` |

**`/api/meals/*`**
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/meals/week/:weekYear` | 444 | req. | Hele uke-planen |
| GET | `/api/meals/current` | 461 | req. | Inneværende uke (composite m/ today) |
| PUT | `/api/meals/swap` | 477 | adult | Bytt recipe på dag |
| PUT | `/api/meals/status` | 496 | adult | Sett status (away/skipped/removed/planned) |
| PUT | `/api/meals/reorder` | 511 | adult | Flytt meal mellom dager |
| GET | `/api/meals/suggestions/:dayOfWeek` | 530 | req. | Swap-suggestions (default/maksimer/balansert) |
| POST | `/api/meals/pantry-suggestions` | 542 | adult | "Hva kan jeg lage nå?" — top-5 i kategori, pantry-rangert |
| POST | `/api/meals/pantry-suggestions/accept` | 555 | adult | Aksepter ett+ pantry-forslag → leggs i ukeplan |
| POST | `/api/meals/:id/mark-eaten` | 598 | adult | Sett `cooked` + returner deduction-suggestions |
| POST | `/api/meals/:id/apply-deduction` | 629 | adult | Anvend bruker-bekreftet pantry-trekk |
| POST | `/api/meals/:id/unmark-eaten` | 650 | adult | Roll-back til `planned` |

**`/api/recipes/*`**
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/recipes` | 723 | req. | List m/ filter |
| GET | `/api/recipes/:id` | 753 | req. | Detaljer + ingredienser |
| GET | `/api/recipes/:id/similar` | 820 | req. | Recipe-similarity service |
| POST | `/api/recipes/import` | 836 | adult | LLM tekst-import (paste recipe) |
| POST | `/api/recipes/import/image` | 878 | adult | LLM OCR-import fra bilde |
| POST | `/api/recipes/from-llm` | 2500 | adult | Generate recipe (LLM) |
| POST | `/api/recipes/import-url` | 2549 | adult | URL-import via recipe-url-import service |

**`/api/shopping/*`**
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/shopping/current` | 910 | req. | Legacy current — leser active list eller computes on-demand |
| PUT | `/api/shopping/check` | 918 | adult | Toggle checkOff (legacy) |
| POST | `/api/shopping/add` | 946 | adult | Legacy add via shopping_extras |
| POST | `/api/shopping/generate` | 975 | adult | Generate persistent list fra ukeplan |
| GET | `/api/shopping/list/current` | 1010 | req. | Read active persisted list |
| GET | `/api/shopping/list/:id` | 1085 | req. | Read by id |
| PUT | `/api/shopping/items/:id/bought` | 1100 | adult | Mark bought + writes inventory_log(reason='shopping_bought') |
| PUT | `/api/shopping/items/:id/unbought` | 1189 | adult | Reverse |
| DELETE | `/api/shopping/items/:id` | 1207 | adult | Delete |
| POST | `/api/shopping/items` | 1225 | adult | Add manual item to active list |
| PUT | `/api/shopping/items/:id/has-home` | 1278 | adult | Mark "har denne hjemme" |
| POST | `/api/shopping/items/:id/expiry` | 1350 | adult | Lag shelf-observation |
| PUT | `/api/shopping/items/:id/unpantry` | 1451 | adult | Reverse has-home |
| POST | `/api/shopping/list/:id/enrich` | 1468 | adult | Manual trigger Kassal-enrichment |
| POST | `/api/shopping/list/:id/done` | 1486 | adult | Mark list `done` |

**`/api/pantry/*`**
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/pantry/suggest` | 1644 | req. | Foreslå produkter (typeahead) |
| GET | `/api/pantry` | 1658 | req. | List inventory items |
| DELETE | `/api/pantry/:productKey` | 1699 | adult | Slett item |
| POST | `/api/pantry/add` | 1730 | adult | Add inventory + product-resolver-roundtrip |
| PUT | `/api/pantry/correct` | 1771 | adult | Korriger qty (brukes også av "marker brukt") |
| PUT | `/api/pantry/expiry` | 1398 | adult | Sett expires_est manuelt |
| GET | `/api/pantry/log` | 1795 | req. | Inventory_log historikk |
| GET | `/api/pantry/value` | 1806 | req. | Aggregert pantry-verdi |

**`/api/products/*`** + **`/api/inventory`**
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/inventory` | 1577 | req. | Rå inventory-rader (admin/debug) |
| GET | `/api/products` | 1584 | req. | Produkt-katalog |
| GET | `/api/products/:productKey/shelf-life` | 1439 | req. | Returnerer shelf_days + shelf_days_learned |

**`/api/consumables/*`**
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/consumables` | 1594 | req. | List consumables |
| PUT | `/api/consumables/:id` | 1601 | adult | Update consumable |
| POST | `/api/consumables/:id/bought` | 1615 | adult | Reset current_qty etter kjøp |
| POST | `/api/consumables/toggle-auto/:id` | 1627 | adult | Toggle auto_add |

**`/api/sources/*`** (recipe_sources)
| Method | Path | Linje | Auth | Beskrivelse |
|---|---|---|---|---|
| GET | `/api/sources` | 1845 | req. | List enabled sources |
| POST | `/api/sources` | 1850 | adult | Add Pinterest/godt/RSS/HTML kilde |
| DELETE | `/api/sources/:id` | 1876 | adult | Disable kilde |
| POST | `/api/sources/:id/sync` | 1900 | adult | Manual trigger sync |

**`/api/profile/*`** (family_profile + filter-usage)
| Method | Path | Linje | Auth |
|---|---|---|---|
| GET/PUT | `/api/profile` | 1911 / 1915 | req. / adult |
| GET | `/api/profile/defaults` | 1935 | req. |
| GET/POST | `/api/profile/filter-usage` | 1959 / 1965 | req. / adult |
| POST | `/api/profile/check-recipe` | 777 | adult — Recipe allergy-check |

**`/api/prices/*`**, **`/api/receipts/*`**, **`/api/sunday-push`**, **`/api/llm/*`**, **`/api/integrations/*`**, **`/api/admin/kassal/status`**, **`/api/today`**, **`/api/calendar/events`** — alle implementert.

**`/api/admin/kassal/status`** (linje 2727) returnerer:
```json
{ enabled, apiKeyConfigured, productCount, resolutionCount,
  tokensAvailable, bucketCapacity, circuitOpen, circuitOpenUntil }
```

Total: ~95 ruter (62 med single-line `router.X('/api/…')` + 33 multi-line). Komplett liste mottas ved å kjøre `grep -nE "^\s+'/api/" server/routes.js`.

### 2.2 Manglende routes (sammenlignet mot Sprint 11-spørsmål)

| Forventet operasjon | Status | Detalj |
|---|---|---|
| Generér handleliste fra meal-plan | ✅ | `POST /api/shopping/generate` |
| Marker måltid som "lagd" | ✅ | `POST /api/meals/:id/mark-eaten` |
| Auto-decrement pantry etter måltid | ✅ | Eksplisitt opt-in via `POST /api/meals/:id/apply-deduction` etter user confirmation. Cron `dailyDepletionJob` (22:00) gjør også auto-trekk per dagens meal. |
| "Hva kan jeg lage nå?" basert på pantry | ✅ | `POST /api/meals/pantry-suggestions` (top-5 ranked, kategori-filter) |
| Pantry add/edit/delete | ✅ | `POST /api/pantry/add`, `PUT /api/pantry/correct`, `DELETE /api/pantry/:key` |
| Recipe-search (lokalt) | ⚠️ | `GET /api/recipes` filtrerer, men ingen FTS5 tilgjengelig. FTS5-tabell finnes (mig. 002 — `knowledge_base`) men ikke for recipes. |
| Kassal product search | ✅ kode | `kassal-client.searchByName` finnes — men ingen direkte HTTP-rute (eksponert kun via `shopping/list/:id/enrich`-trigger og receipt-flow) |
| Kassal product price lookup | ✅ kode | `kassal-client.getById` + `getByEan` |
| Mapping ingredient → Kassal product | ✅ | `product-resolver.resolveByLine` (EAN-first → memo → name+hint scoring + chain-boost) |

**Hvor det MANGLER eksplisitt rute:**
- Direkte `GET /api/products/search?q=…` mot Kassal — bare via shopping-list-enrich
- `POST /api/recipes/search?pantry=true` (pantry-aware browse) — eksisterer som suggestion på meal-pantry-suggestions, men ikke i fri-stående recipe-browse-modus
- `GET /api/admin/kassal/manual-pick/:itemId` (manuell SKU-velger ved confidence < 0.3) — ikke implementert; resolver lagrer kandidater i `resolution_candidates_json` men ingen UI/route bruker det

---

## 3. Services og forretningslogikk

### 3.1 Service-filer (måltider-relevante, server/services/)

| Fil | Linjer | Eksporterte funksjoner | Hva den gjør |
|---|---|---|---|
| `meal-planning.service.js` | 383 | `getSwapSuggestions`, `checkShelfLife`, `generateSundayDraft`, `generatePantryRestOfWeek`, `computeMissingForRestOfWeek`, `resolveMode` | Kjernen for ukeplanlegging. Tre modi (default/maksimer/balansert) via `family_profile.preferences.suggestionMode`. Kaller pantry-coverage for ranking. |
| `pantry-coverage.service.js` | 210 | `scoreRecipeByPantry`, `rankRecipes`, `subtractIngredientsFromInventory`, `keyForIngredient`, `coverForIngredient`, `daysUntilExpiry` | Pure scoring. Vektet coverage (required=1.0, optional=0.3) + urgency-bonus (≤1d=0.15, ≤3d=0.08). |
| `pantry-deduction.service.js` | 183 | `buildSuggestions`, `applyDeduction` | Sprint 6 smart-coupling: meal-cooked → pantry deduction. Kollator multiple ingredients → samme productKey. |
| `pantry.service.js` | 338 | (les manuelt — ikke eksaminert i full detalj) | CRUD + correctQty + low-stock-trigger |
| `pantry-resolver.service.js` | 228 | (find-or-create på pantry-add) | Pantry-add resolver mot products + Kassal |
| `shopping-list.service.js` | 551 | `buildShoppingList`, `generateForWeek`, `computeShoppingListForWeek`, `legacyViewFromActiveList`, `CATEGORY_ORDER` | Ren beregning av listen + persistence. **Merge-mode (default)** preserverer bought + manual rows ved regenerate; **replace-mode** wiper alt. |
| `shopping-list-enricher.service.js` | 279 | `enrichList`, `enrichPendingLists`, `enrichInBackground` | Iterer items med `needs_buy=1 AND kassal_product_id IS NULL`. Pre-check rate-limit + circuit-breaker → kall product-resolver → persist via `attachResolution`. Stopp-tidlig på rate-limit/circuit → `enrichment_status='partial'`. |
| `kassal-client.service.js` | 320 | `searchByName`, `getByEan`, `getById`, `getStatus`, `resetState`, `cachedFetch` | Token bucket (55/min, 5 margin under 60-grensen), circuit breaker (3 errors → 5 min cooldown), TTL-cache via `kassal_cache` (search 24t / ean 168t / id 720t), stale-if-error fallback, 8s timeout. |
| `product-resolver.service.js` | 433 | `resolveByEan`, `resolveByLine`, `scoreCandidate`, `extractChain`, `chainBoost`, `KNOWN_CHAINS` | EAN-first (catalog-cache → fallback til Kassal API), så name+hint med scoring (0.5 word-overlap + 0.25 brand + 0.2 pack-size + 0.05 price-known + 0.15 preferred chain + 0.07 secondary chain). MIN_AUTO_CONFIDENCE=0.3. |
| `recipe-import.service.js` | 365 | `importFromText`, `importFromImage` (delvis lest) | LLM-import av recipe. Sanitering (HTML/control-chars), kategori-validering, ingrediens-normalisering via Phase C |
| `recipe-url-import.service.js` | 262 | URL→recipe via fetch+LLM | Pinterest/godt/HTML-fetch + LLM-parse |
| `recipe-similarity.service.js` | 115 | Recipe similarity-scoring | "Liknende oppskrifter"-funksjonalitet |
| `recipe-sources.service.js` | 117 | `syncAllEnabled`, `syncSource` | Pinterest-board / godt.no-profil / RSS / HTML synk hver 6t (cron) |
| `recipe-filter.service.js` | 158 | `filterRecipeForFamily`, `buildFamilyContext` | Allergy/diet/dislike-filter (per-family + per-member fallback) |
| `ingredient-normalizer.service.js` | (ikke målt) | `normalizeSync`, `detectLanguage` | EN→NO ingrediens-oversettelse + qty/unit-extraction |
| `price-reference.service.js` | (ikke målt) | `applyCpiIndexing` | CPI-indeksert prising av price_references |
| `receipt.service.js` | (ikke målt) | OCR + LLM-parsing av kvitteringer |
| `allergy-filter.service.js`, `diet-filter.service.js`, `dislike-filter.service.js` | små | filter-byggere som komposres i recipe-filter |
| `circuit-breaker.js` | små | Generisk CB-helper (men kassal-client bruker egen state) |

### 3.2 LLM-bruk i Måltider-flow

| Plass | Hva den gjør | Backend |
|---|---|---|
| `meal-planning.service.generateSundayDraft` | Tilfeldig kategori-balanserte uker, fallback hvis ikke fersk-pool. Kaller IKKE LLM direkte. | DB-only (mealHistory + recipes) |
| `recipe-import.service.importFromText` | LLM parse av paste-tekst → JSON-struktur | `server/llm.js` (Ollama default `qwen2.5:3b`, eller Anthropic/OpenAI/xAI per family_llm_config) |
| `recipe-import.service.importFromImage` | OCR + LLM (samme som text) | OCR-adapter pluggbar (Tesseract i prod) |
| `recipe-url-import.service` | Fetch URL → LLM-parse | Same som over |
| `receipt.service` | OCR + LLM-parse av kvittering → linjer | Same som over |
| `ingredient-normalizer.service.normalizeSync` | EN→NO oversettelse | LLM-cache via `repos.llmCache` |
| `/api/llm/recipe` (linje 2434) | Fri LLM-call for recipe-suggestions | LLM-tool-call dispatcher i routes.js |
| `/api/llm/chat` (linje 2350) | Generisk chat med tool-calls (`add_to_shopping_list`, `add_calendar_event`, …) | server/llm.js |

Prompt-templates: ingen dedikert mappe — prompts er inline-konstanter i `recipe-import.service.js` + `server/llm.js`. (Til sammenligning ble email-templates flyttet til `server/email/templates/` i Sprint 10.)

### 3.3 Repositories (server/repositories/)

| Fil | Eksporterte CRUD/queries |
|---|---|
| `recipe.repo.js` | `getAll`, `getById`, `findByName`, `insert`, `update`, `delete`, `getRecent`, `incrementCooked` |
| `meal.repo.js` | `mealPlans.{getWeek,getById,setRecipe,setStatusById,seedDefault,exists,isWeekComplete}`, `mealHistory.{getRecent,record}`, `sundayDrafts.{save,get,accept}` |
| `inventory.repo.js` | `inventory.{getAll,getByKey,reduceQty,upsert,delete,setExpiry,setHasHome,unsetHasHome}`, `inventoryLog.{record,getForKey}` |
| `shopping.repo.js` | `shoppingLists.{getActive,getById,createActive,markItemBought,attachResolution,setEnrichmentStatus,listPendingEnrichment,addManualItem,removeItem}`, `shoppingExtras.{getWeek,add,remove,toggleChecked}` |
| `product.repo.js` | `products.{getAllAsMap,getByKey}`, `kassalProducts.{upsert,getByEan,getByKassalId}`, `productResolutions.{upsertSeen,bestForProductKey,confirm}`, `kassalCache.{get,put,bumpHit,cleanup}` |
| `pricing.repo.js` | `priceReferences.{getByKey,upsert,search,stats}`, `priceHistory.{record,getForRef}` |
| `receipt.repo.js` | `receipts.{create,findBySha256,confirm,getById}`, `receiptItems.{insertBatch,update,confirm}` |
| `family.repo.js` | `family.{create,get,update,delete}`, `familyProfile.{get,update}`, `familyProfileMembers.{getAll,upsert,delete}`, `familyInvitations.*` (Sprint 9) |
| `chore.repo.js` + `chore-completion.repo.js` | husarbeid (utenfor scope) |
| `auth.repo.js`, `feedback.repo.js`, `llm-config.repo.js`, `system.repo.js`, `shelf-observation.repo.js`, `pilot-password-attempts.repo.js` | (ikke meal-relevante for full inventering) |

`server/repositories/index.js` aggregerer alle og eksponerer som én `repos`-objekt + injiserer `_db` referanse.

---

## 4. Frontend-tilstand

### 4.1 Skjermer (client/src/app/screens/)

| Fil | Status | Endpoints brukt |
|---|---|---|
| `Dashboard.tsx` | ✅ ferdig | `/api/today` (composite) |
| `Meals.tsx` | ✅ ferdig (Sprint 6) | `/api/meals/current` (via `useMealsData`), `/api/meals/swap`, `/api/meals/:id/mark-eaten`, `/api/meals/:id/apply-deduction`, `/api/recipes` (picker) |
| `Shopping.tsx` | ✅ ferdig (Phase 2D + 2E) | `/api/shopping/list/current`, `/api/shopping/generate`, `/api/shopping/items` (CRUD), `/api/shopping/items/:id/{bought,unbought,has-home,unpantry}`, `/api/pantry` (sub-view) |
| `Pantry` | ✅ via PantryView i Shopping | `/api/pantry`, `/api/pantry/add`, `/api/pantry/correct`, `/api/pantry/:key` (DELETE) |
| `Calendar.tsx` | ⚠️ placeholder | Kun ✅ ikke skrevet enda |
| `Family.tsx` | ✅ ferdig (Sprint 4) | `/api/family/*` |
| `Settings.tsx` | ✅ ferdig (Sprint 5, 4 av 9 mockup-grupper) | `/api/profile`, `/api/family/*`, GDPR-ruter |
| `Admin.tsx` | ⚠️ delvis | `/api/admin/kassal/status` (les) |
| `InviteAccept.tsx` | ✅ Sprint 9 | family-invitations |
| `NotFound.tsx` | ✅ | — |

**Ingen separat `/v2/recipes`-skjerm finnes.** Recipe-UI er kun via picker-dialog i Meals.

### 4.2 Komponenter (måltider-relevante)

`client/src/app/components/meals/`:
- `DayStrip.tsx` — horisontal pill-rad m/ 7 dager
- `MealHero.tsx` — feature-card for valgt dag
- `RecipeIngredients.tsx` — ingredient-liste m/ scaling
- `WeekList.tsx` — kompakt 7-row summary
- `MarkCookedDialog.tsx` — pantry-deduction-dialog
- `RecipePickerDialog.tsx` — recipe-velger for plan/swap

`client/src/app/components/shopping/`:
- `EmptyState.tsx`, `QuickAddInput.tsx`, `ShoppingHeader.tsx`, `RegenerateDialog.tsx`, `CategoryGroup` (referert i Shopping.tsx, ikke globbet i denne kjøringen)

`client/src/app/components/pantry/`:
- `PantryView.tsx` (container) — bruker `usePantryData`
- `PantryItem.tsx` — rad m/ progress-bar + expiry-badge
- `ExpiryBadge.tsx`
- `QuickAddPantry.tsx`
- `UseDialog.tsx` — "marker brukt"-dialog (1/4, 1/2, alt + manuell)
- `ShoppingViewToggle.tsx` — segmented toggle list ↔ pantry

**Ingen `client/src/app/components/recipes/` mappe.** RecipePickerDialog ligger under `meals/`.

### 4.3 Frontend services / API-klienter

Plassering: `client/src/app/{meals,shopping,pantry}/`. **Ingen TanStack Query, ingen SWR.** Egen fetch-wrapper + `use*Data`-hooks med manual retry/optimistic update.

| Fil | Eksport |
|---|---|
| `meals/mealsApi.ts` | `fetchMealsCurrent`, `swapMeal`, `markEaten`, `applyDeduction`, types |
| `meals/useMealsData.ts` | `useMealsData()` hook + `computeScale()` |
| `meals/usePantryDeduction.ts` | dialog state + mark-eaten/apply-deduction flow |
| `meals/useRecipePicker.ts` | dialog state + recipe-fetch + swap-mutation |
| `shopping/shoppingApi.ts` | `fetchActiveList`, `generateFromMeals`, `addItem`, `toggleBought`, `removeItem`, `markHasHome`, `markUnpantry`, errors |
| `shopping/useShoppingData.ts` | `useShoppingData()` med optimistic update + rollback |
| `shopping/packDisplay.ts` | "X pakker à Y g" rendering |
| `pantry/pantryApi.ts` | `fetchPantry`, `addItem`, `markUsed` (correctQty), `removeItem` |
| `pantry/usePantryData.ts` | `usePantryData()` med itemsByCategory grouping |

### 4.4 i18n-namespace

`client/src/app/i18n/locales/{no,en}/`. NO+EN parity håndhevet av `bundles.test.ts`.

| Namespace | NO linjer | EN linjer |
|---|---|---|
| `common.json` | 63 | 63 |
| `meals.json` | 127 | 127 |
| `shopping.json` | 114 | 114 |
| `pantry.json` | 77 | 77 |
| `dashboard.json` | (ikke målt) | (idem) |
| `auth, calendar, settings, admin, family` | parity verifisert |

Alle namespace har 1:1 keys (parity-test). Default-språk pilot = `no`.

---

## 5. Kassal-integrasjon — status

### 5.1 Kode-søk: alle treff på "kassal" (case-insensitive)

71 filer treffer i alt. Sentrale kategorier:

**Backend-services (FULLT IMPLEMENTERT):**
- `server/services/kassal-client.service.js` (320 linjer) — HTTP-klient
- `server/services/product-resolver.service.js` (433 linjer) — resolver
- `server/services/shopping-list-enricher.service.js` (279 linjer) — enricher
- `server/services/env-store.service.js` — Kassal-key validering (testIntegration)
- `server/services/circuit-breaker.js`, `slugify.js`, `shopping-list-enricher.service.js`
- `server/services/receipt.service.js`, `pantry-resolver.service.js` — kobler kassal-resolution

**Database (skjema, fullt rigget — 0 rader):**
- `server/migrations/006_product_resolution.sql` — `kassal_products`, `product_resolutions`, `kassal_cache`
- `server/migrations/007_shopping_lists.sql` — `shopping_list_items.kassal_product_id`
- `server/migrations/024_family_id_strict_constraints.sql` — strict FK på receipt_items.kassal_product_id

**Routes:**
- `server/routes.js` linje 2727 — `GET /api/admin/kassal/status` (admin only, returnerer `enabled, apiKeyConfigured, productCount, resolutionCount, tokensAvailable, …`)
- `server/routes.js` linje 1468 — `POST /api/shopping/list/:id/enrich`
- (resolver brukes implisitt i shopping-generate, receipt-confirm, pantry-add)

**Cron:**
- `server/cron.js` `shoppingEnrichmentJob` (every 10 min) → `enrichPendingLists(repos, {maxLists: 3, delayMs: 1100})`

**Tester:**
- `tests/iteration3a.test.js` (85 kassal-mentions) — resolver + scoring
- `tests/iteration3b-enricher.test.js` (17) — enricher flyt
- `tests/kassal-env-activation.test.js` (20) — verifiserer env-activation
- `tests/iteration3b.test.js`, `tests/iteration3c-normalizer.test.js`, `tests/iteration3d-recipe-import.test.js`
- `tests/m-week6-chaos.test.js`, `tests/m-week2-supply-chain.test.js`, `tests/m4-observability.test.js`

**Konfig:**
- `server/config.js` — `KASSAL_API_KEY: z.string().optional()`
- `.env.example` — Kassal-key-template
- `docker-compose.yml` — Kassal env variabel passes through

**Docs:**
- `docs/analyses/2026-05-04-kassal-env-activation.md` — dedikert analyse av aktivering
- `docs/workflow/post-pilot-roadmap.md` — Kassal-aktivering som post-pilot 1-2 dagers oppgave
- `docs/runbooks/llm-cache-key-policy.md` (refererer Kassal-cache som mønster)
- `docs/vision/integration-platform-future.md` — per-familie-konfig (D4-beslutning)
- `design/2026-04-redesign/extracted/backend-requirements.md` — UI-flyt for Kassal-key-konfig per familie

### 5.2 Konklusjon

| Spørsmål | Svar |
|---|---|
| Er det noen Kassal-klient eller integrasjon begynt på? | **Ja, fullt utviklet.** HTTP-klient (rate-limit + circuit breaker + cache), resolver (EAN+name+chain-boost), enricher (background sweep), admin-status-endpoint, full test-suite. |
| Er KASSAL_API_KEY brukt utover env-deklarasjon? | **Ja.** `kassal-client.service.js` line 176 leser `process.env.KASSAL_API_KEY`. Null-fallback gjør hele integrasjonen til en no-op uten key. |
| Finnes det tabeller eller skjemaer som forutser Kassal-data? | **Ja, fra mig. 006:** `kassal_products`, `product_resolutions`, `kassal_cache`. Pluss `shopping_list_items.kassal_product_id` (mig. 007/014/024) og `receipt_items.kassal_product_id` (mig. 006/014/024). |
| Er det aktivt? | **Nei.** `KASSAL_API_KEY` ikke satt → enricher returnerer `done`-noop, alle 3 Kassal-tabeller har 0 rader på Christer's dev-DB. |

**Per `docs/workflow/post-pilot-roadmap.md` §"Kassal-aktivering med live-priser":** aktivering estimeres til 1-2 dager arbeid (sett `KASSAL_API_KEY` → trigger initial enrichment → frontend håndterer `enrichment_status` → enrichment-status badge UI).

---

## 6. Dokumentasjon og roadmap

### 6.1 Eksisterende dokumenter (måltider-relevante)

`docs/`:
- `DOMAIN_MODEL.md` — domenemodell, BR-regler (incl. BR-BRAND-1/2/3 fra Sprint 10)
- `DB_INDEXES.md` — index-katalog
- `BRAND_SYSTEM.md` (Sprint 10)

`docs/analyses/` (49 filer per ls):
- `2026-04-30-fase-2c-meals.md` — meals-skjerm Phase 2C
- `2026-04-30-fase-2d-shopping.md` — shopping-skjerm
- `2026-05-04-kassal-env-activation.md` — Kassal-aktiverings-plan
- `2026-05-03-pre-pilot-comprehensive-audit.md` — multi-tenant audit som drev DEL 14-regel
- `2026-05-02-multi-tenant-audit.md` — kilde for mig. 024
- `2026-04-20-multi-tenant-activation.md` — soft-thaw av server/auth/

`docs/workflow/`:
- `post-pilot-roadmap.md` — Christer's parkerings-dokument; oppdatert 2026-05-03 med 3 high-priority differensiatorer
- `pending-decisions.md`
- `pre-deploy-cleanup-plan.md`
- `local-first-adoption-2026-04.md`

`docs/runbooks/`:
- `deploy-portainer.md` (Sprint 10 oppdatert)
- `llm-cache-key-policy.md`

`docs/vision/integration-platform-future.md` — per-familie-integration-konfig

`design/2026-04-redesign/`:
- `source/Familieassistenten.html` (mockup ~2570 linjer, 5 hovedskjermer)
- `source/Onboarding og Auth.html`
- `extracted/backend-requirements.md` — komplett mockup ↔ backend mapping (700+ linjer, oppdatert 2026-04-23)
- `extracted/architecture-fit.md`, `components-inventory.md`, `design-system.md`, `domain-scan-report.md`, `locked-decisions.md`, `user-preferences-fit.md`
- `design-gaps.md` — levende dokument; 9 åpne gaps (Family-tab vs Settings, desktop-SideNav, kategori-i18n, inline-edit qty, "marker brukt"-dialog, Settings-scope, location for pantry)

`openapi.yaml` finnes (23 path-definisjoner per grep — ufullstendig kontra ~95 routes; kjent etterslep).

### 6.2 Post-pilot-roadmap items for Måltider

Fra `docs/workflow/post-pilot-roadmap.md` (sist oppdatert 2026-05-03):

| Item | Estimat | Detaljer |
|---|---|---|
| **Kassal-aktivering med live-priser** | 1-2 dager | `KASSAL_API_KEY` + frontend `enrichment_status` UI + retry-CTA + butikklogo (optional). Hele infrastrukturen er klar — bare aktivering. |
| **Product packaging awareness** | 2-3 uker | Schema: `products.pack_size_g` + `products.pack_unit`. Frontend: pakke-nivå-rader. Pantry: to qty-akser (antall pakker + restmengde i åpen). Mål: handleliste leses som ekte handleliste, og åpen pakke konsumeres først. |
| **Pantry-aware recipe suggestions** | 1-2 uker | Backend HAR pantry-coverage-scoring — løft ut per-recipe coverage helper. Frontend picker får mode-toggle "Browse" vs "Fra pantry". Optional "Fyll uka fra pantry"-knapp som velger 7 høyest-scorende. |
| Smart kategori-tildeling | (ikke estimert) | ML/fuzzy mot eksisterende seed |
| Kassal-integrasjon for vare-søk | (post-pilot) | Direkte UI-velger ved manuell add |
| Tidligere handlelister (arkiv) | krever schema | Mangler `shopping_lists.archived_at` |
| Mest brukte varer (top 20) | krever index | Mangler `(family_id, bought_at)`-index |
| Faste varer (recurring) | (ikke estimert) | Eksplisitt "husholdnings-essensielle" + auto-add per uke |
| Forbruksanalyse (trends) | (ikke estimert) | Krever index på `(family_id, category)` |
| Holdbarhet per vare (anti-svinn) | delvis | `product_shelf_observations` finnes; mangler UI for "varsler/forslag" |
| Pantry-management ("hva har jeg hjemme nå") | delvis | PantryView finnes; "match mot oppskrifts-forslag" mangler explicit (men er implisitt i pantry-suggestions) |
| Sprint 16+ bootstrap-flow på v2 | post-pilot | Re-implementere setup-wizard i v2 eller slett bootstrap-flow helt |

**Spesifikke roadmap-punkter Christer nevnte i Sprint 11-prompten:**

| Punkt | Status |
|---|---|
| PRODUCT-PACKAGING-AWARENESS | ✅ logget i roadmap, post-pilot 2-3 uker |
| PANTRY-AWARE RECIPE SUGGESTIONS | ✅ logget i roadmap, 1-2 uker |
| PANTRY-LEVEL-PERCENT | ✅ implementert (mig. 008 `total_size`, `PantryItem` viser progress-bar) |
| PANTRY-LOCATION-GROUPING | ⚠️ pending design-gap (mockup viser kjøleskap/skap/fryser, backend mangler `inventory.location`) |
| RECIPE-KCAL | 🔒 **låst som ikke-scope** (B7 locked-decision i `backend-requirements.md`) |
| RECIPE-TAGS | ⏸️ tags-felt ikke i datamodell. `backend-requirements.md` foreslår mig. 022 (recipes.tags JSON array) |
| INGREDIENT-PREFERENCES (unpreferred per recipe) | ⏸️ ny tabell `ingredient_preferences` foreslått, ikke implementert |

### 6.3 Design-mockups

`design/2026-04-redesign/source/Familieassistenten.html` dekker:
- Skjerm 01 — Dashboard
- Skjerm 02 — Kalender
- Skjerm 03 — Ukesmeny (Meals)
- Skjerm 04 — Handle (Shopping + Pantry sub-tab gruppert per Kjøleskap/Kjøkkenskap/Fryser)
- Skjerm 05 — Gjøremål (chores + gamification)
- Skjerm 00 — Settings

`Onboarding og Auth.html`: ScreenWelcome, Login, MagicSent, Bootstrap, Signup, Error.

**Design-gaps for meals-domenet** (fra `design-gaps.md`):
- Kategori-strenger mangler i18n (norsk hardkodet i seed.js + LLM-prompts) — kun manuelle items har enum-keys
- `inventory.location` ikke i datamodell men pantry-mockup grupperer per location
- "Marker brukt"-dialog er pilot-tilleggs-funksjon, ikke i mockup
- Inline-edit av qty/unit på shopping-list-item mangler

### 6.4 Backend-krav-analyse fra april 2026

`design/2026-04-redesign/extracted/backend-requirements.md` (referanse-dato 2026-04-23). Konklusjoner relevante for Sprint 11:

**Allerede dekket siden 2026-04:**
- Per-medlem diet (B7) — mig. 020
- Pantry total-size (B6/F2) — mig. 008
- Recipe sources (F7) — mig. 011
- shelf-observations + shelf_days_learned — mig. 017
- Multi-tenant family-scoping — mig. 014, 016, 024
- Atomic onboarding — Sprint 4
- Shopping persistente lister + smart-merge — mig. 007 + Sprint 6
- Sprint 6 smart-coupling (meal-cooked → pantry-deduction)

**Fortsatt utestående (relevant for meals-domenet):**
- Mig. 021 `inventory.location` (kjøleskap/skap/fryser-gruppering)
- Mig. 022 `recipes.tags` (JSON array) + `families.gamification_enabled` + `integration_configs` (generisk per-familie API-key)
- Mig. 023 `ingredient_preferences` ("vil ikke ha i X")
- `meal_pattern_favorites` (lagre uke som favoritt)
- `GET /api/config/features` (offentlig feature-gating)
- Per-familie Kassal-key (D4 — `integration_configs`-mønster)

---

## 7. Tester

### 7.1 Test-coverage for Måltider (32 backend-tester)

**Meal-planning + recipe:**
- `meal-planning-picker-chain.test.js` — picker → swap → mark-eaten chain
- `recipe-library-findByName.test.js` — recipe lookup
- `recipe-url-import.test.js` — URL-import flyt
- `iteration3d-recipe-import.test.js` — LLM tekst/bilde-import
- `iteration3c-normalizer.test.js` — EN→NO + qty-extraction
- `fase-f4-recipe-similarity.test.js` — recipe-similarity scoring
- `fase-f7-recipe-sources.test.js` — Pinterest/godt sync
- `fase-f3-profile-filter.test.js` — recipe-filter flow

**Pantry:**
- `pantry-coverage.test.js` — scoreRecipeByPantry + rankRecipes
- `pantry-display-name-hotfix.test.js` — display-name fallback
- `fase-f1-pantry-resolver.test.js` — pantry-add resolver
- `fase-f2-units-pantry.test.js` — total_size + units
- `fase-2e-pantry-frontend-flow.test.js` — pantry frontend-flow
- `e2e-pantry-shopping-chain.test.js` — pantry → shopping integration

**Shopping:**
- `shopping-has-home.test.js` — has-home flow
- `shopping-items-add.test.js` — add manual items
- `shopping-manual-item-bought-pantry-bug.test.js` — bug-regression
- `shopping-toggle-and-delete.test.js` — toggle + delete
- `shopping-smart-merge.test.js` — merge-mode regenerate

**Sprint 6 (smart-coupling):**
- `sprint-6-meal-deduction.test.js`
- `sprint-6-smart-coupling-chain.test.js`

**Kassal:**
- `kassal-env-activation.test.js` (20 kassal-mentions) — KASSAL_API_KEY env-flow
- `iteration3a.test.js` (85) — resolver scoring + chain-boost
- `iteration3b.test.js` — shopping-list-generation
- `iteration3b-enricher.test.js` (17) — enricher flyt + circuit-breaker

**Reliability + supply-chain:**
- `m-week2-supply-chain.test.js`
- `m-week5-performance.test.js`
- `m-week6-chaos.test.js`
- `m-week6-observability.test.js`
- `m-week8-typecheck.test.js`
- `m-week9-safety.test.js`
- `m4-observability.test.js`

**Frontend (vitest, client/src/app/{meals,shopping,pantry}/*.test.ts og *.test.tsx):**
- `meals/mealsApi.test.ts`, `shopping/shoppingApi.test.ts`, `shopping/packDisplay.test.ts`, `pantry/pantryApi.test.ts`
- Alle component-tester ligger ved siden av `*.tsx`-fil (Wordmark.test.tsx, MealHero.test.tsx, …)

### 7.2 Coverage-tall

Globale terskler: 80/68/72 (lines/branches/functions). Ny kode skal score 85/75/80.

Faktiske coverage-tall ble ikke kjørt i denne analyse-runden (ville krevd 2-3 min `npm run test:coverage`). Anbefaling: kjør `npm run test:coverage:gate` før Sprint 11 for å fange tester med <70%.

**Identifiserte hull (basert på fil-utseende, ikke verifisert):**
- `recipe-similarity.service.js` (115 linjer) — kun én test (`fase-f4-recipe-similarity`)
- `recipe-sources.service.js` (117 linjer) — kun én test (`fase-f7-recipe-sources`)
- `pantry-resolver.service.js` (228 linjer) — kun én test (`fase-f1-pantry-resolver`)
- `recipe-import.service.js` (365 linjer) — én test (`iteration3d-recipe-import`)
- `recipe-url-import.service.js` (262 linjer) — én test (`recipe-url-import`)

---

## 8. Dependencies og infrastruktur

### 8.1 npm-pakker (måltider-relevante)

| Pakke | Versjon | Bruk |
|---|---|---|
| `better-sqlite3` | ^12.9.0 | DB-driver |
| `zod` | ^4.4.2 | Schema-validering (config + body) |
| `pino` | ^10.3.1 | Strukturert logging |
| `i18next` | 26.0.8 | i18n core |
| `react-i18next` | 17.0.6 | React-binding |
| `i18next-browser-languagedetector` | 8.2.1 | Locale-deteksjon |
| `lucide-react` | 1.14.0 | Ikoner |
| `@sentry/node` | ^8.0.0 | Optional — observability |
| `sql.js` | ^1.14.1 | Optional fallback-DB |

**HTTP-klient:** ingen — bruker native `fetch` i kassal-client.
**Rate-limit-bibliotek:** ingen — egen token bucket inline.
**Cache-bibliotek:** ingen — DB-backed via `kassal_cache`-tabell.
**Date-libs:** ingen — bruker native `Date` + `Intl.DateTimeFormat`.

Dev-side: vitest 4.1.5, vite 6.4.2, react-router-dom 6.30, tailwind 3.4.15, openapi-typescript 7.13.

### 8.2 Eksterne integrasjoner

| Integrasjon | Status | Endpoints/host |
|---|---|---|
| Ollama (LLM) | ✅ aktiv (default) | `OLLAMA_HOST=http://localhost:11434`, `OLLAMA_MODEL=qwen2.5:3b` |
| Anthropic / OpenAI / xAI / llamacpp | ✅ kode | Per-familie via `family_llm_config` + `ENCRYPTION_KEY`-encrypted api_key |
| Resend (email) | ✅ Sprint 9 | `RESEND_API_KEY` |
| Google OAuth | ✅ kode | `GOOGLE_CLIENT_ID/SECRET` (per-instans) |
| **Kassal.app** | ⚠️ infra klar, ikke aktivert | `https://kassal.app/api/v1` (token bucket 55/min, TTL search 24t / ean 7d / id 30d) |
| Sentry | optional | `SENTRY_DSN` |
| Whisper (STT) | endpoints finnes | `/api/stt/transcribe`, `/api/stt/status` |

### 8.3 Background jobs (cron, server/cron.js)

12 jobs registrert via `startCronJobs(repos)`:

| Job | Frekvens | Måltider-relevans |
|---|---|---|
| Sunday-push | Søndag 14:00 | **Genererer sunday_drafts for neste uke** via `meal-planning.generateSundayDraft` + `notifications.insert('sunday_push', …)` |
| Chore-plan | Mandag 07:00 | Husarbeid (utenfor scope) |
| Shelf-life | Daglig 08:00 | **Varsler om varer som utløper ≤1d** (skanner inventory.expires_est) |
| Pantry-expired | Daglig 08:05 | **Sletter expired items fra inventory** (qty>0 + expires<today) |
| Depletion | Daglig 22:00 | **Auto-decrement pantry basert på dagens meal_plan** (har egen kjøring uavhengig av mark-eaten) |
| LLM-cache-cleanup | Daglig 04:00 | Rydder ut llm_cache (utløpt) |
| Price-CPI-indexing | 1. i mnd 05:00 | Indekserer price_references mot CPI |
| GDPR-soft-delete-purge | Daglig 03:30 | Hard-delete soft-deleted users etter retention |
| Session-cleanup | Daglig 04:10 | sessions.expires_at < now |
| Magic-link-cleanup | Daglig 04:15 | magic_link_tokens cleanup |
| **Shopping-enrichment** | **Hver 10. minutt** | **Plukker opp shopping_lists med enrichment_status ∈ ('pending','partial')** og kjører `enrichPendingLists(repos, {maxLists:3, delayMs:1100})`. Stops tidlig ved circuit-open eller tom token bucket. |
| Recipe-sources-sync | Hver 6t | Pinterest/godt/RSS/HTML resync |

**OBS — multi-tenant cron-gap:** `dailyDepletionJob` og `shelfLifeCheckJob` kaller `repos.mealPlans.getWeek(wk)` UTEN family-context. På multi-tenant-deploy vil disse kjøre i null/default-family-scope og kan rotere for andre familier. Ikke kritisk for pilot (én familie), men flagg før neste pilot-utvidelse. Krev sannsynligvis `forEachFamily(...)` wrapper i cron.

---

## 9. Sammendrag og gap-analyse

### 9.1 Hva er PRODUCTION-KLART (ende-til-ende fungerende flyter)

1. **Ukesplanlegging:** Bruker åpner Meals, ser 7-dagers-strip, velger dag, kan plan/swap recipe via picker (alle 36 oppskrifter), sees i live-data. (Frontend: Meals.tsx → useMealsData → /api/meals/current; Backend: meal.repo + recipes)
2. **Mark-cooked + pantry-deduction:** Bruker trykker "Marker tilberedt", får MarkCookedDialog med per-ingrediens forslag fra `pantry-deduction.buildSuggestions`, justerer mengde, bekrefter → pantry trekkes via correctQty + writes inventory_log.
3. **Shopping-list-generering:** "Generer fra ukens middager" → `POST /api/shopping/generate` → persisterer i shopping_lists + shopping_list_items med pantry-coverage-beregning per ingredient (needs_buy/pantry_has).
4. **Manual shopping-items:** QuickAddInput → `POST /api/shopping/items` med category enum-key + i18n-resolverer i CategoryGroup.
5. **Mark-bought + restocks pantry:** `PUT /api/shopping/items/:id/bought` → writes inventory_log(reason='shopping_bought') + oppdaterer inventory.qty_remaining.
6. **Pantry-view m/ progress-bar:** PantryView grupperer per category, hver PantryItem viser progress (`qty_remaining/total_size`), expiry-badge, "marker brukt"-dialog (UseDialog).
7. **Pantry CRUD:** Add via QuickAddPantry (pantry-resolver finner products-match), correct via UseDialog, delete via PantryItem-meny.
8. **Sunday-draft:** Cron søndag 14:00 genererer + lagrer sunday_drafts + sender notifikasjon.
9. **Receipt-ingest (OCR + LLM-parse):** `POST /api/receipts/upload` → LLM parser linjer → confirm flyt → inventory backfill (eksisterer; brukes ikke i dev-DB enda).
10. **Recipe-import:** `POST /api/recipes/import` (paste tekst), `import/image` (OCR), `import-url` (Pinterest/godt-fetch). LLM-parser → recipes-rad.
11. **Pantry-aware "Hva kan jeg lage nå?":** `POST /api/meals/pantry-suggestions {category}` → top-5 oppskrifter rangert etter pantry-coverage. Accept-flyt skriver til ukeplan + varsler missing ingredients.
12. **Multi-tenant isolation:** Alle 13+ måltider-tabeller har `family_id NOT NULL` + `ON DELETE CASCADE` (mig. 024). Cross-tenant tester håndhever isolation.
13. **i18n NO+EN parity:** alle keys speilet i begge språk (bundle-test håndhever).
14. **White-label brand (Sprint 10):** APP_NAME/PRIMARY/ACCENT env-vars driver UI uten rebuild.

### 9.2 Hva er DELVIS implementert (kode finnes, gap mot UX/data)

1. **Kassal-integrasjon:** Hele backend-stack klar (klient + resolver + enricher + cache + cron + tests + admin-status). **Aktivering mangler:** `KASSAL_API_KEY` ikke satt → 0 rader i alle 3 Kassal-tabeller. Frontend-UI for `enrichment_status` (badge, retry, butikklogo) mangler. Manual SKU-velger ved confidence < 0.3 mangler (resolver lagrer kandidater i `resolution_candidates_json`, ingen UI bruker det).
2. **Recipe-similarity:** Service finnes (`recipe-similarity.service.js`), endpoint `GET /api/recipes/:id/similar` finnes — men ingen UI bruker det. Mangler "Liknende oppskrifter"-rad i RecipePickerDialog.
3. **Recipe-sources (Pinterest/godt/RSS):** Service + cron + UI-routes (`/api/sources/*`) eksisterer, 0 rader i `recipe_sources` på dev-DB. Ingen settings-UI for å legge til kilder.
4. **Receipts:** Hele OCR + LLM-parse-flyten finnes, men ingen frontend-skjerm bruker den. Pantry får ikke restocks fra kvitteringer enda.
5. **Shelf-life learning:** mig. 017 + service eksisterer. UI viser ikke `shelf_days_learned` eller "den lærer fra hva du faktisk bruker".
6. **`/api/admin/kassal/status`:** Finnes, men Admin.tsx-skjermen er placeholder-aktig — ingen visualisering av token-bucket, circuit-state, eller cache-hit-rate.
7. **Per-medlem diet (mig. 020):** Datamodell + filter-kode i `recipe-filter.service.js` finnes. Bare family-level diet brukes i `meal-planning.service.isRecipeSafe`. Per-member-enforcement venter UI (per `recipe-filter`-kommentar).
8. **Pantry-grouping per location:** Mockup viser kjøleskap/kjøkkenskap/fryser. Backend mangler `inventory.location`. Pilot bruker kategori-grupperting istedenfor.
9. **Sprint 6 smart-coupling:** `dailyDepletionJob` (cron 22:00) auto-decrement-er allerede pantry basert på dagens meal — uten user confirmation. Det er overlapp med `apply-deduction`-flyten (manuelt). Risiko for double-deduction hvis bruker har markert eaten + cron har kjørt. (Ikke verifisert i denne kjøringen — krever lese pantry-deduction-tester.)

### 9.3 Hva er IKKE implementert (bekreftet via kode-søk + roadmap-dokumentasjon)

1. **Kassal-aktivering live (post-pilot 1-2 dager):** Sett key + frontend `enrichment_status` UI + retry-CTA + butikklogo.
2. **Pris-friskhetsindikator:** Ingen visning av "siste pris-oppdatering". Kassal-data har `last_seen_at` men ingen UI bruker det.
3. **"Smart meal-suggestions basert på pantry" som standard mode:** Eksisterer som eksplisitt mode-toggle (default/maksimer/balansert) i `family_profile.preferences.suggestionMode`. Mangler: standard mode er fortsatt `default` (random). Pantry-aware browse i RecipePickerDialog mangler (foreslått 1-2 uker).
4. **Product packaging awareness (post-pilot 2-3 uker):** `products.pack_size_g` + pantry to qty-akser (antall pakker + restmengde) + åpen-pakke-først-konsumering.
5. **Shelf-life database (UI-side):** `product_shelf_observations` skrives men ingen brukervendt visning.
6. **Matsvinn-tracking:** Ingen aggregering "X kr i utløpte varer denne måneden". Cron `pantryExpiredJob` sletter — men registrerer ikke svinn-tall.
7. **Recipe-tags:** Mig. 022 foreslått, ikke implementert. Mockup viser tags ("Familiens favoritt", "Glutenfri", "Omega-3") men datamodell mangler felt.
8. **`ingredient_preferences` ("vil ikke ha i X"):** Ny tabell foreslått, ikke implementert. Backend kan filtrere allergi/diet, men ikke per-recipe ingredient-preferanser.
9. **`meal_pattern_favorites`:** "Lagre uke som favoritt" — ikke implementert.
10. **`inventory.location` (mig. 021):** Pantry-grouping per kjøleskap/skap/fryser — mangler.
11. **Tidligere-handlelister-arkiv:** Ingen `shopping_lists.archived_at`. status='done' ≠ "skjul fra liste-historikk".
12. **Top-20-varer-rapport:** Mangler `(family_id, bought_at)`-index. Roadmap forutsetter migrasjon før dette bygges.
13. **Faste varer (recurring):** Ingen explicit "husholdnings-essensielle"-liste. Consumables-mekanismen er nærmeste ekvivalent men er anti-svinn-orientert (auto_add < threshold).
14. **Per-familie Kassal-key (D4-beslutning):** Ny tabell `integration_configs(family_id, integration_id, config_json, enabled)`. Mig. 022 foreslått inneholder denne.
15. **Direkte Kassal-product-search-UI:** Bruker kan ikke åpne en "søk etter produkt"-dialog når de adder manual-item. Resolver-en gjør jobben automatisk via shopping-enricher, men ingen interaktiv flyt.
16. **`GET /api/config/features` (offentlig):** Foreslått i `backend-requirements.md` for feature-gating av authProviders + features (calendar/google, kassal, gamification, …). Ikke implementert.
17. **Recipe-kcal:** **Eksplisitt låst som ikke-scope** for v1 (B7 locked-decision, diabetes-støtte pushed til fase 2).
18. **Calendar-integration (Google):** B6 i roadmap — 3-6 uker arbeid. Ingen kode utover stub-routes.
19. **Achievement-system (5 mockup-merker):** ❌ ingen kode.
20. **Week-goals + reward:** ❌ ingen kode.

### 9.4 Anbefalte READ-ME-files for diskusjons-Claude

For en diskusjons-Claude som skal rådgi om Sprint 11-arkitektur, anbefaler jeg disse 8 filene:

| Fil | Hvorfor viktig |
|---|---|
| `docs/workflow/post-pilot-roadmap.md` | Christer's egen parkerings-katalog. §"Kassal-aktivering med live-priser" + §"Product packaging awareness" + §"Pantry-aware recipe suggestions" gir 80% av strategi-konteksten. |
| `server/migrations/006_product_resolution.sql` | Hele Kassal-skjemaet (kassal_products, product_resolutions, kassal_cache) med design-rationale i kommentarer. |
| `server/services/kassal-client.service.js` | HTTP-klient med rate-limit + circuit-breaker + cache. Viser hvilke konstanter som styrer rate (BUCKET_CAPACITY=55, KASSAL_TIMEOUT_MS=8000, CIRCUIT_ERROR_THRESHOLD=3). |
| `server/services/product-resolver.service.js` | Scoring-formelen (overlap × 0.5 + brand × 0.25 + pack-size × 0.2 + price-known × 0.05 + chain-boost). MIN_AUTO_CONFIDENCE=0.3. |
| `server/services/shopping-list-enricher.service.js` | Background sweep-flyten + idempotens-regler (done/running fast-exit + no-API-key short-circuit + partial-on-bail). |
| `design/2026-04-redesign/extracted/backend-requirements.md` | Mockup ↔ backend mapping i 660 linjer; eksplisitte beslutninger fra 2026-04-23 (kcal låst, tags planlagt, Kassal per-familie via D4). |
| `server/services/meal-planning.service.js` | Sunday-draft + pantry-rest-of-week + suggestion-modes (default/maksimer/balansert). |
| `server/cron.js` | 12 cron-jobs — særlig `shoppingEnrichmentJob` (10 min) + `dailyDepletionJob` (22:00) + multi-tenant-cron-gap. |

Sekundær lesning ved fordypning:
- `server/services/pantry-coverage.service.js` (vekt-formel for ranking)
- `server/services/shopping-list.service.js` (merge-mode preservation-logikk)
- `docs/analyses/2026-05-04-kassal-env-activation.md` (Kassal-aktiverings-plan)

---

## Konklusjon for Sprint 11-planlegging

Måltider-domenet er **mye mer modent enn det fremstår**:

- 13+ tabeller fullt rigget med family-scoping + FK CASCADE
- 16 services dekker pantry-coverage scoring, smart-merge regenerate, EAN-resolver, chain-boost, circuit-breaker, cache, OCR-receipt, LLM-recipe-import, Pinterest/godt/RSS-sync
- ~95 routes med konsistent auth-gating
- 32+ tester med fokus på multi-tenant + supply-chain + chaos
- Kassal-stacken er **fullt implementert men slått av** — aktivering er mer kosmetisk-arbeid enn ny-bygging (1-2 dager UI + env-config)

**Største utestående arbeid for Kassal-aktivering** (post-pilot):
1. Sett `KASSAL_API_KEY` i Portainer
2. Frontend `EnrichmentStatusBadge` + retry-CTA på Shopping-skjermen
3. Optional: butikk-logo + pris-friskhetsindikator
4. Per-familie key-konfig (D4 — krever mig. 022 + Settings-UI)

**Største utestående arbeid for pantry-fokuserte features** (post-pilot):
1. Pantry-aware recipe suggestions som default mode-toggle (1-2 uker)
2. Product packaging awareness (2-3 uker, schema + pantry to-akser-tracking)
3. `inventory.location` for kjøleskap/skap/fryser-grouping (mig. 021)
4. `recipes.tags` + UI-filter (mig. 022)
5. `ingredient_preferences` "vil ikke ha i X" (mig. 023)

Dette er datagrunnlaget. Sprint 11-scoping kan nå skje på solid kunnskap om at **mer enn 80% av infrastrukturen for de prioriterte features er allerede skrevet og testet**.
