-- Migration 006: Produkt-resolution via Kassal.app
-- Iterasjon 3a av v1.2 roadmap.
--
-- Hovedtanke: Kassal.app er ikke primært en prisoracle — den er en
-- resolver som forvandler uklar LLM-tekst ("First Price kjøttdeig 14% 400g")
-- til en stabil SKU-identitet. Hver gang familien faktisk berører et
-- produkt (kvittering, pantry, måltidsvalg), fanger vi den konkrete
-- SKU-en og bygger en familie-spesifikk produktkatalog.
--
-- Designnotater:
--   * kassal_products er IKKE en cache — det er en katalog over SKUer
--     familien faktisk har berørt. Rader vokser kun ved reell aktivitet.
--     raw_json bevares for re-parse ved schema-endringer i Kassal.
--   * product_resolutions er mange-til-mange: én product_key kan legitimt
--     peke på flere kassal_products (First Price 400g + Gilde 400g).
--     times_confirmed gir naturlig vekt — brand-preferanse uten egen tabell.
--   * kassal_cache er kun HTTP-request-cache for søk som ennå ikke er
--     forankret i kassal_products. Snever TTL.
--   * receipt_items får to nye nullable kolonner — eksisterende rader og
--     all iterasjon-2-kode fortsetter uendret (verifisert: INSERT bruker
--     eksplisitt kolonneliste, SELECT bruker eksplisitt aliased liste).

-- ============================================================
-- KASSAL PRODUCTS — SKU-katalog (kun for produkter familien har berørt)
-- ============================================================

CREATE TABLE IF NOT EXISTS kassal_products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  kassal_id           TEXT NOT NULL UNIQUE,          -- Kassal sin id (string for fremtidssikring)
  ean                 TEXT,                           -- stabile identifikatoren — INDEXED
  name                TEXT NOT NULL,
  brand               TEXT,
  vendor              TEXT,                           -- leverandør/produsent
  category            TEXT,
  pack_size           REAL,
  pack_unit           TEXT,                           -- 'g', 'kg', 'l', 'ml', 'stk'
  image_url           TEXT,
  last_seen_price     REAL,                           -- siste pris vi observerte (fra cache eller receipt)
  last_seen_store     TEXT,                           -- 'Kiwi', 'Rema', …
  last_seen_at        TEXT,                           -- ISO-tid for siste pris-oppdatering
  raw_json            TEXT,                           -- full Kassal-payload (for re-parse)
  first_captured_at   TEXT NOT NULL DEFAULT (datetime('now')),
  capture_source      TEXT NOT NULL CHECK (capture_source IN (
                        'receipt',       -- fanget under kvittering-upload
                        'meal_plan',     -- fanget ved søndagsplan-aksept
                        'manual_add',    -- fanget ved manuell pantry-add
                        'lookup',        -- fanget ved eksplisitt lookup (test/debug)
                        'bootstrap'      -- fanget ved initial seed (migrasjon/manuell)
                      )),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kassal_products_ean ON kassal_products(ean);
CREATE INDEX IF NOT EXISTS idx_kassal_products_name ON kassal_products(name);
CREATE INDEX IF NOT EXISTS idx_kassal_products_brand ON kassal_products(brand);
CREATE INDEX IF NOT EXISTS idx_kassal_products_kassal_id ON kassal_products(kassal_id);

-- ============================================================
-- PRODUCT RESOLUTIONS — mange-til-mange mellom product_key og SKU
-- ============================================================

CREATE TABLE IF NOT EXISTS product_resolutions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_key         TEXT,                           -- nullable! nye SKUer trenger ikke products.key
  kassal_product_id   INTEGER NOT NULL REFERENCES kassal_products(id) ON DELETE CASCADE,
  resolved_via        TEXT NOT NULL CHECK (resolved_via IN (
                        'ean',           -- direkte EAN-treff, høyest confidence
                        'llm_name',      -- navn-basert søk + scoring
                        'user_pick',     -- bruker valgte eksplisitt i UI
                        'brand_learn',   -- lært fra tidligere confirmed valg
                        'manual'         -- manuell DB-operasjon
                      )),
  confidence          REAL NOT NULL DEFAULT 0.5,      -- 0–1 fra resolver
  times_confirmed     INTEGER NOT NULL DEFAULT 0,     -- øker ved confirmReceipt
  times_seen          INTEGER NOT NULL DEFAULT 0,     -- øker ved upload (pre-confirm)
  last_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_confirmed_at   TEXT,
  user_locked         INTEGER NOT NULL DEFAULT 0,     -- 1 = bruker har eksplisitt valgt, ikke overstyr
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_key, kassal_product_id)
);

CREATE INDEX IF NOT EXISTS idx_resolutions_product_key ON product_resolutions(product_key);
CREATE INDEX IF NOT EXISTS idx_resolutions_kassal ON product_resolutions(kassal_product_id);
CREATE INDEX IF NOT EXISTS idx_resolutions_confirmed ON product_resolutions(times_confirmed DESC);

-- ============================================================
-- KASSAL CACHE — kun HTTP-request-cache
-- ============================================================

CREATE TABLE IF NOT EXISTS kassal_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key       TEXT NOT NULL UNIQUE,               -- 'search:kjottdeig' | 'ean:7038010012341' | 'id:54321'
  endpoint        TEXT NOT NULL CHECK (endpoint IN ('search','ean','id')),
  response_json   TEXT NOT NULL,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,                      -- TTL: search=24t, ean=7d, id=30d
  hit_count       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kassal_cache_expires ON kassal_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_kassal_cache_endpoint ON kassal_cache(endpoint);

-- ============================================================
-- RECEIPT_ITEMS utvidelse — to nullable kolonner
-- ============================================================
-- Eksisterende INSERT/SELECT bruker eksplisitt kolonneliste, så disse
-- er usynlige for iterasjon-2-kode. Fylles i fase 3b av processUpload.

ALTER TABLE receipt_items ADD COLUMN kassal_product_id INTEGER REFERENCES kassal_products(id);
ALTER TABLE receipt_items ADD COLUMN resolution_candidates_json TEXT;

CREATE INDEX IF NOT EXISTS idx_receipt_items_kassal ON receipt_items(kassal_product_id);
