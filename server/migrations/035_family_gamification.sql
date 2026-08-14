-- Migration 035: per-family gamification settings
--
-- week_goal is the family's target number of chore completions per
-- ISO week. gamification_enabled hides XP/stats UI when 0.
-- Existing families keep the historical defaults (on, goal 5).

ALTER TABLE families ADD COLUMN gamification_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE families ADD COLUMN week_goal INTEGER NOT NULL DEFAULT 5;
