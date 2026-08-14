-- Migration 034: calendar integrations + event sync metadata
--
-- Adds Google/iCloud connection rows (tokens encrypted at rest), extra
-- calendar_events columns for external sync, and optional attendees.
-- Secrets live only in *_enc columns and must never be returned by GET.

CREATE TABLE IF NOT EXISTS calendar_integrations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id             INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL CHECK (provider IN ('google', 'icloud')),
  account_email         TEXT NOT NULL,
  calendar_external_id  TEXT,
  calendar_display_name TEXT,
  refresh_token_enc     TEXT,
  app_password_enc      TEXT,
  access_token_enc      TEXT,
  access_token_expires_at TEXT,
  sync_token            TEXT,
  write_enabled         INTEGER NOT NULL DEFAULT 1,
  last_synced_at        TEXT,
  last_error            TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (family_id, provider, account_email)
);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_family_provider
  ON calendar_integrations(family_id, provider);

ALTER TABLE calendar_events ADD COLUMN updated_at TEXT;
ALTER TABLE calendar_events ADD COLUMN external_id TEXT;
ALTER TABLE calendar_events ADD COLUMN etag TEXT;
ALTER TABLE calendar_events ADD COLUMN calendar_external_id TEXT;
ALTER TABLE calendar_events ADD COLUMN rrule TEXT;
ALTER TABLE calendar_events ADD COLUMN kind TEXT;
ALTER TABLE calendar_events ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_events ADD COLUMN created_by_user_id INTEGER;

UPDATE calendar_events
   SET updated_at = COALESCE(updated_at, created_at, datetime('now'))
 WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_family_source_ext
  ON calendar_events(family_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_event_attendees (
  event_id  INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES family_profile_members(id) ON DELETE CASCADE,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, member_id, family_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_attendees_family
  ON calendar_event_attendees(family_id);
