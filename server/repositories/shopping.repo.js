'use strict';

const { getFamilyId } = require('../auth/family-context');

function createShoppingRepos(db, tryParseJson) {
  const shoppingExtras = {
    getWeek(weekYear) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT * FROM shopping_extras
        WHERE family_id = ? AND week_year = ?
        ORDER BY created_at
      `
        )
        .all(familyId, weekYear);
    },
    add(weekYear, { name, category, quantity = null }) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        INSERT INTO shopping_extras (family_id, week_year, name, category, quantity)
        VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(familyId, weekYear, name, category || 'Tørrvarer & annet', quantity).lastInsertRowid;
    },
    toggleChecked(id) {
      const familyId = getFamilyId();
      db.prepare(
        `UPDATE shopping_extras SET checked = 1 - checked WHERE family_id = ? AND id = ?`
      ).run(familyId, id);
    },
    remove(id) {
      const familyId = getFamilyId();
      db.prepare('DELETE FROM shopping_extras WHERE family_id = ? AND id = ?').run(familyId, id);
    },
  };

  const shoppingLists = {
    /**
     * Opprett en ny aktiv handleliste for uken med sine items.
     * Flytter ev. eksisterende 'active' for samme uke til 'superseded' først.
     * Returnerer { listId, itemCount, needsBuyCount }.
     */
    createActive(weekYear, items, { totalEstPrice = null, notes = null } = {}) {
      const familyId = getFamilyId();
      const supersede = db.prepare(`
        UPDATE shopping_lists SET status = 'superseded'
        WHERE family_id = ? AND week_year = ? AND status = 'active'
      `);
      const insertList = db.prepare(`
        INSERT INTO shopping_lists (family_id, week_year, status, total_est_price, notes)
        VALUES (?, ?, 'active', ?, ?)
      `);
      const insertItem = db.prepare(`
        INSERT INTO shopping_list_items (
          family_id, list_id, source_type, source_ref, ingredient_name, ingredient_name_no,
          product_key, qty, unit, brand_hint, category,
          pack_size, pack_unit, pack_count, est_price,
          pantry_has, pantry_qty, needs_buy,
          meals_json, dairy_note, sort_order, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        supersede.run(familyId, weekYear);
        const listId = Number(
          insertList.run(familyId, weekYear, totalEstPrice, notes).lastInsertRowid
        );
        let needsBuyCount = 0;
        let sort = 0;
        for (const it of items) {
          const needsBuy = it.needsBuy ? 1 : 0;
          if (needsBuy) needsBuyCount++;
          insertItem.run(
            familyId,
            listId,
            it.sourceType,
            it.sourceRef || null,
            it.ingredientName,
            it.ingredientNameNo || null,
            it.productKey || null,
            it.qty ?? null,
            it.unit || null,
            it.brandHint || null,
            it.category || null,
            it.packSize ?? null,
            it.packUnit || null,
            it.packCount ?? null,
            it.estPrice ?? null,
            it.pantryHas ? 1 : 0,
            it.pantryQty ?? null,
            needsBuy,
            it.mealsJson ? JSON.stringify(it.mealsJson) : null,
            it.dairyNote || null,
            sort++,
            it.notes || null
          );
        }
        return { listId, itemCount: items.length, needsBuyCount };
      });
      return tx();
    },

    /**
     * Hent en liste med alle items (i sort_order). Returnerer null hvis ikke funnet.
     */
    getById(id) {
      const familyId = getFamilyId();
      const list = db
        .prepare(
          `
        SELECT id, week_year as weekYear, status,
               generated_at as generatedAt, confirmed_at as confirmedAt,
               enrichment_status as enrichmentStatus,
               enrichment_started_at as enrichmentStartedAt,
               enrichment_finished_at as enrichmentFinishedAt,
               total_est_price as totalEstPrice, notes
        FROM shopping_lists WHERE family_id = ? AND id = ?
      `
        )
        .get(familyId, id);
      if (!list) return null;
      list.items = shoppingLists._getItems(id);
      return list;
    },

    /**
     * Hent den aktive handlelisten for en uke, eller null.
     */
    getActive(weekYear) {
      const familyId = getFamilyId();
      const row = db
        .prepare(
          `
        SELECT id, week_year as weekYear, status,
               generated_at as generatedAt, confirmed_at as confirmedAt,
               enrichment_status as enrichmentStatus,
               enrichment_started_at as enrichmentStartedAt,
               enrichment_finished_at as enrichmentFinishedAt,
               total_est_price as totalEstPrice, notes
        FROM shopping_lists
        WHERE family_id = ? AND week_year = ? AND status = 'active'
        LIMIT 1
      `
        )
        .get(familyId, weekYear);
      if (!row) return null;
      row.items = shoppingLists._getItems(row.id);
      return row;
    },

    /**
     * Finn aktive handlelister som trenger berikelse (pending eller partial).
     * Brukes av cron-jobben for å resumere berikelse etter rate-limit/crash.
     * NB: Cron-bruk kjører per-family via runWithFamily, så family_id-filtret
     * her er basert på gjeldende kontekst.
     */
    listPendingEnrichment(limit = 10) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id FROM shopping_lists
        WHERE family_id = ?
          AND status = 'active'
          AND enrichment_status IN ('pending', 'partial')
        ORDER BY generated_at ASC
        LIMIT ?
      `
        )
        .all(familyId, limit)
        .map((r) => r.id);
    },

    /**
     * Lister (uten items) for en uke, nyeste først. Brukt av historikk-UI.
     */
    getByWeek(weekYear) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, status,
               generated_at as generatedAt, confirmed_at as confirmedAt,
               enrichment_status as enrichmentStatus,
               total_est_price as totalEstPrice
        FROM shopping_lists WHERE family_id = ? AND week_year = ?
        ORDER BY generated_at DESC
      `
        )
        .all(familyId, weekYear);
    },

    _getItems(listId) {
      const familyId = getFamilyId();
      const rows = db
        .prepare(
          `
        SELECT si.id, si.list_id as listId, si.source_type as sourceType, si.source_ref as sourceRef,
               si.ingredient_name as ingredientName, si.ingredient_name_no as ingredientNameNo,
               si.product_key as productKey, si.qty, si.unit, si.brand_hint as brandHint, si.category,
               si.pack_size as packSize, si.pack_unit as packUnit, si.pack_count as packCount,
               si.est_price as estPrice,
               si.pantry_has as pantryHas, si.pantry_qty as pantryQty, si.needs_buy as needsBuy,
               si.bought_at as boughtAt, si.bought_qty as boughtQty,
               si.kassal_product_id as kassalProductId, si.resolution_id as resolutionId,
               si.resolution_candidates_json as resolutionCandidatesJson,
               si.resolution_confidence as resolutionConfidence,
               si.resolved_via as resolvedVia,
               si.meals_json as mealsJson, si.dairy_note as dairyNote, si.sort_order as sortOrder, si.notes,
               kp.last_seen_store as lastSeenStore
        FROM shopping_list_items si
        LEFT JOIN kassal_products kp ON kp.id = si.kassal_product_id
        WHERE si.family_id = ? AND si.list_id = ?
        ORDER BY si.sort_order, si.id
      `
        )
        .all(familyId, listId);
      return rows.map((r) => ({
        ...r,
        pantryHas: !!r.pantryHas,
        needsBuy: !!r.needsBuy,
        mealsJson: r.mealsJson ? tryParseJson(r.mealsJson) : null,
        resolutionCandidatesJson: r.resolutionCandidatesJson
          ? tryParseJson(r.resolutionCandidatesJson)
          : null,
      }));
    },

    /**
     * Hent et enkelt item med parent-liste. Returnerer { item, list } eller null.
     */
    getItemWithList(itemId) {
      const familyId = getFamilyId();
      const item = db
        .prepare(
          `
        SELECT id, list_id as listId, source_type as sourceType, source_ref as sourceRef,
               ingredient_name as ingredientName, product_key as productKey,
               qty, unit, pack_size as packSize, pack_unit as packUnit, pack_count as packCount,
               pantry_has as pantryHas, needs_buy as needsBuy,
               bought_at as boughtAt, bought_qty as boughtQty,
               kassal_product_id as kassalProductId, resolution_id as resolutionId
        FROM shopping_list_items WHERE family_id = ? AND id = ?
      `
        )
        .get(familyId, itemId);
      if (!item) return null;
      item.pantryHas = !!item.pantryHas;
      item.needsBuy = !!item.needsBuy;
      const list = db
        .prepare(
          `
        SELECT id, week_year as weekYear, status FROM shopping_lists
        WHERE family_id = ? AND id = ?
      `
        )
        .get(familyId, item.listId);
      return { item, list };
    },

    /**
     * Merk item som kjøpt. Setter bought_at og bought_qty.
     * Kallerne (service-laget) må selv oppdatere inventory og
     * eventuelt productResolutions — repo-en gjør ikke side-effekter
     * utenfor sin egen tabell.
     */
    markItemBought(itemId, boughtQty) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE shopping_list_items
        SET bought_at = datetime('now'),
            bought_qty = ?,
            needs_buy = 0
        WHERE family_id = ? AND id = ?
      `
      ).run(boughtQty ?? null, familyId, itemId);
    },

    /**
     * "Jeg har ikke denne varen likevel": flytt item fra pantry-dekket
     * til må-kjøpes. needs_buy=1, pantry_has=0.
     */
    markItemUnpantry(itemId) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE shopping_list_items
        SET pantry_has = 0, needs_buy = 1
        WHERE family_id = ? AND id = ?
      `
      ).run(familyId, itemId);
    },

    /**
     * Undo "bought": clear bought_at + bought_qty and reactivate the
     * row as a must-buy. Pantry qty is NOT rolled back (see comment in
     * /api/shopping/items/:id/unbought).
     */
    markItemUnbought(itemId) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE shopping_list_items
        SET bought_at = NULL, bought_qty = NULL, needs_buy = 1
        WHERE family_id = ? AND id = ?
      `
      ).run(familyId, itemId);
    },

    /**
     * Permanently delete the row from the active shopping list.
     */
    removeItem(itemId) {
      const familyId = getFamilyId();
      db.prepare('DELETE FROM shopping_list_items WHERE family_id = ? AND id = ?').run(
        familyId,
        itemId
      );
    },

    /**
     * Lukk en handleliste manuelt. Setter status='done' + confirmed_at.
     */
    markDone(listId) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE shopping_lists
        SET status = 'done', confirmed_at = datetime('now')
        WHERE family_id = ? AND id = ?
      `
      ).run(familyId, listId);
    },

    /**
     * Oppdater berikelse-status (brukt av fase B enricher).
     */
    setEnrichmentStatus(listId, status, { startedAt = false, finishedAt = false } = {}) {
      const familyId = getFamilyId();
      const fields = ['enrichment_status = ?'];
      const args = [status];
      if (startedAt) {
        fields.push("enrichment_started_at = datetime('now')");
      }
      if (finishedAt) {
        fields.push("enrichment_finished_at = datetime('now')");
      }
      db.prepare(
        `
        UPDATE shopping_lists SET ${fields.join(', ')} WHERE family_id = ? AND id = ?
      `
      ).run(...args, familyId, listId);
    },

    /**
     * Skriv Kassal-resolusjon på et item (brukt av fase B enricher).
     */
    attachResolution(
      itemId,
      { kassalProductId, resolutionId, confidence, resolvedVia, candidatesJson, estimatedPrice }
    ) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE shopping_list_items
        SET kassal_product_id = ?,
            resolution_id = ?,
            resolution_confidence = ?,
            resolved_via = ?,
            resolution_candidates_json = ?,
            est_price = COALESCE(?, est_price)
        WHERE family_id = ? AND id = ?
      `
      ).run(
        kassalProductId ?? null,
        resolutionId ?? null,
        confidence ?? null,
        resolvedVia || null,
        candidatesJson
          ? typeof candidatesJson === 'string'
            ? candidatesJson
            : JSON.stringify(candidatesJson)
          : null,
        estimatedPrice ?? null,
        familyId,
        itemId
      );
    },

    stats() {
      const familyId = getFamilyId();
      const totalLists = db
        .prepare('SELECT COUNT(*) as c FROM shopping_lists WHERE family_id = ?')
        .get(familyId).c;
      const activeLists = db
        .prepare(
          "SELECT COUNT(*) as c FROM shopping_lists WHERE family_id = ? AND status = 'active'"
        )
        .get(familyId).c;
      const totalItems = db
        .prepare('SELECT COUNT(*) as c FROM shopping_list_items WHERE family_id = ?')
        .get(familyId).c;
      const boughtItems = db
        .prepare(
          'SELECT COUNT(*) as c FROM shopping_list_items WHERE family_id = ? AND bought_at IS NOT NULL'
        )
        .get(familyId).c;
      return { totalLists, activeLists, totalItems, boughtItems };
    },
  };

  return { shoppingLists, shoppingExtras };
}

module.exports = { createShoppingRepos };
