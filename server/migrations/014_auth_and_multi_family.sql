-- Migration 014: auth, multi-tenancy, and per-family LLM config
--
-- Introduces the user, session, family, invitation and per-family LLM config
-- model. Backfills existing single-tenant data to family_id=1. New tables
-- introduced here use REFERENCES with ON DELETE CASCADE so that when a family
-- is deleted, all their data is purged. Existing tables use ADD COLUMN or a
-- table rebuild depending on whether their PK/UNIQUE constraints need to
-- include family_id.
--
-- After this migration:
--   * Every family-scoped row has family_id NOT NULL.
--   * family_id=1 is the legacy/default family for all existing data.
--   * schema_migrations records version '014'.
--
-- The migration runs inside a single transaction (see migrations/index.js),
-- so any failure rolls everything back.

-- ============================================================
-- SECTION 1: New auth & family tables
-- ============================================================

CREATE TABLE IF NOT EXISTS families (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  owner_user_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  google_sub        TEXT UNIQUE,
  name              TEXT,
  avatar_url        TEXT,
  family_id         INTEGER REFERENCES families(id) ON DELETE SET NULL,
  role              TEXT NOT NULL DEFAULT 'adult'
                      CHECK (role IN ('owner','adult','child')),
  profile_member_id INTEGER REFERENCES family_profile_members(id) ON DELETE SET NULL,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_family ON users(family_id);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS family_invitations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id         INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  token             TEXT NOT NULL UNIQUE,
  assigned_role     TEXT NOT NULL CHECK (assigned_role IN ('adult','child')),
  profile_member_id INTEGER,
  invited_by        INTEGER NOT NULL REFERENCES users(id),
  expires_at        TEXT NOT NULL,
  accepted_at       TEXT,
  accepted_by       INTEGER REFERENCES users(id),
  revoked_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON family_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_family ON family_invitations(family_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON family_invitations(expires_at);

CREATE TABLE IF NOT EXISTS family_profile_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id      INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'adult'
                   CHECK (category IN ('adult','teen','child')),
  portion_factor REAL NOT NULL DEFAULT 1.0
                   CHECK (portion_factor BETWEEN 0.1 AND 3.0),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_family_profile_members_family
  ON family_profile_members(family_id);

CREATE TABLE IF NOT EXISTS family_llm_config (
  family_id         INTEGER PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  backend           TEXT NOT NULL DEFAULT 'ollama'
                      CHECK (backend IN ('anthropic','openai','xai','ollama','llamacpp')),
  model             TEXT,
  base_url          TEXT,
  api_key_encrypted TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_magic_link_email ON magic_link_tokens(email);
CREATE INDEX IF NOT EXISTS idx_magic_link_expires ON magic_link_tokens(expires_at);

-- ============================================================
-- SECTION 2: Seed default family for legacy data
-- ============================================================

INSERT OR IGNORE INTO families (id, name) VALUES (1, 'Default Family');

-- Default LLM config for the legacy family: local Ollama (matches RPi default)
INSERT OR IGNORE INTO family_llm_config (family_id, backend, model)
  VALUES (1, 'ollama', 'qwen2.5:3b');

-- ============================================================
-- SECTION 3: Rebuild family_profile (drop singleton CHECK, add family_id)
-- ============================================================
-- The old table had CHECK (id = 1). New version allows one row per family,
-- keyed by family_id. We bring the existing row across as family_id=1.
-- The legacy `id` column is preserved as a duplicate of family_id so that
-- existing repository code which queries `WHERE id = 1` continues to work
-- during the phase-5 tenant-scoping refactor. Phase 5 will migrate callers
-- to use family_id explicitly; a later migration will then drop `id`.

CREATE TABLE family_profile__new (
  id              INTEGER NOT NULL DEFAULT 1,
  family_id       INTEGER PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  members         TEXT NOT NULL DEFAULT '[]',
  allergies       TEXT NOT NULL DEFAULT '[]',
  dislikes        TEXT NOT NULL DEFAULT '[]',
  preferences     TEXT NOT NULL DEFAULT '{}',
  preferred_chain TEXT,
  secondary_chain TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO family_profile__new
  (id, family_id, members, allergies, dislikes, preferences,
   preferred_chain, secondary_chain, updated_at)
  SELECT 1, 1, members, allergies, dislikes, preferences,
         preferred_chain, secondary_chain, updated_at
    FROM family_profile
   WHERE id = 1;

DROP TABLE family_profile;
ALTER TABLE family_profile__new RENAME TO family_profile;

CREATE UNIQUE INDEX IF NOT EXISTS idx_family_profile_id ON family_profile(id);

-- ============================================================
-- SECTION 4: Rebuild inventory (composite PK with family_id)
-- ============================================================

-- DEFAULT 1 on family_id keeps pre-refactor INSERT statements working; phase-5
-- tenant scoping removes the default in a follow-up migration.
CREATE TABLE inventory__new (
  family_id                 INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  product_key               TEXT NOT NULL,
  qty_remaining             REAL NOT NULL DEFAULT 0,
  unit                      TEXT NOT NULL DEFAULT '',
  last_purchased            TEXT,
  last_pack_size            REAL,
  expires_est               TEXT,
  purchase_count            INTEGER DEFAULT 0,
  avg_days_between_purchase REAL,
  total_size                REAL,
  updated_at                TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (family_id, product_key)
);

INSERT INTO inventory__new
  (family_id, product_key, qty_remaining, unit, last_purchased, last_pack_size,
   expires_est, purchase_count, avg_days_between_purchase, total_size, updated_at)
  SELECT 1, product_key, qty_remaining, unit, last_purchased, last_pack_size,
         expires_est, purchase_count, avg_days_between_purchase, total_size, updated_at
    FROM inventory;

DROP TABLE inventory;
ALTER TABLE inventory__new RENAME TO inventory;

CREATE INDEX IF NOT EXISTS idx_inventory_family ON inventory(family_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expires ON inventory(expires_est);

-- ============================================================
-- SECTION 5: Rebuild meal_plans (composite UNIQUE with family_id)
-- ============================================================

CREATE TABLE meal_plans__new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  week_year   TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_type   TEXT DEFAULT 'middag',
  recipe_id   INTEGER REFERENCES recipes(id),
  status      TEXT DEFAULT 'planned' CHECK (status IN (
                'planned','cooked','skipped','away','removed'
              )),
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(family_id, week_year, day_of_week, meal_type)
);

INSERT INTO meal_plans__new
  (id, family_id, week_year, day_of_week, meal_type, recipe_id, status, notes, created_at)
  SELECT id, 1, week_year, day_of_week, meal_type, recipe_id, status, notes, created_at
    FROM meal_plans;

DROP TABLE meal_plans;
ALTER TABLE meal_plans__new RENAME TO meal_plans;

CREATE INDEX IF NOT EXISTS idx_meal_plans_family ON meal_plans(family_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_week ON meal_plans(family_id, week_year);
CREATE INDEX IF NOT EXISTS idx_meal_plans_recipe ON meal_plans(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON meal_plans(status);

-- ============================================================
-- SECTION 6: Rebuild shopping_lists (partial UNIQUE with family_id)
-- ============================================================

CREATE TABLE shopping_lists__new (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id              INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  week_year              TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                           'draft','active','done','superseded'
                         )),
  generated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at           TEXT,
  enrichment_status      TEXT NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN (
                           'pending','running','done','partial','failed'
                         )),
  enrichment_started_at  TEXT,
  enrichment_finished_at TEXT,
  total_est_price        REAL,
  notes                  TEXT
);

INSERT INTO shopping_lists__new
  (id, family_id, week_year, status, generated_at, confirmed_at,
   enrichment_status, enrichment_started_at, enrichment_finished_at,
   total_est_price, notes)
  SELECT id, 1, week_year, status, generated_at, confirmed_at,
         enrichment_status, enrichment_started_at, enrichment_finished_at,
         total_est_price, notes
    FROM shopping_lists;

DROP TABLE shopping_lists;
ALTER TABLE shopping_lists__new RENAME TO shopping_lists;

CREATE INDEX IF NOT EXISTS idx_shopping_lists_family ON shopping_lists(family_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_week ON shopping_lists(family_id, week_year);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_status ON shopping_lists(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_lists_active_per_week
  ON shopping_lists(family_id, week_year) WHERE status = 'active';

-- ============================================================
-- SECTION 7: Rebuild sunday_drafts (composite PK with family_id)
-- ============================================================

CREATE TABLE sunday_drafts__new (
  family_id    INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  week_year    TEXT NOT NULL,
  meals_json   TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  accepted     INTEGER DEFAULT 0,
  PRIMARY KEY (family_id, week_year)
);

INSERT INTO sunday_drafts__new
  (family_id, week_year, meals_json, generated_at, accepted)
  SELECT 1, week_year, meals_json, generated_at, accepted
    FROM sunday_drafts;

DROP TABLE sunday_drafts;
ALTER TABLE sunday_drafts__new RENAME TO sunday_drafts;

-- ============================================================
-- SECTION 8: Rebuild filter_usage (composite PK with family_id)
-- ============================================================

CREATE TABLE filter_usage__new (
  family_id     INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  filter_id     TEXT NOT NULL,
  enable_count  INTEGER NOT NULL DEFAULT 0,
  disable_count INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (family_id, filter_id)
);

INSERT INTO filter_usage__new
  (family_id, filter_id, enable_count, disable_count, last_used_at)
  SELECT 1, filter_id, enable_count, disable_count, last_used_at
    FROM filter_usage;

DROP TABLE filter_usage;
ALTER TABLE filter_usage__new RENAME TO filter_usage;

CREATE INDEX IF NOT EXISTS idx_filter_usage_last_used ON filter_usage(last_used_at DESC);

-- ============================================================
-- SECTION 9: Rebuild receipts (composite UNIQUE with family_id)
-- ============================================================

CREATE TABLE receipts__new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id       INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  merchant        TEXT,
  purchased_at    TEXT,
  total_nok       REAL,
  currency        TEXT NOT NULL DEFAULT 'NOK',
  raw_text        TEXT,
  llm_model       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending','confirmed','rejected','failed'
                  )),
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at    TEXT,
  UNIQUE(family_id, sha256)
);

INSERT INTO receipts__new
  (id, family_id, file_path, mime_type, file_size_bytes, sha256, merchant,
   purchased_at, total_nok, currency, raw_text, llm_model, status,
   error_message, created_at, confirmed_at)
  SELECT id, 1, file_path, mime_type, file_size_bytes, sha256, merchant,
         purchased_at, total_nok, currency, raw_text, llm_model, status,
         error_message, created_at, confirmed_at
    FROM receipts;

DROP TABLE receipts;
ALTER TABLE receipts__new RENAME TO receipts;

CREATE INDEX IF NOT EXISTS idx_receipts_family ON receipts(family_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(family_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_purchased ON receipts(purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_merchant ON receipts(merchant);

-- ============================================================
-- SECTION 10: Rebuild recipe_sources (composite UNIQUE with family_id)
-- ============================================================

CREATE TABLE recipe_sources__new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id       INTEGER NOT NULL DEFAULT 1 REFERENCES families(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('pinterest','godt','rss','html','unknown')),
  label           TEXT,
  last_sync_at    TEXT,
  last_sync_count INTEGER DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(family_id, url)
);

INSERT INTO recipe_sources__new
  (id, family_id, url, type, label, last_sync_at, last_sync_count, enabled, added_at)
  SELECT id, 1, url, type, label, last_sync_at, last_sync_count, enabled, added_at
    FROM recipe_sources;

DROP TABLE recipe_sources;
ALTER TABLE recipe_sources__new RENAME TO recipe_sources;

CREATE INDEX IF NOT EXISTS idx_recipe_sources_family ON recipe_sources(family_id);
CREATE INDEX IF NOT EXISTS idx_recipe_sources_enabled ON recipe_sources(enabled, last_sync_at);

-- ============================================================
-- SECTION 11: Simple ADD COLUMN for family-scoped tables
-- ============================================================
-- These tables don't have PK/UNIQUE constraints that need family_id
-- composition. NOT NULL DEFAULT 1 backfills existing rows and enforces
-- non-null on future inserts. Foreign key enforcement is deferred to
-- application-level checks (REFERENCES omitted from ADD COLUMN because
-- SQLite requires DEFERRABLE INITIALLY DEFERRED for that case, which we
-- don't need given all rows backfill to the guaranteed-present id=1).

ALTER TABLE inventory_log ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_inventory_log_family ON inventory_log(family_id);
CREATE INDEX IF NOT EXISTS idx_inv_log_family_key_time
  ON inventory_log(family_id, product_key, logged_at DESC);

ALTER TABLE recipes ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_recipes_family ON recipes(family_id);

ALTER TABLE recipe_ingredients ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_family ON recipe_ingredients(family_id);

ALTER TABLE chores ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_chores_family ON chores(family_id);

ALTER TABLE chore_schedules ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_chore_schedules_family ON chore_schedules(family_id);

ALTER TABLE consumables ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_consumables_family ON consumables(family_id);

ALTER TABLE consumable_log ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_consumable_log_family ON consumable_log(family_id);

ALTER TABLE shopping_extras ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_shopping_extras_family ON shopping_extras(family_id);

ALTER TABLE shopping_list_items ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_shopping_list_items_family ON shopping_list_items(family_id);

ALTER TABLE purchase_log ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_purchase_log_family ON purchase_log(family_id);

ALTER TABLE meal_history ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_meal_history_family ON meal_history(family_id);

ALTER TABLE calendar_events ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_calendar_events_family ON calendar_events(family_id);

ALTER TABLE knowledge_base ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_family ON knowledge_base(family_id);

ALTER TABLE notifications ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_notifications_family ON notifications(family_id);

ALTER TABLE llm_audit ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_llm_audit_family ON llm_audit(family_id);

ALTER TABLE receipt_items ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_receipt_items_family ON receipt_items(family_id);

ALTER TABLE audit_log ADD COLUMN family_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_audit_log_family ON audit_log(family_id);
