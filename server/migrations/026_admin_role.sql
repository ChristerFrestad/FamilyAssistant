-- Migration 026: admin role on users table
--
-- Sprint 7 / pre-pilot. Adds three columns to support a system-wide admin
-- role that's orthogonal to the family-scoped role hierarchy
-- (owner > adult > child).
--
-- Admin status is bootstrapped two ways:
--   1. APP_ADMIN_EMAIL env-var matches the email of an onboarding user
--      → that user's is_admin flips to 1 + bootstrap_method = 'env'.
--   2. APP_ADMIN_EMAIL is unset → first user to onboard becomes admin
--      with bootstrap_method = 'first_user'.
-- See server/services/admin-bootstrap.service.js for the state machine.
--
-- Multi-tenant policy (AGENTS.md DEL 14):
--   is_admin=true does NOT grant cross-family access. Admins can see
--   system-level settings and aggregated stats, but cannot read or
--   modify other families' private data. The /api/admin/* endpoints
--   that surface this are gated by requireAdmin AND scoped via
--   getFamilyId() exactly like everything else.
--
-- promoted_by_user_id + promoted_at let post-pilot admin transfers stay
-- auditable: who handed admin to whom and when.

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
  CHECK (is_admin IN (0, 1));
ALTER TABLE users ADD COLUMN promoted_by_user_id INTEGER
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN promoted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin)
  WHERE is_admin = 1;
