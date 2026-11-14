'use strict';

const crypto = require('crypto');

const ALLOWED_SCOPES = ['read', 'shopping:write', 'chores:write', 'meals:cooked'];

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createApiTokenRepo(db) {
  return {
    create({ familyId, name, scopes, createdBy }) {
      const token = `fa_${crypto.randomBytes(32).toString('base64url')}`;
      const tokenHash = hashToken(token);
      const info = db
        .prepare(
          `INSERT INTO api_tokens (family_id, name, token_hash, scopes, created_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(familyId, name, tokenHash, JSON.stringify(scopes), createdBy || null);
      return { id: Number(info.lastInsertRowid), token, name, scopes };
    },
    list(familyId) {
      return db
        .prepare(
          `SELECT id, name, scopes, created_at as createdAt, revoked_at as revokedAt
             FROM api_tokens
            WHERE family_id = ?
            ORDER BY id DESC`
        )
        .all(familyId)
        .map((row) => ({
          ...row,
          scopes: JSON.parse(row.scopes),
          revoked: row.revokedAt != null,
        }));
    },
    findActiveByToken(token) {
      const tokenHash = hashToken(token);
      const row = db
        .prepare(
          `SELECT id, family_id, name, token_hash, scopes, revoked_at
             FROM api_tokens WHERE token_hash = ?`
        )
        .get(tokenHash);
      if (!row || row.revoked_at) return null;
      const stored = Buffer.from(row.token_hash);
      const given = Buffer.from(tokenHash);
      if (stored.length !== given.length || !crypto.timingSafeEqual(stored, given)) return null;
      return {
        id: row.id,
        familyId: row.family_id,
        name: row.name,
        scopes: JSON.parse(row.scopes),
      };
    },
    revoke(familyId, id) {
      const info = db
        .prepare(
          `UPDATE api_tokens
              SET revoked_at = datetime('now')
            WHERE family_id = ? AND id = ? AND revoked_at IS NULL`
        )
        .run(familyId, id);
      return info.changes > 0;
    },
  };
}

module.exports = { createApiTokenRepo, ALLOWED_SCOPES, hashToken };
