-- Migration 004: Pantry-audit, prisreferanse + historikk, state-snapshots
-- Iterasjon 1 av v1.2 roadmap.
--   * inventory_log       — hvorfor kom varen inn? (manual/receipt/cron/correction)
--   * price_references    — master-data for norske dagligvarer
--   * price_history       — historiske observasjoner per price_ref
--   * state_snapshots     — persistert metrics (for Prometheus-kontinuitet)

-- ============================================================
-- INVENTORY-AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key   TEXT NOT NULL,
  qty_delta     REAL NOT NULL,                -- positivt = tillagt, negativt = forbrukt
  new_qty       REAL NOT NULL,
  unit          TEXT,
  reason        TEXT NOT NULL CHECK (reason IN (
                  'manual', 'receipt', 'cron_depletion',
                  'correction', 'shelf_life_expired', 'initial_seed'
                )),
  source_id     INTEGER,                      -- FK til f.eks. receipts.id når reason='receipt'
  source_table  TEXT,                         -- hvilken tabell source_id peker på
  notes         TEXT,
  logged_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_log_key_time ON inventory_log(product_key, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_log_reason ON inventory_log(reason);
CREATE INDEX IF NOT EXISTS idx_inv_log_source ON inventory_log(source_table, source_id);

-- ============================================================
-- PRIS-REFERANSEDATA
-- ============================================================

CREATE TABLE IF NOT EXISTS price_references (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key     TEXT NOT NULL,              -- matcher products.key der mulig
  product_name    TEXT NOT NULL,
  brand           TEXT,
  category        TEXT,
  pack_size       REAL,
  pack_unit       TEXT,
  ean             TEXT,
  current_price   REAL NOT NULL,
  price_per_unit  REAL,                       -- kr/kg, kr/l, kr/stk — for sammenligning
  currency        TEXT NOT NULL DEFAULT 'NOK',
  store           TEXT,                       -- 'Kiwi', 'Rema', 'Meny', 'Extra', 'Coop', 'Bunnpris', 'gjennomsnitt'
  source          TEXT NOT NULL,              -- 'kassal', 'manual', 'receipt', 'cpi_indexed', 'seed'
  source_url      TEXT,
  confidence      REAL NOT NULL DEFAULT 1.0,  -- 0–1, lavere for CPI-estimerte
  last_verified   TEXT NOT NULL DEFAULT (datetime('now')),
  indexed_from    TEXT,                       -- dato for siste CPI-justering (hvis noen)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_key, store, source)
);

CREATE INDEX IF NOT EXISTS idx_price_ref_key ON price_references(product_key);
CREATE INDEX IF NOT EXISTS idx_price_ref_category ON price_references(category);
CREATE INDEX IF NOT EXISTS idx_price_ref_verified ON price_references(last_verified);
CREATE INDEX IF NOT EXISTS idx_price_ref_ean ON price_references(ean);

-- ============================================================
-- PRIS-HISTORIKK (alle observasjoner for trend-analyse)
-- ============================================================

CREATE TABLE IF NOT EXISTS price_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  price_ref_id  INTEGER NOT NULL REFERENCES price_references(id) ON DELETE CASCADE,
  price         REAL NOT NULL,
  source        TEXT NOT NULL,                -- 'kassal', 'cpi_index', 'receipt', 'manual'
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_hist_ref_time ON price_history(price_ref_id, recorded_at DESC);

-- ============================================================
-- STATE-SNAPSHOTS (metrics-persistering)
-- ============================================================

CREATE TABLE IF NOT EXISTS state_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                  -- 'metrics' (evt. flere senere)
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_state_snap_type_time ON state_snapshots(type, created_at DESC);
