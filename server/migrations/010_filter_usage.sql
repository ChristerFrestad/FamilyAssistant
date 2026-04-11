-- Migration 010: Fase F3 — filter_usage counter
--
-- En rad per filter-id som brukeren har aktivert/deaktivert i UI.
-- Brukes til å vise "Du bruker ofte"-chips etter 3+ økter.
--
-- enable_count og disable_count er separate fordi vi vil vekte
-- "brukt aktivt" høyere enn "slått av". last_used_at brukes til
-- sekundær sortering ved likt antall.

CREATE TABLE IF NOT EXISTS filter_usage (
  filter_id     TEXT PRIMARY KEY,
  enable_count  INTEGER NOT NULL DEFAULT 0,
  disable_count INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_filter_usage_last_used ON filter_usage(last_used_at DESC);
