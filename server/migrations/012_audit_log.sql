-- Migration 012: Audit log for destructive operations
--
-- Uke 2 av ISO/IEC 25010-planen (SBOM-6 + SBOM-7).
-- Append-only log over destruktive API-kall (DELETE, PUT-overskrivinger på
-- sensitive ressurser som family_profile, settings, recipes). Gir grunnlag
-- for non-repudiation (ISO 25010 Security/Accountability).
--
-- Designprinsipper:
-- 1. Append-only på API-nivå. SQL tillater teknisk sett DELETE/UPDATE for
--    admin-vedlikehold, men /api/audit eksponerer kun lesning.
-- 2. before_hash / after_hash er SHA-256 over JSON.stringify av respektive
--    objekter. Hash-format "sha256:<hex>" for fremtidig algorithme-bytte.
-- 3. actor er request-id ved single-user-bruk. Multi-user-støtte kan utvide
--    med en separate actors-tabell uten schema-brudd.
-- 4. entity_type + entity_id lar oss filtrere per ressurs-type uten å skanne
--    hele tabellen. Index på (entity_type, entity_id) og (timestamp).

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  request_id    TEXT NOT NULL,
  actor         TEXT NOT NULL DEFAULT 'local',
  action        TEXT NOT NULL CHECK (action IN ('DELETE', 'PUT', 'PATCH', 'POST')),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  route         TEXT NOT NULL,
  before_hash   TEXT,
  after_hash    TEXT,
  metadata      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
