-- Migration 024: drop DEFAULT 1 on the remaining 17 family_id columns
-- and add ON DELETE CASCADE FK to families on each of them.
--
-- Background and rationale (see docs/analyses/2026-05-02-multi-tenant-audit.md):
--
-- Migration 014 introduced `family_id INTEGER NOT NULL DEFAULT 1` on every
-- per-family table so the existing single-tenant code kept working while
-- multi-tenant scoping was rolled out. Migration 016 cleaned up four
-- tables (inventory, meal_plans, shopping_lists, family_profile) — but
-- 17 tables were never finished. Until this migration, an INSERT that
-- forgets `family_id` lands silently on family 1, which is exactly the
-- footgun that produced the seed-bug repaired in Lag A.
--
-- This migration finishes the work:
--   * Drop the DEFAULT 1 — any future stray INSERT becomes a NOT NULL
--     constraint error instead of a silent cross-tenant write.
--   * Add ON DELETE CASCADE referencing families(id) — when a family is
--     deleted, all per-family rows go with it. Required for the GDPR
--     "right to be forgotten" path.
--
-- SQLite cannot ALTER a column's DEFAULT or add a FK in place, so each
-- table is rebuilt via the standard CREATE __new / INSERT SELECT / DROP /
-- RENAME / recreate-indexes dance. We preserve all columns, CHECK
-- constraints, and ids bit-for-bit. The migration runner already wraps
-- the file in a transaction and FK-enforcement only matters at
-- statement boundaries, so the rebuild succeeds even when other tables
-- have FKs pointing at the renamed table.
--
-- Idempotency: running this migration twice is a no-op because the
-- resulting schema no longer has DEFAULT 1. The migration runner
-- records version '024' in schema_migrations exactly once.
--
-- 17 tables affected:
--   audit_log, calendar_events, chore_schedules, chores, consumable_log,
--   consumables, inventory_log, knowledge_base, llm_audit, meal_history,
--   notifications, purchase_log, receipt_items, recipe_ingredients,
--   recipes, shopping_extras, shopping_list_items.

-- ============================================================
-- recipes
-- ============================================================
CREATE TABLE recipes__new (
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
  created_at    TEXT DEFAULT (datetime('now')),
  source_type   TEXT NOT NULL DEFAULT 'manual',
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO recipes__new (id, name, category, prep_time, source, url, pinterest_url,
                           servings, equipment_json, notes, times_cooked, last_cooked,
                           rating, created_at, source_type, family_id)
  SELECT id, name, category, prep_time, source, url, pinterest_url,
         servings, equipment_json, notes, times_cooked, last_cooked,
         rating, created_at, source_type, family_id
  FROM recipes;
DROP TABLE recipes;
ALTER TABLE recipes__new RENAME TO recipes;
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
CREATE INDEX IF NOT EXISTS idx_recipes_source_type ON recipes(source_type);
CREATE INDEX IF NOT EXISTS idx_recipes_family ON recipes(family_id);

-- ============================================================
-- recipe_ingredients
-- ============================================================
CREATE TABLE recipe_ingredients__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_key TEXT,
  name        TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit        TEXT NOT NULL,
  optional    INTEGER DEFAULT 0,
  sort_order  INTEGER DEFAULT 0,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO recipe_ingredients__new (id, recipe_id, product_key, name, qty, unit, optional, sort_order, family_id)
  SELECT id, recipe_id, product_key, name, qty, unit, optional, sort_order, family_id
  FROM recipe_ingredients;
DROP TABLE recipe_ingredients;
ALTER TABLE recipe_ingredients__new RENAME TO recipe_ingredients;
CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_product ON recipe_ingredients(product_key);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_family ON recipe_ingredients(family_id);

-- ============================================================
-- chores
-- ============================================================
CREATE TABLE chores__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task        TEXT NOT NULL,
  details     TEXT,
  frequency   TEXT NOT NULL,
  default_day INTEGER,
  icon        TEXT,
  active      INTEGER DEFAULT 1,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO chores__new (id, task, details, frequency, default_day, icon, active, family_id)
  SELECT id, task, details, frequency, default_day, icon, active, family_id
  FROM chores;
DROP TABLE chores;
ALTER TABLE chores__new RENAME TO chores;
CREATE INDEX IF NOT EXISTS idx_chores_family ON chores(family_id);

-- ============================================================
-- chore_schedules
-- ============================================================
CREATE TABLE chore_schedules__new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id      INTEGER NOT NULL REFERENCES chores(id),
  week_year     TEXT NOT NULL,
  scheduled_day INTEGER NOT NULL,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','done','postponed')),
  postponed_to  INTEGER,
  completed_at  TEXT,
  notes         TEXT,
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  UNIQUE(chore_id, week_year)
);
INSERT INTO chore_schedules__new (id, chore_id, week_year, scheduled_day, status, postponed_to, completed_at, notes, family_id)
  SELECT id, chore_id, week_year, scheduled_day, status, postponed_to, completed_at, notes, family_id
  FROM chore_schedules;
DROP TABLE chore_schedules;
ALTER TABLE chore_schedules__new RENAME TO chore_schedules;
CREATE INDEX IF NOT EXISTS idx_chore_sched_week ON chore_schedules(week_year);
CREATE INDEX IF NOT EXISTS idx_chore_sched_status ON chore_schedules(status);
CREATE INDEX IF NOT EXISTS idx_chore_schedules_family ON chore_schedules(family_id);

-- ============================================================
-- consumables
-- ============================================================
CREATE TABLE consumables__new (
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
  updated_at        TEXT DEFAULT (datetime('now')),
  family_id         INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO consumables__new (id, product_key, name, pack_name, category, depletion_model, depletion_rate,
                              depletion_unit, current_qty, unit, pack_size, pack_unit, est_price,
                              reorder_threshold, auto_add, store, notes, last_purchased, purchase_count,
                              updated_at, family_id)
  SELECT id, product_key, name, pack_name, category, depletion_model, depletion_rate,
         depletion_unit, current_qty, unit, pack_size, pack_unit, est_price,
         reorder_threshold, auto_add, store, notes, last_purchased, purchase_count,
         updated_at, family_id
  FROM consumables;
DROP TABLE consumables;
ALTER TABLE consumables__new RENAME TO consumables;
CREATE INDEX IF NOT EXISTS idx_consumables_auto ON consumables(auto_add);
CREATE INDEX IF NOT EXISTS idx_consumables_family ON consumables(family_id);

-- ============================================================
-- consumable_log
-- ============================================================
CREATE TABLE consumable_log__new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id   INTEGER NOT NULL REFERENCES consumables(id),
  qty_used        REAL,
  logged_at       TEXT DEFAULT (datetime('now')),
  context         TEXT,
  family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO consumable_log__new (id, consumable_id, qty_used, logged_at, context, family_id)
  SELECT id, consumable_id, qty_used, logged_at, context, family_id
  FROM consumable_log;
DROP TABLE consumable_log;
ALTER TABLE consumable_log__new RENAME TO consumable_log;
CREATE INDEX IF NOT EXISTS idx_consumable_log_cid ON consumable_log(consumable_id);
CREATE INDEX IF NOT EXISTS idx_consumable_log_time ON consumable_log(logged_at);
CREATE INDEX IF NOT EXISTS idx_consumable_log_family ON consumable_log(family_id);

-- ============================================================
-- audit_log
-- ============================================================
CREATE TABLE audit_log__new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  request_id    TEXT NOT NULL,
  actor         TEXT NOT NULL DEFAULT 'local',
  action        TEXT NOT NULL CHECK (action IN ('DELETE', 'PUT', 'PATCH', 'POST')),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  route         TEXT NOT NULL,
  before_hash   TEXT,
  after_hash    TEXT,
  metadata      TEXT,
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO audit_log__new (id, timestamp, request_id, actor, action, entity_type, entity_id,
                             route, before_hash, after_hash, metadata, family_id)
  SELECT id, timestamp, request_id, actor, action, entity_type, entity_id,
         route, before_hash, after_hash, metadata, family_id
  FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log__new RENAME TO audit_log;
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_family ON audit_log(family_id);

-- ============================================================
-- calendar_events
-- ============================================================
CREATE TABLE calendar_events__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  location    TEXT,
  all_day     INTEGER DEFAULT 0,
  notes       TEXT,
  source      TEXT DEFAULT 'local',
  created_at  TEXT DEFAULT (datetime('now')),
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO calendar_events__new (id, title, date, start_time, end_time, location, all_day, notes,
                                   source, created_at, family_id)
  SELECT id, title, date, start_time, end_time, location, all_day, notes,
         source, created_at, family_id
  FROM calendar_events;
DROP TABLE calendar_events;
ALTER TABLE calendar_events__new RENAME TO calendar_events;
CREATE INDEX IF NOT EXISTS idx_cal_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_family ON calendar_events(family_id);

-- ============================================================
-- inventory_log
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
                  'shopping_bought'
                )),
  source_id     INTEGER,
  source_table  TEXT,
  notes         TEXT,
  logged_at     TEXT NOT NULL DEFAULT (datetime('now')),
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO inventory_log__new (id, product_key, qty_delta, new_qty, unit, reason, source_id,
                                 source_table, notes, logged_at, family_id)
  SELECT id, product_key, qty_delta, new_qty, unit, reason, source_id,
         source_table, notes, logged_at, family_id
  FROM inventory_log;
DROP TABLE inventory_log;
ALTER TABLE inventory_log__new RENAME TO inventory_log;
CREATE INDEX IF NOT EXISTS idx_inv_log_key_time ON inventory_log(product_key, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_log_reason ON inventory_log(reason);
CREATE INDEX IF NOT EXISTS idx_inv_log_source ON inventory_log(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_inventory_log_family ON inventory_log(family_id);
CREATE INDEX IF NOT EXISTS idx_inv_log_family_key_time
  ON inventory_log(family_id, product_key, logged_at DESC);

-- ============================================================
-- knowledge_base
-- ============================================================
CREATE TABLE knowledge_base__new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  user_message  TEXT NOT NULL,
  ai_response   TEXT NOT NULL,
  context_json  TEXT,
  intent        TEXT,
  entities_json TEXT,
  embedding_json TEXT,
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO knowledge_base__new (id, timestamp, user_message, ai_response, context_json, intent,
                                  entities_json, embedding_json, family_id)
  SELECT id, timestamp, user_message, ai_response, context_json, intent,
         entities_json, embedding_json, family_id
  FROM knowledge_base;
DROP TABLE knowledge_base;
ALTER TABLE knowledge_base__new RENAME TO knowledge_base;
CREATE INDEX IF NOT EXISTS idx_kb_timestamp ON knowledge_base(timestamp);
CREATE INDEX IF NOT EXISTS idx_kb_intent ON knowledge_base(intent);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_family ON knowledge_base(family_id);

-- ============================================================
-- llm_audit
-- ============================================================
CREATE TABLE llm_audit__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  tool_name   TEXT NOT NULL,
  arguments   TEXT,
  result      TEXT,
  success     INTEGER DEFAULT 1,
  user_message TEXT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO llm_audit__new (id, timestamp, tool_name, arguments, result, success, user_message, family_id)
  SELECT id, timestamp, tool_name, arguments, result, success, user_message, family_id
  FROM llm_audit;
DROP TABLE llm_audit;
ALTER TABLE llm_audit__new RENAME TO llm_audit;
CREATE INDEX IF NOT EXISTS idx_llm_audit_ts ON llm_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_llm_audit_family ON llm_audit(family_id);

-- ============================================================
-- meal_history
-- ============================================================
CREATE TABLE meal_history__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id),
  cooked_at   TEXT DEFAULT (date('now')),
  rating      REAL,
  leftovers   INTEGER DEFAULT 0,
  notes       TEXT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO meal_history__new (id, recipe_id, cooked_at, rating, leftovers, notes, family_id)
  SELECT id, recipe_id, cooked_at, rating, leftovers, notes, family_id
  FROM meal_history;
DROP TABLE meal_history;
ALTER TABLE meal_history__new RENAME TO meal_history;
CREATE INDEX IF NOT EXISTS idx_meal_history_recipe ON meal_history(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_history_date ON meal_history(cooked_at);
CREATE INDEX IF NOT EXISTS idx_meal_history_family ON meal_history(family_id);

-- ============================================================
-- notifications
-- ============================================================
CREATE TABLE notifications__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  message     TEXT,
  data_json   TEXT,
  read        INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO notifications__new (id, type, message, data_json, read, created_at, family_id)
  SELECT id, type, message, data_json, read, created_at, family_id
  FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications__new RENAME TO notifications;
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_family ON notifications(family_id);

-- ============================================================
-- purchase_log
-- ============================================================
CREATE TABLE purchase_log__new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key   TEXT NOT NULL,
  qty           REAL NOT NULL,
  unit          TEXT,
  price_paid    REAL,
  store         TEXT,
  purchased_at  TEXT DEFAULT (datetime('now')),
  source        TEXT DEFAULT 'manual',
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO purchase_log__new (id, product_key, qty, unit, price_paid, store, purchased_at, source, family_id)
  SELECT id, product_key, qty, unit, price_paid, store, purchased_at, source, family_id
  FROM purchase_log;
DROP TABLE purchase_log;
ALTER TABLE purchase_log__new RENAME TO purchase_log;
CREATE INDEX IF NOT EXISTS idx_purchase_log_key ON purchase_log(product_key);
CREATE INDEX IF NOT EXISTS idx_purchase_log_date ON purchase_log(purchased_at);
CREATE INDEX IF NOT EXISTS idx_purchase_log_key_date ON purchase_log(product_key, purchased_at);
CREATE INDEX IF NOT EXISTS idx_purchase_log_family ON purchase_log(family_id);

-- ============================================================
-- receipt_items
-- ============================================================
CREATE TABLE receipt_items__new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id      INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_text       TEXT NOT NULL,
  product_key     TEXT,
  product_name    TEXT NOT NULL,
  qty             REAL,
  unit            TEXT,
  unit_price      REAL,
  total_price     REAL NOT NULL,
  discount        REAL NOT NULL DEFAULT 0,
  ean             TEXT,
  confidence      REAL NOT NULL DEFAULT 0.5,
  confirmed       INTEGER NOT NULL DEFAULT 0,
  flagged_reason  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  kassal_product_id INTEGER REFERENCES kassal_products(id),
  resolution_candidates_json TEXT,
  family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO receipt_items__new (id, receipt_id, line_text, product_key, product_name, qty, unit,
                                 unit_price, total_price, discount, ean, confidence, confirmed,
                                 flagged_reason, created_at, kassal_product_id,
                                 resolution_candidates_json, family_id)
  SELECT id, receipt_id, line_text, product_key, product_name, qty, unit,
         unit_price, total_price, discount, ean, confidence, confirmed,
         flagged_reason, created_at, kassal_product_id,
         resolution_candidates_json, family_id
  FROM receipt_items;
DROP TABLE receipt_items;
ALTER TABLE receipt_items__new RENAME TO receipt_items;
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_key ON receipt_items(product_key);
CREATE INDEX IF NOT EXISTS idx_receipt_items_confirmed ON receipt_items(confirmed);
CREATE INDEX IF NOT EXISTS idx_receipt_items_kassal ON receipt_items(kassal_product_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_family ON receipt_items(family_id);

-- ============================================================
-- shopping_extras
-- ============================================================
CREATE TABLE shopping_extras__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_year   TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'Tørrvarer & annet',
  quantity    REAL,
  checked     INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO shopping_extras__new (id, week_year, name, category, quantity, checked, created_at, family_id)
  SELECT id, week_year, name, category, quantity, checked, created_at, family_id
  FROM shopping_extras;
DROP TABLE shopping_extras;
ALTER TABLE shopping_extras__new RENAME TO shopping_extras;
CREATE INDEX IF NOT EXISTS idx_shop_extras_week ON shopping_extras(week_year);
CREATE INDEX IF NOT EXISTS idx_shopping_extras_family ON shopping_extras(family_id);

-- ============================================================
-- shopping_list_items
-- ============================================================
CREATE TABLE shopping_list_items__new (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id                    INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  source_type                TEXT NOT NULL CHECK (source_type IN (
                               'meal_ingredient',
                               'consumable',
                               'extra',
                               'manual'
                             )),
  source_ref                 TEXT,
  ingredient_name            TEXT NOT NULL,
  ingredient_name_no         TEXT,
  product_key                TEXT,
  qty                        REAL,
  unit                       TEXT,
  brand_hint                 TEXT,
  category                   TEXT,
  pack_size                  REAL,
  pack_unit                  TEXT,
  pack_count                 INTEGER,
  est_price                  REAL,
  pantry_has                 INTEGER NOT NULL DEFAULT 0,
  pantry_qty                 REAL,
  needs_buy                  INTEGER NOT NULL DEFAULT 1,
  bought_at                  TEXT,
  bought_qty                 REAL,
  kassal_product_id          INTEGER REFERENCES kassal_products(id),
  resolution_id              INTEGER REFERENCES product_resolutions(id),
  resolution_candidates_json TEXT,
  resolution_confidence      REAL,
  resolved_via               TEXT,
  meals_json                 TEXT,
  dairy_note                 TEXT,
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  notes                      TEXT,
  family_id                  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);
INSERT INTO shopping_list_items__new (id, list_id, source_type, source_ref, ingredient_name,
                                       ingredient_name_no, product_key, qty, unit, brand_hint,
                                       category, pack_size, pack_unit, pack_count, est_price,
                                       pantry_has, pantry_qty, needs_buy, bought_at, bought_qty,
                                       kassal_product_id, resolution_id, resolution_candidates_json,
                                       resolution_confidence, resolved_via, meals_json, dairy_note,
                                       sort_order, notes, family_id)
  SELECT id, list_id, source_type, source_ref, ingredient_name,
         ingredient_name_no, product_key, qty, unit, brand_hint,
         category, pack_size, pack_unit, pack_count, est_price,
         pantry_has, pantry_qty, needs_buy, bought_at, bought_qty,
         kassal_product_id, resolution_id, resolution_candidates_json,
         resolution_confidence, resolved_via, meals_json, dairy_note,
         sort_order, notes, family_id
  FROM shopping_list_items;
DROP TABLE shopping_list_items;
ALTER TABLE shopping_list_items__new RENAME TO shopping_list_items;
CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_needs ON shopping_list_items(list_id, needs_buy);
CREATE INDEX IF NOT EXISTS idx_shopping_items_kassal ON shopping_list_items(kassal_product_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_product_key ON shopping_list_items(product_key);
CREATE INDEX IF NOT EXISTS idx_shopping_list_items_family ON shopping_list_items(family_id);

-- ============================================================
-- Lag C M3 — fill in missing family_id indexes on three tables
-- (family_llm_config, family_profile, product_shelf_observations).
-- These are low-volume but missing the index meant family-scoped
-- SELECTs scanned the whole table. Idempotent via IF NOT EXISTS.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_family_llm_config_family ON family_llm_config(family_id);
CREATE INDEX IF NOT EXISTS idx_family_profile_family ON family_profile(family_id);
CREATE INDEX IF NOT EXISTS idx_product_shelf_obs_family
  ON product_shelf_observations(family_id);
