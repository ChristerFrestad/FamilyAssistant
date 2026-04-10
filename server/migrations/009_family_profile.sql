-- Migration 009: Fase F3 — family_profile
--
-- Singleton-rad med medlemmer, allergier, mislikte ingredienser
-- og preferanser (rask/tradisjonell/etc). Brukes av cold-start-
-- anbefalinger i filterknappene (intro-stripen) og av LLM-prompts.
--
-- JSON-felter lagres som TEXT for kompatibilitet mellom better-sqlite3
-- og sql.js (ingen JSON1-modul i pure JS-fallback).

CREATE TABLE IF NOT EXISTS family_profile (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  members     TEXT NOT NULL DEFAULT '[]',       -- JSON array av strenger
  allergies   TEXT NOT NULL DEFAULT '[]',       -- JSON array
  dislikes    TEXT NOT NULL DEFAULT '[]',       -- JSON array
  preferences TEXT NOT NULL DEFAULT '{}',       -- JSON objekt
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Opprett singleton-raden hvis ikke finnes
INSERT OR IGNORE INTO family_profile (id, members, allergies, dislikes, preferences)
VALUES (1, '[]', '[]', '[]', '{}');
