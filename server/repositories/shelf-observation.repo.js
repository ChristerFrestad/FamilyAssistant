'use strict';

// PR A.2 — Shelf-life observations repository.
//
// Each row captures one (purchased_at, expires_at) pair the user provided,
// which the learner service aggregates into a per-product trimmed mean.
// Writes are always family-scoped; reads are family-scoped by default but
// the service can pass a specific family when running batch recomputes.

const { getFamilyId } = require('../auth/family-context');

function daysBetween(fromYmd, toYmd) {
  const f = new Date(`${fromYmd}T00:00:00Z`).getTime();
  const t = new Date(`${toYmd}T00:00:00Z`).getTime();
  if (!Number.isFinite(f) || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - f) / 86_400_000));
}

function createShelfObservationRepo(db) {
  const insertStmt = db.prepare(
    `INSERT INTO product_shelf_observations
       (family_id, product_key, purchased_at, expires_at, days_lasted, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const recentStmt = db.prepare(
    `SELECT id, product_key AS productKey, purchased_at AS purchasedAt,
            expires_at AS expiresAt, days_lasted AS daysLasted,
            observed_at AS observedAt, source
       FROM product_shelf_observations
      WHERE family_id = ? AND product_key = ?
      ORDER BY observed_at DESC, id DESC
      LIMIT ?`
  );

  const countStmt = db.prepare(
    `SELECT COUNT(*) AS c
       FROM product_shelf_observations
      WHERE family_id = ? AND product_key = ?`
  );

  const allDaysStmt = db.prepare(
    `SELECT days_lasted AS d
       FROM product_shelf_observations
      WHERE family_id = ? AND product_key = ?
      ORDER BY observed_at DESC, id DESC
      LIMIT ?`
  );

  return {
    insert({ productKey, purchasedAt, expiresAt, source }) {
      const familyId = getFamilyId();
      const daysLasted = daysBetween(purchasedAt, expiresAt);
      const info = insertStmt.run(familyId, productKey, purchasedAt, expiresAt, daysLasted, source);
      return { id: Number(info.lastInsertRowid), daysLasted };
    },
    getRecentForProduct(productKey, limit = 10) {
      const familyId = getFamilyId();
      return recentStmt.all(familyId, productKey, Number(limit) || 10);
    },
    countForProduct(productKey) {
      const familyId = getFamilyId();
      return countStmt.get(familyId, productKey)?.c || 0;
    },
    // Returns the last N `days_lasted` values as a plain number array — used
    // by the learner service to compute a trimmed mean without loading the
    // full observation rows.
    getRecentDaysLasted(productKey, limit = 10) {
      const familyId = getFamilyId();
      return allDaysStmt.all(familyId, productKey, Number(limit) || 10).map((r) => r.d);
    },
  };
}

module.exports = { createShelfObservationRepo, daysBetween };
