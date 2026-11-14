-- Global recipe library. No family_id: every family reads the same
-- catalog and copies a row into its own recipes table.
-- Method text (schema.org recipeInstructions) is intentionally absent.

CREATE TABLE IF NOT EXISTS recipe_library (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  source_name     TEXT NOT NULL,
  canonical_url   TEXT NOT NULL UNIQUE,
  image_url       TEXT,
  servings        INTEGER,
  total_time_min  INTEGER,
  category        TEXT,
  fetched_at      TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_recipe_library_source
  ON recipe_library(source_name, active);

CREATE TABLE IF NOT EXISTS recipe_library_ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id  INTEGER NOT NULL REFERENCES recipe_library(id) ON DELETE CASCADE,
  raw_line    TEXT NOT NULL,
  qty         REAL,
  unit        TEXT,
  name        TEXT NOT NULL,
  product_key TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipe_library_ingredients_library
  ON recipe_library_ingredients(library_id);

-- Resumable crawl progress and conditional-request headers.
CREATE TABLE IF NOT EXISTS recipe_library_fetch (
  url            TEXT PRIMARY KEY,
  source_name    TEXT NOT NULL,
  etag           TEXT,
  last_modified  TEXT,
  http_status    INTEGER,
  error          TEXT,
  fetched_at     TEXT NOT NULL
);
