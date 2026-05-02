'use strict';

const { getFamilyId } = require('../auth/family-context');

function createInventoryRepos(db) {
  const inventory = {
    getAll() {
      const familyId = getFamilyId();
      const rows = db.prepare('SELECT * FROM inventory WHERE family_id = ?').all(familyId);
      const map = {};
      for (const r of rows) {
        map[r.product_key] = {
          qtyRemaining: r.qty_remaining,
          unit: r.unit,
          lastPurchased: r.last_purchased,
          lastPackSize: r.last_pack_size,
          packSize: r.last_pack_size,
          totalSize: r.total_size ?? null,
          expiresEst: r.expires_est,
          purchaseCount: r.purchase_count,
          avgDaysBetweenPurchase: r.avg_days_between_purchase,
        };
      }
      return map;
    },
    getByKey(productKey) {
      const familyId = getFamilyId();
      const r = db
        .prepare('SELECT * FROM inventory WHERE family_id = ? AND product_key = ?')
        .get(familyId, productKey);
      if (!r) return null;
      return {
        qtyRemaining: r.qty_remaining,
        unit: r.unit,
        lastPurchased: r.last_purchased,
        lastPackSize: r.last_pack_size,
        packSize: r.last_pack_size,
        totalSize: r.total_size ?? null,
        expiresEst: r.expires_est,
        purchaseCount: r.purchase_count,
        avgDaysBetweenPurchase: r.avg_days_between_purchase,
      };
    },
    /** Fase F2: sett total_size for en pantry-vare */
    setTotalSize(productKey, totalSize) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE inventory SET total_size = ?, updated_at = datetime('now')
        WHERE family_id = ? AND product_key = ?
      `
      ).run(totalSize, familyId, productKey);
    },
    addPurchase(productKey, { packSize, unit, shelfDays = null }) {
      const familyId = getFamilyId();
      const existing = inventory.getByKey(productKey);
      const now = new Date().toISOString().split('T')[0];
      const expiresEst = shelfDays
        ? new Date(Date.now() + shelfDays * 86400000).toISOString().split('T')[0]
        : null;

      if (!existing) {
        db.prepare(
          `
          INSERT INTO inventory (family_id, product_key, qty_remaining, unit, last_purchased, last_pack_size, expires_est, purchase_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        `
        ).run(familyId, productKey, packSize, unit, now, packSize, expiresEst);
        return { qtyRemaining: packSize, unit, purchaseCount: 1, expiresEst, lastPurchased: now };
      }

      // Update: increment quantity, refresh average days between purchases
      let avg = existing.avgDaysBetweenPurchase;
      if (existing.lastPurchased) {
        const days = Math.max(
          0,
          Math.round((Date.now() - new Date(existing.lastPurchased).getTime()) / 86400000)
        );
        avg = avg ? Math.round((avg + days) / 2) : days;
      }
      db.prepare(
        `
        UPDATE inventory
           SET qty_remaining = qty_remaining + ?,
               unit = ?,
               last_purchased = ?,
               last_pack_size = ?,
               expires_est = COALESCE(?, expires_est),
               purchase_count = purchase_count + 1,
               avg_days_between_purchase = ?,
               updated_at = datetime('now')
         WHERE family_id = ? AND product_key = ?
      `
      ).run(packSize, unit, now, packSize, expiresEst, avg, familyId, productKey);
      return inventory.getByKey(productKey);
    },
    reduceQty(productKey, amount) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE inventory SET qty_remaining = MAX(0, qty_remaining - ?), updated_at = datetime('now')
        WHERE family_id = ? AND product_key = ?
      `
      ).run(amount, familyId, productKey);
    },
    /**
     * Add to or update inventory without marking it as a purchase.
     * Brukes av manual-add og kvittering-confirm — disse bestemmer selv
     * expires_est and avoids incrementing purchase_count when it does not apply
     * (f.eks. ved ren korrigering).
     *
     * Returnerer { prev, next } slik at kalleren kan beregne qty_delta
     * og skrive en inventory_log-rad i samme transaksjon.
     */
    upsertManual(
      productKey,
      { qtyAdded, unit = '', expiresEst = null, incrementPurchaseCount = false }
    ) {
      const familyId = getFamilyId();
      const existing = inventory.getByKey(productKey);
      const now = new Date().toISOString().split('T')[0];

      if (!existing) {
        db.prepare(
          `
          INSERT INTO inventory (family_id, product_key, qty_remaining, unit, last_purchased, last_pack_size, expires_est, purchase_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `
        ).run(
          familyId,
          productKey,
          qtyAdded,
          unit,
          now,
          qtyAdded,
          expiresEst,
          incrementPurchaseCount ? 1 : 0
        );
        return { prev: null, next: inventory.getByKey(productKey) };
      }

      const newQty = (existing.qtyRemaining || 0) + qtyAdded;
      db.prepare(
        `
        UPDATE inventory
           SET qty_remaining = ?,
               unit = CASE WHEN ? = '' THEN unit ELSE ? END,
               last_purchased = ?,
               last_pack_size = ?,
               expires_est = COALESCE(?, expires_est),
               purchase_count = purchase_count + ?,
               updated_at = datetime('now')
         WHERE family_id = ? AND product_key = ?
      `
      ).run(
        newQty,
        unit,
        unit,
        now,
        qtyAdded,
        expiresEst,
        incrementPurchaseCount ? 1 : 0,
        familyId,
        productKey
      );
      return { prev: existing, next: inventory.getByKey(productKey) };
    },
  };

  const inventoryLog = {
    insert({
      productKey,
      qtyDelta,
      newQty,
      unit = null,
      reason,
      sourceId = null,
      sourceTable = null,
      notes = null,
    }) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        INSERT INTO inventory_log (family_id, product_key, qty_delta, new_qty, unit, reason, source_id, source_table, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(familyId, productKey, qtyDelta, newQty, unit, reason, sourceId, sourceTable, notes)
        .lastInsertRowid;
    },
    getByKey(productKey, limit = 50) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, qty_delta as qtyDelta, new_qty as newQty,
               unit, reason, source_id as sourceId, source_table as sourceTable,
               notes, logged_at as loggedAt
        FROM inventory_log
        WHERE family_id = ? AND product_key = ?
        ORDER BY logged_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(familyId, productKey, limit);
    },
    getRecent(limit = 100) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, qty_delta as qtyDelta, new_qty as newQty,
               unit, reason, source_id as sourceId, source_table as sourceTable,
               notes, logged_at as loggedAt
        FROM inventory_log
        WHERE family_id = ?
        ORDER BY logged_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(familyId, limit);
    },
    getByReason(reason, limit = 100) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, qty_delta as qtyDelta, new_qty as newQty,
               unit, reason, source_id as sourceId, source_table as sourceTable,
               notes, logged_at as loggedAt
        FROM inventory_log
        WHERE family_id = ? AND reason = ?
        ORDER BY logged_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(familyId, reason, limit);
    },
    countByReason() {
      const familyId = getFamilyId();
      const rows = db
        .prepare(
          `
        SELECT reason, COUNT(*) as c FROM inventory_log WHERE family_id = ? GROUP BY reason
      `
        )
        .all(familyId);
      const out = {};
      for (const r of rows) out[r.reason] = r.c;
      return out;
    },
  };

  return { inventory, inventoryLog };
}

module.exports = { createInventoryRepos };
