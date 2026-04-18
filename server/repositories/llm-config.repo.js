// Per-family LLM configuration.
//
// Row shape:
//   family_id         INTEGER PRIMARY KEY
//   backend           TEXT enum ('anthropic','openai','xai','ollama','llamacpp')
//   model             TEXT | NULL
//   base_url          TEXT | NULL   — only used for ollama/llamacpp
//   api_key_encrypted TEXT | NULL   — AES-256-GCM base64 ciphertext
//
// The repo never exposes the decrypted key through a read method. Callers
// who need to actually issue an LLM request must go through
// server/llm/per-family.js which decrypts on demand and produces a client
// bound to the current request.
//
// Encryption is handled by server/auth/crypto.js using the ENCRYPTION_KEY
// env var. Rotating that env breaks all stored keys; the ciphertext can
// then only be re-encrypted by a deliberate rotation script.

const { encrypt } = require('../auth/crypto');

const SUPPORTED_BACKENDS = ['anthropic', 'openai', 'xai', 'ollama', 'llamacpp'];

function createLlmConfigRepo(db) {
  const upsertStmt = db.prepare(
    `INSERT INTO family_llm_config
       (family_id, backend, model, base_url, api_key_encrypted, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(family_id) DO UPDATE SET
       backend = excluded.backend,
       model = excluded.model,
       base_url = excluded.base_url,
       api_key_encrypted = COALESCE(excluded.api_key_encrypted, api_key_encrypted),
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`
  );
  const clearKeyStmt = db.prepare(
    `UPDATE family_llm_config
        SET api_key_encrypted = NULL,
            updated_at = datetime('now'),
            updated_by = ?
      WHERE family_id = ?`
  );
  const findStmt = db.prepare('SELECT * FROM family_llm_config WHERE family_id = ?');

  function getForFamily(familyId) {
    if (!Number.isInteger(familyId) || familyId <= 0) return null;
    return findStmt.get(familyId) || null;
  }

  // Returns the row with the api_key_encrypted stripped — safe for HTTP.
  function getForFamilyPublic(familyId) {
    const row = getForFamily(familyId);
    if (!row) return null;
    return {
      familyId: row.family_id,
      backend: row.backend,
      model: row.model || null,
      baseUrl: row.base_url || null,
      hasKey: !!row.api_key_encrypted,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || null,
    };
  }

  function upsert(familyId, { backend, model = null, baseUrl = null, apiKey, updatedBy }) {
    if (!Number.isInteger(familyId) || familyId <= 0) {
      throw new Error('upsert: familyId must be a positive integer');
    }
    if (!SUPPORTED_BACKENDS.includes(backend)) {
      throw new Error(`upsert: unsupported backend ${backend}`);
    }
    // apiKey === undefined  → keep existing ciphertext (COALESCE in SQL)
    // apiKey === ''         → clear the key (explicit UPDATE below)
    // apiKey === 'xxxxxx'   → encrypt + overwrite
    let encrypted = null;
    let keyExplicitlyCleared = false;
    if (apiKey === '') {
      keyExplicitlyCleared = true;
    } else if (apiKey !== undefined && apiKey !== null) {
      encrypted = encrypt(String(apiKey));
    }
    // undefined/null leaves `encrypted` as null; the SQL uses COALESCE to
    // preserve the previous ciphertext in that case.
    upsertStmt.run(familyId, backend, model, baseUrl, encrypted, updatedBy ?? null);
    if (keyExplicitlyCleared) clearKeyStmt.run(updatedBy ?? null, familyId);
    return getForFamilyPublic(familyId);
  }

  function clearKey(familyId, updatedBy = null) {
    clearKeyStmt.run(updatedBy, familyId);
    return getForFamilyPublic(familyId);
  }

  return {
    getForFamily,
    getForFamilyPublic,
    upsert,
    clearKey,
    SUPPORTED_BACKENDS,
  };
}

module.exports = { createLlmConfigRepo, SUPPORTED_BACKENDS };
