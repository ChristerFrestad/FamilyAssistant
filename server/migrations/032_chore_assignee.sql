-- Migration 032: family chore catalog fields (assignee + interval)
--
-- Adds optional per-chore assignee (profile member) and interval_days
-- for custom cadences. Index supports the adult catalog list filter
-- (family + active + default day).
--
-- SQLite ADD COLUMN with REFERENCES is accepted; existing rows stay NULL
-- and the FK is not backfilled.

ALTER TABLE chores ADD COLUMN assignee_member_id INTEGER REFERENCES family_profile_members(id) ON DELETE SET NULL;
ALTER TABLE chores ADD COLUMN interval_days INTEGER;
CREATE INDEX IF NOT EXISTS idx_chores_family_active_day ON chores(family_id, active, default_day);
