-- Migration 003 (Fase 3 — Ytelse):
--   * llm_cache-tabell for å unngå gjentatte LLM-kall for samme prompt
--   * Ekstra indekser på hyppig WHERE-ede kolonner

-- ============================================================
-- LLM RESPONSE CACHE
-- ============================================================
--
-- Key-strategi: SHA-256(model || '\n' || prompt || '\n' || JSON(contextKeys))
-- Dette lar flere prompts dele cache på tvers av brukere, og garanterer
-- at ulik kontekst ikke returnerer feil svar. Cache er TTL-basert —
-- expires_at settes ved insert, sjekkes ved lookup, ryddes nattlig.
--
-- Nyttig for:
--   * Recipe-forslag på samme spørsmål
--   * Gjentatte chat-hilsninger ("Hei", "Takk", "Hvordan går det?")
--   * Identiske KB-oppsummeringer fra cron-jobber

CREATE TABLE IF NOT EXISTS llm_cache (
  key         TEXT PRIMARY KEY,
  model       TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  response    TEXT NOT NULL,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  last_hit_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_llm_cache_model ON llm_cache(model);

-- ============================================================
-- EKSTRA PERFORMANCE-INDEKSER
-- ============================================================

-- meal_plans lookup i ensureCurrentWeek og swap: (week_year, day_of_week) er allerede UNIQUE
-- men en filterindex på recipe_id gjør JOIN-s-løkker raskere
CREATE INDEX IF NOT EXISTS idx_meal_plans_recipe ON meal_plans(recipe_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_status ON meal_plans(status);

-- consumable_log er append-only, men vi spør ofte per consumable_id for historie
CREATE INDEX IF NOT EXISTS idx_consumable_log_cid ON consumable_log(consumable_id);
CREATE INDEX IF NOT EXISTS idx_consumable_log_time ON consumable_log(logged_at);

-- chore_schedules filter på status i cron og today-ruten
CREATE INDEX IF NOT EXISTS idx_chore_sched_status ON chore_schedules(status);

-- Ikke-lesende purchase_log queries (avg_days_between, last_purchased)
CREATE INDEX IF NOT EXISTS idx_purchase_log_key_date ON purchase_log(product_key, purchased_at);
