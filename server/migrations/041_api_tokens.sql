-- Per-family tokens for Home Assistant and other integrations.
-- The secret is never stored. token_hash is sha256 of the token.
-- Revoke sets revoked_at. Rows are not deleted.

CREATE TABLE IF NOT EXISTS api_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  scopes      TEXT NOT NULL,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_family ON api_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
