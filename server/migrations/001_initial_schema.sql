-- Migration 001: Initial relasjonelt schema
-- Fase 1 av ISO/IEC 25010-opprydding: erstatter KV-blob-anti-patternet med
-- ekte tabeller, FK-relasjoner og indekser. Basert på DESIGNDOKUMENT.md §2.2.

-- ============================================================
-- PRODUKT-KATALOG
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  product_name  TEXT NOT NULL,
  category      TEXT NOT NULL,
  pack_size     REAL NOT NULL,
  unit          TEXT NOT NULL,
  est_price     REAL,
  shelf_days    INTEGER,
  store         TEXT DEFAULT 'Kiwi Vågsbygd',
  ean           TEXT,
  dairy_rule    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_key ON products(key);

-- ============================================================
-- OPPSKRIFTER
-- ============================================================

CREATE TABLE IF NOT EXISTS recipes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('rask', 'comfort', 'helg')),
  prep_time     TEXT,
  source        TEXT,
  url           TEXT,
  pinterest_url TEXT,
  servings      INTEGER DEFAULT 2,
  equipment_json TEXT,
  notes         TEXT,
  times_cooked  INTEGER DEFAULT 0,
  last_cooked   TEXT,
  rating        REAL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_key TEXT,
  name        TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit        TEXT NOT NULL,
  optional    INTEGER DEFAULT 0,
  sort_order  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_product ON recipe_ingredients(product_key);

-- ============================================================
-- INVENTORY (hva vi har hjemme)
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory (
  product_key   TEXT PRIMARY KEY,
  qty_remaining REAL NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT '',
  last_purchased TEXT,
  last_pack_size REAL,
  expires_est   TEXT,
  purchase_count INTEGER DEFAULT 0,
  avg_days_between_purchase REAL,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_expires ON inventory(expires_est);

-- ============================================================
-- UKEPLAN (måltider)
-- ============================================================

CREATE TABLE IF NOT EXISTS meal_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year   TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_type   TEXT DEFAULT 'middag',
  recipe_id   INTEGER REFERENCES recipes(id),
  status      TEXT DEFAULT 'planned' CHECK (status IN ('planned','cooked','skipped','away')),
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(week_year, day_of_week, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_meal_plans_week ON meal_plans(week_year);

-- ============================================================
-- HUSARBEID (chores definition + weekly schedule)
-- ============================================================

CREATE TABLE IF NOT EXISTS chores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task        TEXT NOT NULL,
  details     TEXT,
  frequency   TEXT NOT NULL,
  default_day INTEGER,
  icon        TEXT,
  active      INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chore_schedules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id      INTEGER NOT NULL REFERENCES chores(id),
  week_year     TEXT NOT NULL,
  scheduled_day INTEGER NOT NULL,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','done','postponed')),
  postponed_to  INTEGER,
  completed_at  TEXT,
  notes         TEXT,
  UNIQUE(chore_id, week_year)
);

CREATE INDEX IF NOT EXISTS idx_chore_sched_week ON chore_schedules(week_year);

-- ============================================================
-- CONSUMABLES (ikke-oppskrift-varer med forbruksmønster)
-- ============================================================

CREATE TABLE IF NOT EXISTS consumables (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key       TEXT,
  name              TEXT NOT NULL,
  pack_name         TEXT,
  category          TEXT NOT NULL,
  depletion_model   TEXT NOT NULL,
  depletion_rate    REAL,
  depletion_unit    TEXT,
  current_qty       REAL DEFAULT 0,
  unit              TEXT NOT NULL,
  pack_size         REAL,
  pack_unit         TEXT,
  est_price         REAL,
  reorder_threshold REAL,
  auto_add          INTEGER DEFAULT 1,
  store             TEXT,
  notes             TEXT,
  last_purchased    TEXT,
  purchase_count    INTEGER DEFAULT 0,
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consumables_auto ON consumables(auto_add);

CREATE TABLE IF NOT EXISTS consumable_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id   INTEGER NOT NULL REFERENCES consumables(id),
  qty_used        REAL,
  logged_at       TEXT DEFAULT (datetime('now')),
  context         TEXT
);

-- ============================================================
-- HANDLELISTE-EKSTRA (manuelt tillagte varer per uke)
-- ============================================================

CREATE TABLE IF NOT EXISTS shopping_extras (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year   TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'Tørrvarer & annet',
  quantity    REAL,
  checked     INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shop_extras_week ON shopping_extras(week_year);

-- ============================================================
-- SELVFORBEDRING: kjøpshistorikk + måltidshistorikk
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key   TEXT NOT NULL,
  qty           REAL NOT NULL,
  unit          TEXT,
  price_paid    REAL,
  store         TEXT,
  purchased_at  TEXT DEFAULT (datetime('now')),
  source        TEXT DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_purchase_log_key ON purchase_log(product_key);
CREATE INDEX IF NOT EXISTS idx_purchase_log_date ON purchase_log(purchased_at);

CREATE TABLE IF NOT EXISTS meal_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id),
  cooked_at   TEXT DEFAULT (date('now')),
  rating      REAL,
  leftovers   INTEGER DEFAULT 0,
  notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_meal_history_recipe ON meal_history(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_history_date ON meal_history(cooked_at);

-- ============================================================
-- KALENDER
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  location    TEXT,
  all_day     INTEGER DEFAULT 0,
  notes       TEXT,
  source      TEXT DEFAULT 'local',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cal_date ON calendar_events(date);

-- ============================================================
-- KUNNSKAPSBASE (samtalehistorikk + tool-call audit)
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_base (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  user_message  TEXT NOT NULL,
  ai_response   TEXT NOT NULL,
  context_json  TEXT,
  intent        TEXT,
  entities_json TEXT,
  embedding_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_kb_timestamp ON knowledge_base(timestamp);
CREATE INDEX IF NOT EXISTS idx_kb_intent ON knowledge_base(intent);

-- ============================================================
-- VARSLER
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  message     TEXT,
  data_json   TEXT,
  read        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);

-- ============================================================
-- SØNDAGS-DRAFT (LLM-forslag for neste uke — venter på godkjenning)
-- ============================================================

CREATE TABLE IF NOT EXISTS sunday_drafts (
  week_year     TEXT PRIMARY KEY,
  meals_json    TEXT NOT NULL,
  generated_at  TEXT DEFAULT (datetime('now')),
  accepted      INTEGER DEFAULT 0
);

-- ============================================================
-- LLM-AUDIT (Fase 4/safety: hvilke tool-calls ble kjørt av LLM?)
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  tool_name   TEXT NOT NULL,
  arguments   TEXT,
  result      TEXT,
  success     INTEGER DEFAULT 1,
  user_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_ts ON llm_audit(timestamp);
