-- One secret iCal link per family. The secret is stored as sha256.
-- Regenerating replaces the hash. Revoking sets revoked_at.
-- Existing meals, chores and events are not changed.

CREATE TABLE IF NOT EXISTS calendar_feeds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL UNIQUE REFERENCES families(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_feeds_hash ON calendar_feeds(secret_hash);
