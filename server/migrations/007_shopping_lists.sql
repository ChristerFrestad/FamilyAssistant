-- Migration 007: Persistente handlelister + meal_plan 'removed' + inventory_log 'shopping_bought'
-- Fase A av iterasjon 3b (shopping-flow-redesign).
--
-- Hovedtanke: Handlelisten går fra å være en in-memory beregning i
-- buildShoppingList() til å være en DB-entitet. Det gir oss:
--   * "merk som kjøpt"-state som overlever request-grensen
--   * Et sted å hekte på Kassal-berikelse (fase B)
--   * Mulighet til å si "jeg har ikke denne varen likevel" under handling
--   * En naturlig plass for autogenerering når uken er komplett
--
-- Samtidig utvider vi to eksisterende tabeller:
--   * meal_plans.status får 'removed' — skiller "eksplisitt tomstilt"
--     fra "aldri valgt (null)". Begge teller som "dagen er avklart",
--     men bare 'removed' betyr at bruker har tatt et bevisst valg.
--   * inventory_log.reason får 'shopping_bought' — slik at vi kan skille
--     pantry-oppdateringer fra kvitteringsbekreftelse (reason='receipt')
--     og manuell add (reason='manual') fra "merk kjøpt i handleliste".
--
-- Designvalg:
--   * shopping_lists har ikke tabell-nivå UNIQUE(week_year, status) fordi
--     vi trenger flere 'superseded'- og 'done'-rader per uke. I stedet:
--     partial unique index som kun bryr seg om 'active'.
--   * shopping_list_items har kolonner klar for Kassal-berikelse (fase B)
--     og for EN↔NO normalisering (fase C), men fase A skriver kun
--     ingredient_name + pantry_has + needs_buy + source-metadata.
--   * meal_plans og inventory_log rewrites bevarer alle eksisterende rader
--     bit-for-bit — eksplisitt kolonneliste og id-bevaring.
--   * Ingen FK fra andre tabeller peker PÅ meal_plans eller inventory_log,
--     så DROP+RENAME er trygt. Verifisert via grep i alle migrasjoner.

-- ============================================================
-- SHOPPING LISTS
-- ============================================================

CREATE TABLE IF NOT EXISTS shopping_lists (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year              TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                           'draft',       -- reservert for fremtidig "forhåndsvisning"
                           'active',      -- bruker handler fra denne
                           'done',        -- alle items haket ut / lukket manuelt
                           'superseded'   -- ny liste er generert over denne
                         )),
  generated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at           TEXT,
  enrichment_status      TEXT NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN (
                           'pending',  -- ikke startet (fase A slutt-tilstand)
                           'running',  -- fase B: enricher jobber
                           'done',     -- fase B: alle items berørt
                           'partial',  -- fase B: circuit break/rate limit, plukkes opp av cron
                           'failed'    -- fase B: gitt opp
                         )),
  enrichment_started_at  TEXT,
  enrichment_finished_at TEXT,
  total_est_price        REAL,
  notes                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_week ON shopping_lists(week_year);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_status ON shopping_lists(status);

-- Maks én 'active' handleliste per uke. Partial unique index er SQLites
-- idiomatiske løsning; vanlig UNIQUE ville forbudt flere 'superseded'/'done'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_lists_active_per_week
  ON shopping_lists(week_year) WHERE status = 'active';

-- ============================================================
-- SHOPPING LIST ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id                    INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  source_type                TEXT NOT NULL CHECK (source_type IN (
                               'meal_ingredient',  -- fra recipe_ingredients via ukeplan
                               'consumable',       -- fra consumables (auto-reorder under threshold)
                               'extra',            -- fra shopping_extras (manuelt tillagt før generering)
                               'manual'            -- manuelt tillagt etter at lista ble generert
                             )),
  source_ref                 TEXT,                 -- recipe_id / consumable_id / extra_id som streng
  ingredient_name            TEXT NOT NULL,        -- originaltekst (NO eller EN)
  ingredient_name_no         TEXT,                 -- normalisert norsk (fylles i fase C)
  product_key                TEXT,                 -- intern products.key hvis kjent
  qty                        REAL,
  unit                       TEXT,
  brand_hint                 TEXT,                 -- f.eks. 'First Price', 'Tine'
  category                   TEXT,                 -- UI-kategori for sortering
  pack_size                  REAL,
  pack_unit                  TEXT,
  pack_count                 INTEGER,              -- antall pakker å kjøpe
  est_price                  REAL,                 -- beregnet pris (pack_count * unit_price)
  pantry_has                 INTEGER NOT NULL DEFAULT 0,  -- 1 = finnes i pantry (allerede dekket)
  pantry_qty                 REAL,                 -- hvor mye som ligger i pantry
  needs_buy                  INTEGER NOT NULL DEFAULT 1,  -- 0 = dekket fra pantry, 1 = må kjøpes
  bought_at                  TEXT,
  bought_qty                 REAL,
  -- Kassal-berikelse (fase B fyller disse)
  kassal_product_id          INTEGER REFERENCES kassal_products(id),
  resolution_id              INTEGER REFERENCES product_resolutions(id),
  resolution_candidates_json TEXT,
  resolution_confidence      REAL,
  resolved_via               TEXT,
  -- Kontekst
  meals_json                 TEXT,                 -- array av middag-navn som bruker denne
  dairy_note                 TEXT,                 -- rødt/gult flagg fra products.dairy_rule
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  notes                      TEXT
);

CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_needs ON shopping_list_items(list_id, needs_buy);
CREATE INDEX IF NOT EXISTS idx_shopping_items_kassal ON shopping_list_items(kassal_product_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_product_key ON shopping_list_items(product_key);

-- ============================================================
-- MEAL PLANS: legg til 'removed' status via tabell-rewrite
-- ============================================================
-- SQLite kan ikke ALTER en CHECK-constraint. Standard-dansen:
--   1. CREATE new-table med ny CHECK
--   2. Kopier alle rader med eksplisitt kolonneliste
--   3. DROP gammel + RENAME ny
--   4. Gjenopprett indekser
-- Dette kjøres innenfor migrasjonens transaksjon, så alt-eller-intet.

CREATE TABLE meal_plans__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year   TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_type   TEXT DEFAULT 'middag',
  recipe_id   INTEGER REFERENCES recipes(id),
  status      TEXT DEFAULT 'planned' CHECK (status IN (
                'planned',  -- bruker har ikke tatt stilling enda
                'cooked',   -- middagen er lagd
                'skipped',  -- "vi droppet middag den dagen"
                'away',     -- "vi var ikke hjemme" (valid uke-komplett)
                'removed'   -- "dag eksplisitt tomstilt etter valg" (valid uke-komplett)
              )),
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(week_year, day_of_week, meal_type)
);

INSERT INTO meal_plans__new (id, week_year, day_of_week, meal_type, recipe_id, status, notes, created_at)
  SELECT id, week_year, day_of_week, meal_type, recipe_id, status, notes, created_at
  FROM meal_plans;

DROP TABLE meal_plans;
ALTER TABLE meal_plans__new RENAME TO meal_plans;

CREATE INDEX IF NOT EXISTS idx_meal_plans_week ON meal_plans(week_year);
CREATE INDEX IF NOT EXISTS idx_meal_plans_recipe ON meal_plans(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON meal_plans(status);

-- ============================================================
-- INVENTORY LOG: legg til 'shopping_bought' reason via tabell-rewrite
-- ============================================================

CREATE TABLE inventory_log__new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key   TEXT NOT NULL,
  qty_delta     REAL NOT NULL,
  new_qty       REAL NOT NULL,
  unit          TEXT,
  reason        TEXT NOT NULL CHECK (reason IN (
                  'manual',
                  'receipt',
                  'cron_depletion',
                  'correction',
                  'shelf_life_expired',
                  'initial_seed',
                  'shopping_bought'   -- NY i 007
                )),
  source_id     INTEGER,
  source_table  TEXT,
  notes         TEXT,
  logged_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO inventory_log__new (id, product_key, qty_delta, new_qty, unit, reason, source_id, source_table, notes, logged_at)
  SELECT id, product_key, qty_delta, new_qty, unit, reason, source_id, source_table, notes, logged_at
  FROM inventory_log;

DROP TABLE inventory_log;
ALTER TABLE inventory_log__new RENAME TO inventory_log;

CREATE INDEX IF NOT EXISTS idx_inv_log_key_time ON inventory_log(product_key, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_log_reason ON inventory_log(reason);
CREATE INDEX IF NOT EXISTS idx_inv_log_source ON inventory_log(source_table, source_id);
