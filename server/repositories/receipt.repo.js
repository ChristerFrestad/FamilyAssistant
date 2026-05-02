'use strict';

const { getFamilyId } = require('../auth/family-context');

function createReceiptRepos(db) {
  const receipts = {
    insert(rec) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        INSERT INTO receipts (
          family_id, file_path, mime_type, file_size_bytes, sha256, merchant,
          purchased_at, total_nok, currency, raw_text, llm_model, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          familyId,
          rec.filePath,
          rec.mimeType,
          rec.fileSizeBytes,
          rec.sha256,
          rec.merchant ?? null,
          rec.purchasedAt ?? null,
          rec.totalNok ?? null,
          rec.currency || 'NOK',
          rec.rawText ?? null,
          rec.llmModel ?? null,
          rec.status || 'pending'
        ).lastInsertRowid;
    },
    getBySha(sha) {
      const familyId = getFamilyId();
      const row = db
        .prepare(
          `
        SELECT id, file_path as filePath, mime_type as mimeType, file_size_bytes as fileSizeBytes,
               sha256, merchant, purchased_at as purchasedAt, total_nok as totalNok,
               currency, raw_text as rawText, llm_model as llmModel, status,
               error_message as errorMessage, created_at as createdAt, confirmed_at as confirmedAt
        FROM receipts WHERE family_id = ? AND sha256 = ?
      `
        )
        .get(familyId, sha);
      return row || null;
    },
    getById(id) {
      const familyId = getFamilyId();
      const row = db
        .prepare(
          `
        SELECT id, file_path as filePath, mime_type as mimeType, file_size_bytes as fileSizeBytes,
               sha256, merchant, purchased_at as purchasedAt, total_nok as totalNok,
               currency, raw_text as rawText, llm_model as llmModel, status,
               error_message as errorMessage, created_at as createdAt, confirmed_at as confirmedAt
        FROM receipts WHERE family_id = ? AND id = ?
      `
        )
        .get(familyId, id);
      return row || null;
    },
    list({ status = null, limit = 50 } = {}) {
      const familyId = getFamilyId();
      if (status) {
        return db
          .prepare(
            `
          SELECT id, merchant, purchased_at as purchasedAt, total_nok as totalNok,
                 status, created_at as createdAt, confirmed_at as confirmedAt
          FROM receipts WHERE family_id = ? AND status = ?
          ORDER BY created_at DESC, id DESC LIMIT ?
        `
          )
          .all(familyId, status, limit);
      }
      return db
        .prepare(
          `
        SELECT id, merchant, purchased_at as purchasedAt, total_nok as totalNok,
               status, created_at as createdAt, confirmed_at as confirmedAt
        FROM receipts WHERE family_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
      `
        )
        .all(familyId, limit);
    },
    updateParsed(
      id,
      {
        merchant,
        purchasedAt,
        totalNok,
        rawText,
        llmModel,
        status = 'pending',
        errorMessage = null,
      }
    ) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE receipts
           SET merchant = COALESCE(?, merchant),
               purchased_at = COALESCE(?, purchased_at),
               total_nok = COALESCE(?, total_nok),
               raw_text = COALESCE(?, raw_text),
               llm_model = COALESCE(?, llm_model),
               status = ?,
               error_message = ?
         WHERE family_id = ? AND id = ?
      `
      ).run(
        merchant ?? null,
        purchasedAt ?? null,
        totalNok ?? null,
        rawText ?? null,
        llmModel ?? null,
        status,
        errorMessage,
        familyId,
        id
      );
    },
    markStatus(id, status, { errorMessage = null } = {}) {
      const familyId = getFamilyId();
      const confirmedAt = status === 'confirmed' ? new Date().toISOString() : null;
      db.prepare(
        `
        UPDATE receipts SET status = ?, error_message = ?, confirmed_at = COALESCE(?, confirmed_at)
        WHERE family_id = ? AND id = ?
      `
      ).run(status, errorMessage, confirmedAt, familyId, id);
    },
    remove(id) {
      const familyId = getFamilyId();
      db.prepare('DELETE FROM receipts WHERE family_id = ? AND id = ?').run(familyId, id);
    },
    stats() {
      const familyId = getFamilyId();
      const rows = db
        .prepare(
          `
        SELECT status, COUNT(*) as c FROM receipts WHERE family_id = ? GROUP BY status
      `
        )
        .all(familyId);
      const out = { total: 0 };
      for (const r of rows) {
        out[r.status] = r.c;
        out.total += r.c;
      }
      return out;
    },
  };

  const receiptItems = {
    insertMany(receiptId, items) {
      const familyId = getFamilyId();
      const ins = db.prepare(`
        INSERT INTO receipt_items (
          family_id, receipt_id, line_text, product_key, product_name, qty, unit,
          unit_price, total_price, discount, ean, confidence, flagged_reason,
          kassal_product_id, resolution_candidates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const it of items) {
          ins.run(
            familyId,
            receiptId,
            it.lineText || '',
            it.productKey ?? null,
            it.productName || '',
            it.qty ?? null,
            it.unit ?? null,
            it.unitPrice ?? null,
            it.totalPrice ?? 0,
            it.discount ?? 0,
            it.ean ?? null,
            it.confidence ?? 0.5,
            it.flaggedReason ?? null,
            it.kassalProductId ?? null,
            it.resolutionCandidates ? JSON.stringify(it.resolutionCandidates) : null
          );
        }
      });
      tx();
    },
    getByReceipt(receiptId) {
      const familyId = getFamilyId();
      const rows = db
        .prepare(
          `
        SELECT id, receipt_id as receiptId, line_text as lineText,
               product_key as productKey, product_name as productName,
               qty, unit, unit_price as unitPrice, total_price as totalPrice,
               discount, ean, confidence, confirmed, flagged_reason as flaggedReason,
               kassal_product_id as kassalProductId,
               resolution_candidates_json as resolutionCandidatesJson
        FROM receipt_items WHERE family_id = ? AND receipt_id = ? ORDER BY id
      `
        )
        .all(familyId, receiptId);
      return rows.map((r) => ({
        ...r,
        resolutionCandidates: r.resolutionCandidatesJson
          ? JSON.parse(r.resolutionCandidatesJson)
          : null,
      }));
    },
    updateItem(id, fields) {
      const familyId = getFamilyId();
      const allowed = {
        productKey: 'product_key',
        productName: 'product_name',
        qty: 'qty',
        unit: 'unit',
        totalPrice: 'total_price',
        discount: 'discount',
        confidence: 'confidence',
        confirmed: 'confirmed',
        flaggedReason: 'flagged_reason',
        kassalProductId: 'kassal_product_id',
      };
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(fields)) {
        if (allowed[k]) {
          sets.push(`${allowed[k]} = ?`);
          vals.push(k === 'confirmed' ? (v ? 1 : 0) : v);
        }
      }
      if (sets.length === 0) return;
      vals.push(familyId, id);
      db.prepare(`UPDATE receipt_items SET ${sets.join(', ')} WHERE family_id = ? AND id = ?`).run(
        ...vals
      );
    },
    removeByReceipt(receiptId) {
      const familyId = getFamilyId();
      db.prepare('DELETE FROM receipt_items WHERE family_id = ? AND receipt_id = ?').run(
        familyId,
        receiptId
      );
    },
  };

  const kassalProducts = {
    /**
     * Upsert based on kassal_id (stable id from Kassal).
     * Oppdaterer last_seen_* felter hvis price/store er satt.
     */
    upsert(p) {
      const existing = db
        .prepare('SELECT id FROM kassal_products WHERE kassal_id = ?')
        .get(p.kassalId);
      if (existing) {
        db.prepare(
          `
          UPDATE kassal_products
             SET ean = COALESCE(?, ean),
                 name = COALESCE(?, name),
                 brand = COALESCE(?, brand),
                 vendor = COALESCE(?, vendor),
                 category = COALESCE(?, category),
                 pack_size = COALESCE(?, pack_size),
                 pack_unit = COALESCE(?, pack_unit),
                 image_url = COALESCE(?, image_url),
                 last_seen_price = COALESCE(?, last_seen_price),
                 last_seen_store = COALESCE(?, last_seen_store),
                 last_seen_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE last_seen_at END,
                 raw_json = COALESCE(?, raw_json),
                 updated_at = datetime('now')
           WHERE id = ?
        `
        ).run(
          p.ean ?? null,
          p.name ?? null,
          p.brand ?? null,
          p.vendor ?? null,
          p.category ?? null,
          p.packSize ?? null,
          p.packUnit ?? null,
          p.imageUrl ?? null,
          p.lastSeenPrice ?? null,
          p.lastSeenStore ?? null,
          p.lastSeenPrice ?? null,
          p.rawJson ?? null,
          existing.id
        );
        return existing.id;
      }
      const result = db
        .prepare(
          `
        INSERT INTO kassal_products (
          kassal_id, ean, name, brand, vendor, category, pack_size, pack_unit,
          image_url, last_seen_price, last_seen_store, last_seen_at,
          raw_json, capture_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END, ?, ?)
      `
        )
        .run(
          p.kassalId,
          p.ean ?? null,
          p.name || '',
          p.brand ?? null,
          p.vendor ?? null,
          p.category ?? null,
          p.packSize ?? null,
          p.packUnit ?? null,
          p.imageUrl ?? null,
          p.lastSeenPrice ?? null,
          p.lastSeenStore ?? null,
          p.lastSeenPrice ?? null,
          p.rawJson ?? null,
          p.captureSource || 'lookup'
        );
      return result.lastInsertRowid;
    },
    getById(id) {
      return db.prepare('SELECT * FROM kassal_products WHERE id = ?').get(id);
    },
    getByKassalId(kassalId) {
      return db.prepare('SELECT * FROM kassal_products WHERE kassal_id = ?').get(kassalId);
    },
    getByEan(ean) {
      if (!ean) return null;
      return db.prepare('SELECT * FROM kassal_products WHERE ean = ?').get(ean);
    },
    search(q, limit = 10) {
      const like = `%${q.toLowerCase()}%`;
      return db
        .prepare(
          `
        SELECT * FROM kassal_products
        WHERE lower(name) LIKE ? OR lower(brand) LIKE ?
        ORDER BY last_seen_at DESC, name LIMIT ?
      `
        )
        .all(like, like, limit);
    },
    stats() {
      const row = db
        .prepare(
          `
        SELECT COUNT(*) as total,
               COUNT(ean) as withEan,
               COUNT(last_seen_price) as withPrice
        FROM kassal_products
      `
        )
        .get();
      return row;
    },
  };

  const productResolutions = {
    /**
     * Record that we "saw" a resolution (upload phase). times_seen++.
     */
    upsertSeen({ productKey, kassalProductId, resolvedVia, confidence }) {
      const existing = db
        .prepare(
          `
        SELECT id, times_seen FROM product_resolutions
        WHERE (product_key IS ? OR product_key = ?) AND kassal_product_id = ?
      `
        )
        .get(productKey ?? null, productKey ?? null, kassalProductId);
      if (existing) {
        db.prepare(
          `
          UPDATE product_resolutions
             SET times_seen = times_seen + 1,
                 last_seen_at = datetime('now'),
                 confidence = MAX(confidence, ?)
           WHERE id = ?
        `
        ).run(confidence ?? 0.5, existing.id);
        return existing.id;
      }
      const r = db
        .prepare(
          `
        INSERT INTO product_resolutions
          (product_key, kassal_product_id, resolved_via, confidence, times_seen)
        VALUES (?, ?, ?, ?, 1)
      `
        )
        .run(productKey ?? null, kassalProductId, resolvedVia, confidence ?? 0.5);
      return r.lastInsertRowid;
    },
    /**
     * Bruker har bekreftet kvitteringen. times_confirmed++.
     */
    incrementConfirmed(id) {
      db.prepare(
        `
        UPDATE product_resolutions
           SET times_confirmed = times_confirmed + 1,
               last_confirmed_at = datetime('now'),
               last_seen_at = datetime('now')
         WHERE id = ?
      `
      ).run(id);
    },
    /**
     * Gi beste kjente resolution for en product_key.
     * Prioriterer: user_locked > times_confirmed > confidence.
     */
    bestForProductKey(productKey) {
      if (!productKey) return null;
      return db
        .prepare(
          `
        SELECT pr.*, kp.ean, kp.name as kassalName, kp.brand, kp.pack_size as packSize,
               kp.pack_unit as packUnit, kp.last_seen_price as lastSeenPrice,
               kp.last_seen_store as lastSeenStore, kp.image_url as imageUrl
        FROM product_resolutions pr
        JOIN kassal_products kp ON kp.id = pr.kassal_product_id
        WHERE pr.product_key = ?
        ORDER BY pr.user_locked DESC, pr.times_confirmed DESC, pr.confidence DESC
        LIMIT 1
      `
        )
        .get(productKey);
    },
    /**
     * Alle resolutions for en product_key (for UI-dropdown).
     */
    allForProductKey(productKey, limit = 5) {
      if (!productKey) return [];
      return db
        .prepare(
          `
        SELECT pr.id, pr.kassal_product_id as kassalProductId, pr.resolved_via as resolvedVia,
               pr.confidence, pr.times_confirmed as timesConfirmed, pr.times_seen as timesSeen,
               pr.user_locked as userLocked,
               kp.kassal_id as kassalId, kp.ean, kp.name, kp.brand,
               kp.pack_size as packSize, kp.pack_unit as packUnit,
               kp.last_seen_price as lastSeenPrice, kp.image_url as imageUrl
        FROM product_resolutions pr
        JOIN kassal_products kp ON kp.id = pr.kassal_product_id
        WHERE pr.product_key = ?
        ORDER BY pr.user_locked DESC, pr.times_confirmed DESC, pr.confidence DESC
        LIMIT ?
      `
        )
        .all(productKey, limit);
    },
    setUserLocked(id, locked = true) {
      db.prepare('UPDATE product_resolutions SET user_locked = ? WHERE id = ?').run(
        locked ? 1 : 0,
        id
      );
    },
    getById(id) {
      return db.prepare('SELECT * FROM product_resolutions WHERE id = ?').get(id);
    },
  };

  const kassalCache = {
    get(cacheKey) {
      const row = db
        .prepare(
          `
        SELECT id, cache_key as cacheKey, endpoint, response_json as responseJson,
               fetched_at as fetchedAt, expires_at as expiresAt, hit_count as hitCount
        FROM kassal_cache WHERE cache_key = ?
      `
        )
        .get(cacheKey);
      return row || null;
    },
    put({ cacheKey, endpoint, responseJson, ttlHours }) {
      const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();
      db.prepare(
        `
        INSERT INTO kassal_cache (cache_key, endpoint, response_json, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          response_json = excluded.response_json,
          endpoint = excluded.endpoint,
          fetched_at = datetime('now'),
          expires_at = excluded.expires_at,
          hit_count = 0
      `
      ).run(cacheKey, endpoint, responseJson, expiresAt);
    },
    bumpHit(id) {
      db.prepare('UPDATE kassal_cache SET hit_count = hit_count + 1 WHERE id = ?').run(id);
    },
    purgeExpired() {
      const r = db.prepare(`DELETE FROM kassal_cache WHERE expires_at < datetime('now')`).run();
      return r.changes || 0;
    },
    stats() {
      const row = db
        .prepare(
          `
        SELECT COUNT(*) as total,
               SUM(CASE WHEN expires_at >= datetime('now') THEN 1 ELSE 0 END) as fresh,
               SUM(hit_count) as totalHits
        FROM kassal_cache
      `
        )
        .get();
      return row;
    },
  };

  return { receipts, receiptItems, kassalProducts, productResolutions, kassalCache };
}

module.exports = { createReceiptRepos };
