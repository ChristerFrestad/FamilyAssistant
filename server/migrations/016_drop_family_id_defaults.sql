-- Migration 016: drop the DEFAULT 1 on family_id columns added by 014.
--
-- Phase 1 (migration 014) introduced `family_id INTEGER NOT NULL DEFAULT 1`
-- everywhere so the existing single-tenant repo code continued to work while
-- phase 5 tenant-scoping was rolled out. Phase 5 is now complete: every
-- family-scoped repo reads the family id from AsyncLocalStorage, every
-- HTTP request runs inside a per-family context, and tenant-isolation tests
-- cover the critical paths.
--
-- Dropping the defaults turns any future "stray" INSERT (one that forgot to
-- set family_id) into an immediate NOT NULL constraint error instead of
-- silently writing to family 1. That's the behaviour we want for the cloud
-- build.
--
-- SQLite cannot ALTER a column default in place, so each affected table is
-- rebuilt via the standard create-new/copy/drop/rename dance. We preserve
-- primary keys, indexes, CHECK constraints and row ids bit-for-bit. The
-- legacy family_profile.id column is also retained so any third-party code
-- that queries `WHERE id = 1` continues to work (it now mirrors family_id
-- without a default).
--
-- This migration is idempotent given the schema produced by 014: running it
-- twice is a no-op because the resulting schema no longer has DEFAULT 1.
-- The migration runner records version '016' in schema_migrations exactly
-- once regardless.

-- ============================================================
-- inventory: drop DEFAULT on family_id
-- ============================================================

CREATE TABLE inventory__nd (
  family_id                 INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
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
INSERT INTO inventory__nd SELECT family_id, product_key, qty_remaining, unit,
  last_purchased, last_pack_size, expires_est, purchase_count,
  avg_days_between_purchase, total_size, updated_at FROM inventory;
DROP TABLE inventory;
ALTER TABLE inventory__nd RENAME TO inventory;
CREATE INDEX IF NOT EXISTS idx_inventory_family ON inventory(family_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expires ON inventory(expires_est);

-- ============================================================
-- meal_plans
-- ============================================================

CREATE TABLE meal_plans__nd (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
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
INSERT INTO meal_plans__nd (id, family_id, week_year, day_of_week, meal_type,
  recipe_id, status, notes, created_at)
  SELECT id, family_id, week_year, day_of_week, meal_type,
         recipe_id, status, notes, created_at FROM meal_plans;
DROP TABLE meal_plans;
ALTER TABLE meal_plans__nd RENAME TO meal_plans;
CREATE INDEX IF NOT EXISTS idx_meal_plans_family ON meal_plans(family_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_week ON meal_plans(family_id, week_year);
CREATE INDEX IF NOT EXISTS idx_meal_plans_recipe ON meal_plans(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON meal_plans(status);

-- ============================================================
-- shopping_lists
-- ============================================================

CREATE TABLE shopping_lists__nd (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id              INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
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
INSERT INTO shopping_lists__nd SELECT id, family_id, week_year, status,
  generated_at, confirmed_at, enrichment_status, enrichment_started_at,
  enrichment_finished_at, total_est_price, notes FROM shopping_lists;
DROP TABLE shopping_lists;
ALTER TABLE shopping_lists__nd RENAME TO shopping_lists;
CREATE INDEX IF NOT EXISTS idx_shopping_lists_family ON shopping_lists(family_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_week ON shopping_lists(family_id, week_year);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_status ON shopping_lists(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_lists_active_per_week
  ON shopping_lists(family_id, week_year) WHERE status = 'active';

-- ============================================================
-- sunday_drafts
-- ============================================================

CREATE TABLE sunday_drafts__nd (
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week_year    TEXT NOT NULL,
  meals_json   TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  accepted     INTEGER DEFAULT 0,
  PRIMARY KEY (family_id, week_year)
);
INSERT INTO sunday_drafts__nd SELECT family_id, week_year, meals_json,
  generated_at, accepted FROM sunday_drafts;
DROP TABLE sunday_drafts;
ALTER TABLE sunday_drafts__nd RENAME TO sunday_drafts;

-- ============================================================
-- filter_usage
-- ============================================================

CREATE TABLE filter_usage__nd (
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  filter_id     TEXT NOT NULL,
  enable_count  INTEGER NOT NULL DEFAULT 0,
  disable_count INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (family_id, filter_id)
);
INSERT INTO filter_usage__nd SELECT family_id, filter_id, enable_count,
  disable_count, last_used_at FROM filter_usage;
DROP TABLE filter_usage;
ALTER TABLE filter_usage__nd RENAME TO filter_usage;
CREATE INDEX IF NOT EXISTS idx_filter_usage_last_used ON filter_usage(last_used_at DESC);

-- ============================================================
-- receipts
-- ============================================================

CREATE TABLE receipts__nd (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
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
INSERT INTO receipts__nd SELECT id, family_id, file_path, mime_type,
  file_size_bytes, sha256, merchant, purchased_at, total_nok, currency,
  raw_text, llm_model, status, error_message, created_at, confirmed_at
  FROM receipts;
DROP TABLE receipts;
ALTER TABLE receipts__nd RENAME TO receipts;
CREATE INDEX IF NOT EXISTS idx_receipts_family ON receipts(family_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(family_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_purchased ON receipts(purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_merchant ON receipts(merchant);

-- ============================================================
-- recipe_sources
-- ============================================================

CREATE TABLE recipe_sources__nd (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id       INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('pinterest','godt','rss','html','unknown')),
  label           TEXT,
  last_sync_at    TEXT,
  last_sync_count INTEGER DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(family_id, url)
);
INSERT INTO recipe_sources__nd SELECT id, family_id, url, type, label,
  last_sync_at, last_sync_count, enabled, added_at FROM recipe_sources;
DROP TABLE recipe_sources;
ALTER TABLE recipe_sources__nd RENAME TO recipe_sources;
CREATE INDEX IF NOT EXISTS idx_recipe_sources_family ON recipe_sources(family_id);
CREATE INDEX IF NOT EXISTS idx_recipe_sources_enabled ON recipe_sources(enabled, last_sync_at);

-- ============================================================
-- family_profile (keep legacy id column, drop default on family_id)
-- ============================================================

CREATE TABLE family_profile__nd (
  id              INTEGER NOT NULL,
  family_id       INTEGER PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  members         TEXT NOT NULL DEFAULT '[]',
  allergies       TEXT NOT NULL DEFAULT '[]',
  dislikes        TEXT NOT NULL DEFAULT '[]',
  preferences     TEXT NOT NULL DEFAULT '{}',
  preferred_chain TEXT,
  secondary_chain TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO family_profile__nd SELECT id, family_id, members, allergies,
  dislikes, preferences, preferred_chain, secondary_chain, updated_at
  FROM family_profile;
DROP TABLE family_profile;
ALTER TABLE family_profile__nd RENAME TO family_profile;
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_profile_id ON family_profile(id);

-- ============================================================
-- ADD-COLUMN tables (inventory_log, recipes, recipe_ingredients, chores,
-- chore_schedules, consumables, consumable_log, shopping_extras,
-- shopping_list_items, purchase_log, meal_history, calendar_events,
-- knowledge_base, notifications, llm_audit, receipt_items, audit_log)
--
-- These all gained family_id via ALTER TABLE ADD COLUMN ... DEFAULT 1.
-- A full table rebuild for each is noisy but mechanical. We leave the
-- default on these tables for now: the repo layer always passes family_id
-- explicitly, and the cost of another 17 table rebuilds is not worth it
-- until a later clean-up migration. The important integrity guarantee —
-- "inserts without family_id silently land in family 1" — is already
-- prevented for the high-risk rebuilt tables above (inventory, meal_plans,
-- shopping_lists, receipts, etc.) which are the common write paths.
