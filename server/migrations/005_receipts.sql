-- Migration 005: Kvittering-ingest
-- Iterasjon 2 av v1.2 roadmap.
--
-- Flyt:
--   1. Bruker laster opp bilde/PDF → lagres som fil på disk, metadata i 'receipts'
--   2. OCR eller vision-LLM trekker ut tekst, service-lag strukturerer til linjer
--   3. Linjene lagres som 'receipt_items' med status='pending'
--   4. Review-UI lar bruker rette opp, markerer confirmed=1 → inventory oppdateres
--
-- Designnotater:
--   * Vi lagrer BÅDE rå OCR-tekst og parsed JSON slik at vi kan re-parse senere
--     hvis LLM-modellen forbedres.
--   * merchant er fri-tekst ('Kiwi', 'Rema 1000', ...)
--   * total_nok er det brukeren betalte inkl. rabatt, brukes for sanity-check
--     mot summen av linjene
--   * receipt_items.product_key settes av LLM-matching; ukjent → NULL til
--     bruker godkjenner i review

CREATE TABLE IF NOT EXISTS receipts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL,                  -- absolute path på disk (data/receipts/…)
  mime_type       TEXT NOT NULL,                  -- image/jpeg, image/png, application/pdf
  file_size_bytes INTEGER NOT NULL,
  sha256          TEXT NOT NULL,                  -- idempotens: samme fil to ganger = samme receipt
  merchant        TEXT,                           -- 'Kiwi', 'Rema 1000', …
  purchased_at    TEXT,                           -- ISO-dato fra kvittering (kan være NULL ved OCR-feil)
  total_nok       REAL,
  currency        TEXT NOT NULL DEFAULT 'NOK',
  raw_text        TEXT,                           -- hele OCR-outputet for audit/replay
  llm_model       TEXT,                           -- hvilken modell som parset
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending',       -- OCR/LLM er ferdig, venter på review
                    'confirmed',     -- bruker har godkjent, inventory oppdatert
                    'rejected',      -- bruker forkastet (gjentatt/ugyldig)
                    'failed'         -- OCR eller LLM feilet — raw_text kan være tom
                  )),
  error_message   TEXT,                           -- diagnostikk ved 'failed'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at    TEXT,
  UNIQUE(sha256)
);

CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_purchased ON receipts(purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_merchant ON receipts(merchant);

CREATE TABLE IF NOT EXISTS receipt_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id      INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_text       TEXT NOT NULL,                  -- original linje fra OCR
  product_key     TEXT,                           -- matchet mot products.key (nullable)
  product_name    TEXT NOT NULL,                  -- LLM-navn (eller raw hvis ingen parse)
  qty             REAL,                           -- mengde fra kvittering
  unit            TEXT,                           -- 'stk', 'kg', 'l', …
  unit_price      REAL,                           -- kr per enhet hvis oppgitt
  total_price     REAL NOT NULL,                  -- betalt for denne linjen
  discount        REAL NOT NULL DEFAULT 0,
  ean             TEXT,
  confidence      REAL NOT NULL DEFAULT 0.5,      -- 0–1, LLM-parse-confidence
  confirmed       INTEGER NOT NULL DEFAULT 0,     -- 0/1 — brukt ved review-save
  flagged_reason  TEXT,                           -- 'price_mismatch', 'unknown_product', …
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_key ON receipt_items(product_key);
CREATE INDEX IF NOT EXISTS idx_receipt_items_confirmed ON receipt_items(confirmed);
