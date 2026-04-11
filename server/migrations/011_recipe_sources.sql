-- Migration 011: Fase F7 — recipe sources + recipes.source_type
--
-- 1. Legg til recipes.source_type TEXT DEFAULT 'manual'
--    MERKNAD: Vi bruker source_type fordi recipes.source allerede finnes
--    fra migrasjon 001 og brukes for fritt tekst "hvor kom oppskriften
--    fra" (f.eks. "mormor", "Pinterest"). source_type er en enum-kolonne
--    for F7-filtrering: 'manual' | 'ai' | 'imported'.
--
--    Eksisterende rader får 'manual'. Nye AI-genererte oppskrifter
--    setter 'ai', importerte fra Pinterest/Godt/RSS setter 'imported'.
--
-- 2. Ny tabell recipe_sources — brukers egne kilder
--    (Pinterest-boards, godt.no-profiler, RSS-feeds, HTML-sider).
--    Synkes av cron-jobben hver 6. time og via manuell trigger.

-- Legg til source_type-kolonne på recipes
ALTER TABLE recipes ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_recipes_source_type ON recipes(source_type);

-- Ny tabell for brukers egne kilder
CREATE TABLE IF NOT EXISTS recipe_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('pinterest', 'godt', 'rss', 'html', 'unknown')),
  label         TEXT,
  last_sync_at  TEXT,
  last_sync_count INTEGER DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  added_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_sources_enabled ON recipe_sources(enabled, last_sync_at);
