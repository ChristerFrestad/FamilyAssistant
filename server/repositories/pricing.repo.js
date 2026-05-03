'use strict';

const { getFamilyId } = require('../auth/family-context');

function createPricingRepos(db) {
  const consumables = {
    getAll() {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, name, pack_name as packName, category,
               depletion_model as depletionModel, depletion_rate as depletionRate,
               depletion_unit as depletionUnit, current_qty as currentQty, unit,
               pack_size as packSize, pack_unit as packUnit, est_price as estPrice,
               reorder_threshold as reorderThreshold, auto_add as autoAdd,
               store, notes, last_purchased as lastPurchased, purchase_count as purchaseCount
        FROM consumables WHERE family_id = ? ORDER BY category, name
      `
        )
        .all(familyId)
        .map((c) => ({ ...c, autoAdd: !!c.autoAdd }));
    },
    getById(id) {
      const familyId = getFamilyId();
      const c = db
        .prepare(
          `SELECT id, product_key as productKey, name, pack_name as packName, category,
                  depletion_model as depletionModel, depletion_rate as depletionRate,
                  depletion_unit as depletionUnit, current_qty as currentQty, unit,
                  pack_size as packSize, pack_unit as packUnit, est_price as estPrice,
                  reorder_threshold as reorderThreshold, auto_add as autoAdd, store, notes
           FROM consumables WHERE family_id = ? AND id = ?`
        )
        .get(familyId, id);
      if (!c) return null;
      c.autoAdd = !!c.autoAdd;
      return c;
    },
    /**
     * Insert seed consumables for the current family. Does NOT pass a
     * caller-supplied id — the INSERT OR REPLACE pattern that did so
     * was a multi-tenant footgun (family 2 seeding with seed-id=1
     * would REPLACE family 1's row on the same global id). With
     * AUTOINCREMENT each family gets its own id-range.
     */
    upsertMany(list) {
      const familyId = getFamilyId();
      const ins = db.prepare(`
        INSERT INTO consumables (
          family_id, product_key, name, pack_name, category, depletion_model, depletion_rate, depletion_unit,
          current_qty, unit, pack_size, pack_unit, est_price, reorder_threshold, auto_add, store, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const c of list) {
          ins.run(
            familyId,
            c.productKey ?? null,
            c.name,
            c.packName ?? null,
            c.category,
            c.depletionModel,
            c.depletionRate ?? null,
            c.depletionUnit ?? null,
            c.currentQty ?? 0,
            c.unit,
            c.packSize ?? null,
            c.packUnit ?? null,
            c.estPrice ?? null,
            c.reorderThreshold ?? null,
            c.autoAdd ? 1 : 0,
            c.store ?? null,
            c.notes ?? null
          );
        }
      });
      tx();
    },
    update(id, fields) {
      const familyId = getFamilyId();
      const allowed = {
        name: 'name',
        autoAdd: 'auto_add',
        depletionRate: 'depletion_rate',
        reorderThreshold: 'reorder_threshold',
        notes: 'notes',
        estPrice: 'est_price',
        packName: 'pack_name',
        packSize: 'pack_size',
      };
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(fields)) {
        if (allowed[k]) {
          sets.push(`${allowed[k]} = ?`);
          vals.push(k === 'autoAdd' ? (v ? 1 : 0) : v);
        }
      }
      if (sets.length === 0) return;
      sets.push(`updated_at = datetime('now')`);
      vals.push(familyId, id);
      db.prepare(`UPDATE consumables SET ${sets.join(', ')} WHERE family_id = ? AND id = ?`).run(
        ...vals
      );
    },
    markBought(id, qty) {
      const familyId = getFamilyId();
      const c = consumables.getById(id);
      if (!c) return null;
      const addQty = qty || c.packSize || 1;
      db.prepare(
        `
        UPDATE consumables
           SET current_qty = current_qty + ?,
               last_purchased = date('now'),
               purchase_count = purchase_count + 1,
               updated_at = datetime('now')
         WHERE family_id = ? AND id = ?
      `
      ).run(addQty, familyId, id);
      return consumables.getById(id);
    },
    toggleAuto(id) {
      const familyId = getFamilyId();
      db.prepare(
        `UPDATE consumables SET auto_add = 1 - auto_add WHERE family_id = ? AND id = ?`
      ).run(familyId, id);
      return consumables.getById(id);
    },
    reduceDaily(recipeEquipment) {
      const familyId = getFamilyId();
      const list = consumables.getAll();
      const upd = db.prepare(
        `UPDATE consumables SET current_qty = MAX(0, current_qty - ?) WHERE family_id = ? AND id = ?`
      );
      const tx = db.transaction(() => {
        for (const c of list) {
          if (c.depletionModel === 'daily_rate' && c.currentQty > 0) {
            upd.run(c.depletionRate || 0, familyId, c.id);
          }
          if (c.depletionModel === 'per_recipe_type' && Array.isArray(recipeEquipment)) {
            const usesOven = recipeEquipment.some((e) =>
              ['stekeovn', 'airfryer', 'langpanne'].includes(e)
            );
            if (usesOven && c.currentQty > 0) upd.run(c.depletionRate || 0, familyId, c.id);
          }
        }
      });
      tx();
    },
  };

  const purchaseLog = {
    insert(entry) {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT INTO purchase_log (family_id, product_key, qty, unit, price_paid, store, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        familyId,
        entry.productKey,
        entry.qty,
        entry.unit,
        entry.pricePaid,
        entry.store,
        entry.source || 'manual'
      );
    },
  };

  const priceReferences = {
    getByProductKey(productKey) {
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, product_name as productName, brand,
               category, pack_size as packSize, pack_unit as packUnit, ean,
               current_price as currentPrice, price_per_unit as pricePerUnit,
               currency, store, source, source_url as sourceUrl, confidence,
               last_verified as lastVerified, indexed_from as indexedFrom,
               created_at as createdAt, updated_at as updatedAt
        FROM price_references
        WHERE product_key = ?
        ORDER BY confidence DESC, last_verified DESC
      `
        )
        .all(productKey);
    },
    getBest(productKey) {
      // Returns the best available reference: freshest + highest confidence
      const rows = priceReferences.getByProductKey(productKey);
      if (rows.length === 0) return null;
      return rows[0];
    },
    getByEan(ean) {
      if (!ean) return null;
      return (
        db
          .prepare(
            `
        SELECT id, product_key as productKey, product_name as productName, current_price as currentPrice,
               store, source, confidence, last_verified as lastVerified
        FROM price_references
        WHERE ean = ?
        ORDER BY confidence DESC, last_verified DESC
        LIMIT 1
      `
          )
          .get(ean) || null
      );
    },
    search(q, limit = 20) {
      const like = `%${(q || '').toLowerCase()}%`;
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, product_name as productName, brand,
               current_price as currentPrice, store, source, confidence,
               last_verified as lastVerified
        FROM price_references
        WHERE lower(product_name) LIKE ? OR lower(product_key) LIKE ? OR lower(brand) LIKE ?
        ORDER BY confidence DESC, last_verified DESC
        LIMIT ?
      `
        )
        .all(like, like, like, limit);
    },
    upsert(ref) {
      // INSERT OR REPLACE would delete the id and the history FK, so we use
      // ON CONFLICT on the UNIQUE index (product_key, store, source) and
      // oppdaterer kun felter vi faktisk vil endre.
      db.prepare(
        `
        INSERT INTO price_references (
          product_key, product_name, brand, category, pack_size, pack_unit, ean,
          current_price, price_per_unit, currency, store, source, source_url,
          confidence, last_verified, indexed_from
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(product_key, store, source) DO UPDATE SET
          product_name  = excluded.product_name,
          brand         = COALESCE(excluded.brand, brand),
          category      = COALESCE(excluded.category, category),
          pack_size     = COALESCE(excluded.pack_size, pack_size),
          pack_unit     = COALESCE(excluded.pack_unit, pack_unit),
          ean           = COALESCE(excluded.ean, ean),
          current_price = excluded.current_price,
          price_per_unit = COALESCE(excluded.price_per_unit, price_per_unit),
          source_url    = COALESCE(excluded.source_url, source_url),
          confidence    = excluded.confidence,
          last_verified = datetime('now'),
          indexed_from  = excluded.indexed_from,
          updated_at    = datetime('now')
      `
      ).run(
        ref.productKey,
        ref.productName,
        ref.brand ?? null,
        ref.category ?? null,
        ref.packSize ?? null,
        ref.packUnit ?? null,
        ref.ean ?? null,
        ref.currentPrice,
        ref.pricePerUnit ?? null,
        ref.currency || 'NOK',
        ref.store ?? null,
        ref.source,
        ref.sourceUrl ?? null,
        ref.confidence ?? 1.0,
        ref.indexedFrom ?? null
      );
      return priceReferences.getByProductKeyStoreSource(
        ref.productKey,
        ref.store ?? null,
        ref.source
      );
    },
    getByProductKeyStoreSource(productKey, store, source) {
      // Internal helper used by upsert to return the row.
      const row = db
        .prepare(
          `
        SELECT id, product_key as productKey, product_name as productName,
               current_price as currentPrice, confidence, last_verified as lastVerified,
               indexed_from as indexedFrom, source, store
        FROM price_references
        WHERE product_key = ? AND (store IS ? OR store = ?) AND source = ?
      `
        )
        .get(productKey, store, store, source);
      return row || null;
    },
    getStale(olderThanDays) {
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, product_name as productName,
               current_price as currentPrice, last_verified as lastVerified,
               confidence, store, source
        FROM price_references
        WHERE last_verified < datetime('now', ?)
      `
        )
        .all(`-${olderThanDays} days`);
    },
    applyCpiMultiplier(multiplier, olderThanDays) {
      // Marker alle stale referanser med ny pris = pris * multiplier.
      // confidence reduseres til 0.7 og indexed_from settes til i dag.
      const stale = priceReferences.getStale(olderThanDays);
      const upd = db.prepare(`
        UPDATE price_references
           SET current_price = ?,
               confidence    = 0.7,
               indexed_from  = date('now'),
               updated_at    = datetime('now')
         WHERE id = ?
      `);
      const ins = db.prepare(`
        INSERT INTO price_history (price_ref_id, price, source)
        VALUES (?, ?, 'cpi_index')
      `);
      const tx = db.transaction(() => {
        for (const row of stale) {
          const newPrice = Math.round(row.currentPrice * multiplier * 100) / 100;
          upd.run(newPrice, row.id);
          ins.run(row.id, newPrice);
        }
      });
      tx();
      return stale.length;
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM price_references').get().c;
    },
    stats() {
      const row = db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN last_verified >= datetime('now','-30 days') THEN 1 END) as fresh,
          COUNT(CASE WHEN confidence < 0.8 THEN 1 END) as estimated,
          AVG(current_price) as avgPrice
        FROM price_references
      `
        )
        .get();
      return {
        total: row.total || 0,
        fresh: row.fresh || 0,
        estimated: row.estimated || 0,
        avgPrice: row.avgPrice ? Math.round(row.avgPrice * 100) / 100 : 0,
      };
    },
  };

  const priceHistory = {
    insert({ priceRefId, price, source }) {
      return db
        .prepare(
          `
        INSERT INTO price_history (price_ref_id, price, source) VALUES (?, ?, ?)
      `
        )
        .run(priceRefId, price, source).lastInsertRowid;
    },
    getForRef(priceRefId, limit = 50) {
      return db
        .prepare(
          `
        SELECT id, price, source, recorded_at as recordedAt
        FROM price_history
        WHERE price_ref_id = ?
        ORDER BY recorded_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(priceRefId, limit);
    },
  };

  return { consumables, purchaseLog, priceReferences, priceHistory };
}

module.exports = { createPricingRepos };
