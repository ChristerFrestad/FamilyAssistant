-- Migration 025: pilot_password_attempts audit table
--
-- Background: pilot deploy (13-17 May 2026) is gated by a shared password
-- before the regular magic-link auth. Each attempt is logged for incident
-- review (was someone brute-forcing? did the rate-limit work?). The table
-- is small and auto-prunes old rows (>30 days) via the cleanup cron.
--
-- This is NOT a frozen-auth-stage table — pilot password is a temporary
-- pre-auth gate, removed when PILOT_MODE=false post-pilot. The table can
-- remain (small footprint) or be dropped in a post-pilot cleanup PR.

CREATE TABLE IF NOT EXISTS pilot_password_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address    TEXT NOT NULL,
  attempted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  success       INTEGER NOT NULL CHECK (success IN (0, 1)),
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_pilot_pw_attempts_ip_time
  ON pilot_password_attempts(ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_pilot_pw_attempts_time
  ON pilot_password_attempts(attempted_at);
