-- Migration 023: tighten portion_factor range to 0.1-2.0 and add to users
--
-- Migration 014 originally set CHECK (portion_factor BETWEEN 0.1 AND 3.0)
-- on family_profile_members. 3.0 implies one person eating ~1.5 kg per
-- meal which is unrealistic for any household member. Realistic per-person
-- range is 0.2 (toddler) -- 1.8 (storspiser); 2.0 leaves headroom without
-- inviting nonsense values that would confuse downstream recipe-scaling.
--
-- This migration also adds users.portion_factor so the atomic onboarding
-- handler can persist the slider value the user picks for themselves in
-- the same transaction that creates the family + member row. Without the
-- column the slider value was silently dropped between Step 2 submit and
-- the Sprint 4 per-member edit screen.
--
-- Pre-flight check (verified manually before commit):
--   SELECT COUNT(*) FROM family_profile_members WHERE portion_factor > 2.0;
--   -> 0 rows in dev-DB. No data loss on tightening.
--
-- Portainer-risk: LOW.
--   * users.portion_factor: ADD COLUMN with DEFAULT backfills all rows.
--   * family_profile_members rebuild: standard SQLite "create new, copy,
--     drop old, rename" pattern (https://sqlite.org/lang_altertable.html).
--     IDs are preserved so users.profile_member_id FK references survive.
--     Indexes on the table are recreated after rename.
--
-- Reversal: a follow-up migration can ALTER TABLE users DROP COLUMN
-- portion_factor (SQLite 3.35+) and rebuild family_profile_members back
-- to the 0.1-3.0 CHECK. Both reversible.

-- ============================================================
-- 1. users.portion_factor
-- ============================================================

ALTER TABLE users ADD COLUMN portion_factor REAL NOT NULL DEFAULT 1.0
                  CHECK (portion_factor BETWEEN 0.1 AND 2.0);

-- ============================================================
-- 2. Rebuild family_profile_members with tightened CHECK
-- ============================================================
--
-- SQLite cannot ALTER an existing CHECK constraint, so we follow the
-- recommended rebuild pattern. All twelve columns from migrations 014
-- (id, family_id, name, category, portion_factor, sort_order, created_at,
-- updated_at) and 020 (allergies, dislikes, diet_tags, custom_diet_note)
-- are re-declared identically except for the tightened CHECK on
-- portion_factor.

CREATE TABLE family_profile_members__new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id        INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'adult'
                     CHECK (category IN ('adult','teen','child')),
  portion_factor   REAL NOT NULL DEFAULT 1.0
                     CHECK (portion_factor BETWEEN 0.1 AND 2.0),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  allergies        TEXT DEFAULT NULL,
  dislikes         TEXT DEFAULT NULL,
  diet_tags        TEXT NOT NULL DEFAULT '[]',
  custom_diet_note TEXT DEFAULT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO family_profile_members__new
  (id, family_id, name, category, portion_factor, sort_order,
   allergies, dislikes, diet_tags, custom_diet_note,
   created_at, updated_at)
  SELECT id, family_id, name, category, portion_factor, sort_order,
         allergies, dislikes, diet_tags, custom_diet_note,
         created_at, updated_at
    FROM family_profile_members;

DROP TABLE family_profile_members;
ALTER TABLE family_profile_members__new RENAME TO family_profile_members;

CREATE INDEX IF NOT EXISTS idx_family_profile_members_family
  ON family_profile_members(family_id);
