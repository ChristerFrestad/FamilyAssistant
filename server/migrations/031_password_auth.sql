-- Migration 031: password auth + progressive email verification
--
-- Adds username/password login alongside magic-link, with a grace period
-- before email verification becomes mandatory. See:
--   docs/analyses/2026-08-07-password-auth-parallel.md
--
-- Reversal: DROP COLUMN is supported on SQLite ≥ 3.35; otherwise rebuild
-- the users / magic_link_tokens tables. Safe to leave columns in place
-- if rolling back application code only (nullable / defaulted).

-- ------------------------------------------------------------
-- users: credential columns
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN password_reset_required INTEGER NOT NULL DEFAULT 0
  CHECK (password_reset_required IN (0, 1));

-- Partial unique index: multiple NULL usernames (magic-link-only users)
-- are allowed; non-null usernames must be unique case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users(username COLLATE NOCASE)
  WHERE username IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------
-- magic_link_tokens: purpose + optional owning user
-- ------------------------------------------------------------
-- purpose:
--   login              — classic passwordless sign-in (default)
--   email_verify       — prove ownership of email (during grace)
--   email_verify_reset — prove email + force password reset (post-grace)
ALTER TABLE magic_link_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE magic_link_tokens ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_magic_link_user
  ON magic_link_tokens(user_id)
  WHERE user_id IS NOT NULL;
