-- Migration 027: app_setup single-row state table
--
-- Records the one-time bootstrap event: which user became the admin and
-- via which mechanism (APP_ADMIN_EMAIL env-var match, or first-user
-- fallback). Single-row pattern (id PRIMARY KEY enforced to 1) so the
-- bootstrap can never run twice.

CREATE TABLE IF NOT EXISTS app_setup (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  admin_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bootstrap_method   TEXT CHECK (bootstrap_method IN ('env', 'first_user')),
  bootstrapped_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
