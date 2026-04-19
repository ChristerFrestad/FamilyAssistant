-- PR A.2 — Shelf-life learning.
--
-- One row per confirmed (purchase, expiry) observation. days_lasted is
-- denormalized so aggregation queries stay index-friendly.
CREATE TABLE IF NOT EXISTS product_shelf_observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id     INTEGER NOT NULL,
  product_key   TEXT    NOT NULL,
  purchased_at  TEXT    NOT NULL,  -- YYYY-MM-DD
  expires_at    TEXT    NOT NULL,  -- YYYY-MM-DD
  days_lasted   INTEGER NOT NULL,
  observed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  source        TEXT    NOT NULL CHECK (source IN ('shopping_bought', 'pantry_edit', 'pantry_add'))
);

CREATE INDEX IF NOT EXISTS idx_shelf_obs_family_product
  ON product_shelf_observations(family_id, product_key, observed_at DESC);

-- Learned shelf-life on the products row. Global in this iteration
-- (products is not yet family-scoped). Nullable so consumers fall back
-- to the seeded products.shelf_days until we have enough samples.
ALTER TABLE products ADD COLUMN shelf_days_learned INTEGER;
ALTER TABLE products ADD COLUMN shelf_days_sample_count INTEGER NOT NULL DEFAULT 0;
