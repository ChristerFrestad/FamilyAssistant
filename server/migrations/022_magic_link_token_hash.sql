-- Migration 022: hash magic-link tokens at rest (defense-in-depth)
--
-- Background. Sprint 3 (Fase 1e Auth-flyt) hardens the magic-link
-- flow before pilot-launch. The previous schema stored the raw
-- token as the table primary key, which means anyone with read
-- access to the database file could replay any unused token before
-- it expired (15 minutes) — a non-zero risk on deploys with weaker
-- physical security than Christer's pilot RPi5. Hashing the token
-- at rest closes that window.
--
-- Design:
--   * The token sent by email stays a 256-bit random string the
--     client (= the user's browser) sees as a query-param. Only the
--     SHA-256 hash of that token is stored server-side. Hash is
--     deterministic so the verify-handler can hash an incoming
--     token and look it up the same way.
--   * Column is renamed `token` -> `token_hash` to make the storage
--     contract explicit. SQLite ≥ 3.25 supports `ALTER TABLE …
--     RENAME COLUMN`; better-sqlite3 12.x ships with SQLite ≥ 3.49.
--   * Existing rows from before Sprint 3 — if any survived the
--     normal 15-minute TTL — would be unusable after this migration
--     (their plain-text PK no longer matches the hash lookup). We
--     therefore truncate the table as part of the migration. The
--     side effect is that any in-flight magic-link emails sent
--     immediately before the deploy stop working; the worst case
--     is the user re-requesting the link.
--
-- Reversibility note: rolling back to the plain-text scheme would
-- require re-renaming the column AND re-issuing every active magic
-- link, since hashes can't be reversed. The simpler rollback is to
-- treat it as "all users must request a new link" — same outcome
-- as forward migration's truncate.

DELETE FROM magic_link_tokens;
ALTER TABLE magic_link_tokens RENAME COLUMN token TO token_hash;

-- The two existing indexes were already on email and expires_at;
-- they don't reference the column we just renamed. No index work
-- is needed.
