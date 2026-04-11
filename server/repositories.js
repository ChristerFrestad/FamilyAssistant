// Repository-lag (Fase 1)
// Hver "repo" er et objekt med CRUD-metoder mot én tabell.
// createRepositories(db) returnerer et bundle med alle repositories.
//
// Designvalg:
// - Alle skrivinger bruker parameteriserte prepared statements
// - Multi-step skrivinger pakkes i transactions() av kalleren (services)
// - Repositories er stateless — de holder kun en referanse til db

function tryParseJson(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function createRepositories(db) {
  // ==========================================================
  // PRODUCTS
  // ==========================================================
  const products = {
    getByKey(key) {
      return db.prepare('SELECT * FROM products WHERE key = ?').get(key);
    },
    getAll() {
      return db.prepare('SELECT * FROM products ORDER BY category, product_name').all();
    },
    getAllAsMap() {
      const rows = products.getAll();
      const map = {};
      for (const r of rows) {
        map[r.key] = {
          productName: r.product_name,
          category: r.category,
          packSize: r.pack_size,
          unit: r.unit,
          estPrice: r.est_price,
          shelfDays: r.shelf_days,
          store: r.store,
          ean: r.ean,
          dairyRule: r.dairy_rule,
        };
      }
      return map;
    },
    search(q) {
      const like = `%${q.toLowerCase()}%`;
      return db
        .prepare(
          `
        SELECT * FROM products
        WHERE lower(key) LIKE ? OR lower(product_name) LIKE ?
        ORDER BY product_name LIMIT 50
      `
        )
        .all(like, like);
    },
    upsert(p) {
      return db
        .prepare(
          `
        INSERT INTO products (key, product_name, category, pack_size, unit, est_price, shelf_days, store, ean, dairy_rule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          product_name=excluded.product_name,
          category=excluded.category,
          pack_size=excluded.pack_size,
          unit=excluded.unit,
          est_price=excluded.est_price,
          shelf_days=excluded.shelf_days,
          store=excluded.store,
          ean=excluded.ean,
          dairy_rule=excluded.dairy_rule,
          updated_at=datetime('now')
      `
        )
        .run(
          p.key,
          p.productName,
          p.category,
          p.packSize,
          p.unit,
          p.estPrice ?? null,
          p.shelfDays ?? null,
          p.store ?? 'Kiwi V\u00e5gsbygd',
          p.ean ?? null,
          p.dairyRule ?? null
        );
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    },
  };

  // ==========================================================
  // RECIPES (+ ingredients)
  // ==========================================================
  const recipes = {
    getById(id) {
      const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
      if (!recipe) return null;
      recipe.ingredients = db
        .prepare(
          `
        SELECT id, product_key as productKey, name, qty, unit, optional, sort_order
        FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order, id
      `
        )
        .all(id);
      recipe.equipment = recipe.equipment_json ? JSON.parse(recipe.equipment_json) : [];
      // Normaliser snake_case → camelCase for frontend-parity med getAll()
      recipe.prepTime = recipe.prep_time;
      recipe.sourceType = recipe.source_type || 'manual';
      return recipe;
    },
    getAll() {
      const rows = db.prepare('SELECT * FROM recipes ORDER BY category, name').all();
      const ingsByRecipe = {};
      const allIngs = db
        .prepare(
          `
        SELECT recipe_id, id, product_key as productKey, name, qty, unit, optional, sort_order
        FROM recipe_ingredients ORDER BY sort_order, id
      `
        )
        .all();
      for (const i of allIngs) {
        if (!ingsByRecipe[i.recipe_id]) ingsByRecipe[i.recipe_id] = [];
        ingsByRecipe[i.recipe_id].push({
          id: i.id,
          productKey: i.productKey,
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          optional: !!i.optional,
        });
      }
      return rows.map((r) => ({
        ...r,
        prepTime: r.prep_time,
        sourceType: r.source_type || 'manual',
        ingredients: ingsByRecipe[r.id] || [],
        equipment: r.equipment_json ? JSON.parse(r.equipment_json) : [],
      }));
    },
    getByCategory(category) {
      return recipes.getAll().filter((r) => r.category === category);
    },
    insert(r) {
      const result = db
        .prepare(
          `
        INSERT INTO recipes (name, category, prep_time, source, url, pinterest_url, servings, equipment_json, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          r.name,
          r.category,
          r.prepTime ?? null,
          r.source ?? null,
          r.url ?? null,
          r.pinterestUrl ?? null,
          r.servings ?? 2,
          r.equipment ? JSON.stringify(r.equipment) : null,
          r.notes ?? null
        );
      const recipeId = result.lastInsertRowid;
      if (Array.isArray(r.ingredients)) {
        const ins = db.prepare(`
          INSERT INTO recipe_ingredients (recipe_id, product_key, name, qty, unit, optional, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        r.ingredients.forEach((ing, idx) => {
          ins.run(
            recipeId,
            ing.productKey ?? null,
            ing.name,
            ing.qty,
            ing.unit,
            ing.optional ? 1 : 0,
            idx
          );
        });
      }
      return recipeId;
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM recipes').get().c;
    },
  };

  // ==========================================================
  // INVENTORY
  // ==========================================================
  const inventory = {
    getAll() {
      const rows = db.prepare('SELECT * FROM inventory').all();
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
      const r = db.prepare('SELECT * FROM inventory WHERE product_key = ?').get(productKey);
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
      db.prepare(
        `
        UPDATE inventory SET total_size = ?, updated_at = datetime('now')
        WHERE product_key = ?
      `
      ).run(totalSize, productKey);
    },
    addPurchase(productKey, { packSize, unit, shelfDays = null }) {
      const existing = inventory.getByKey(productKey);
      const now = new Date().toISOString().split('T')[0];
      const expiresEst = shelfDays
        ? new Date(Date.now() + shelfDays * 86400000).toISOString().split('T')[0]
        : null;

      if (!existing) {
        db.prepare(
          `
          INSERT INTO inventory (product_key, qty_remaining, unit, last_purchased, last_pack_size, expires_est, purchase_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
        `
        ).run(productKey, packSize, unit, now, packSize, expiresEst);
        return { qtyRemaining: packSize, unit, purchaseCount: 1, expiresEst, lastPurchased: now };
      }

      // Oppdater: inkrementer mengde, oppdater snittdager mellom kj\u00f8p
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
         WHERE product_key = ?
      `
      ).run(packSize, unit, now, packSize, expiresEst, avg, productKey);
      return inventory.getByKey(productKey);
    },
    reduceQty(productKey, amount) {
      db.prepare(
        `
        UPDATE inventory SET qty_remaining = MAX(0, qty_remaining - ?), updated_at = datetime('now')
        WHERE product_key = ?
      `
      ).run(amount, productKey);
    },
    /**
     * Legg til eller oppdater inventory uten å markere det som et kjøp.
     * Brukes av manual-add og kvittering-confirm — disse bestemmer selv
     * expires_est og unngår purchase_count-økning når det ikke passer
     * (f.eks. ved ren korrigering).
     *
     * Returnerer { prev, next } slik at kalleren kan beregne qty_delta
     * og skrive en inventory_log-rad i samme transaksjon.
     */
    upsertManual(
      productKey,
      { qtyAdded, unit = '', expiresEst = null, incrementPurchaseCount = false }
    ) {
      const existing = inventory.getByKey(productKey);
      const now = new Date().toISOString().split('T')[0];

      if (!existing) {
        db.prepare(
          `
          INSERT INTO inventory (product_key, qty_remaining, unit, last_purchased, last_pack_size, expires_est, purchase_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `
        ).run(
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
         WHERE product_key = ?
      `
      ).run(
        newQty,
        unit,
        unit,
        now,
        qtyAdded,
        expiresEst,
        incrementPurchaseCount ? 1 : 0,
        productKey
      );
      return { prev: existing, next: inventory.getByKey(productKey) };
    },
  };

  // ==========================================================
  // MEAL PLANS
  // ==========================================================
  const mealPlans = {
    getWeek(weekYear) {
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, day_of_week as dayOfWeek, meal_type as mealType,
               recipe_id as recipeId, status, notes
        FROM meal_plans
        WHERE week_year = ? AND meal_type = 'middag'
        ORDER BY day_of_week
      `
        )
        .all(weekYear);
    },
    seedDefault(weekYear, defaultPlan) {
      const ins = db.prepare(`
        INSERT OR IGNORE INTO meal_plans (week_year, day_of_week, meal_type, recipe_id, status)
        VALUES (?, ?, 'middag', ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const slot of defaultPlan) {
          ins.run(weekYear, slot.dayOfWeek, slot.recipeId, slot.status || 'planned');
        }
      });
      tx();
    },
    setRecipe(weekYear, dayOfWeek, recipeId, status = 'planned') {
      db.prepare(
        `
        INSERT INTO meal_plans (week_year, day_of_week, meal_type, recipe_id, status)
        VALUES (?, ?, 'middag', ?, ?)
        ON CONFLICT(week_year, day_of_week, meal_type) DO UPDATE SET
          recipe_id = excluded.recipe_id, status = excluded.status
      `
      ).run(weekYear, dayOfWeek, recipeId, status);
    },
    setStatus(weekYear, dayOfWeek, status) {
      db.prepare(
        `
        UPDATE meal_plans SET status = ?
        WHERE week_year = ? AND day_of_week = ? AND meal_type = 'middag'
      `
      ).run(status, weekYear, dayOfWeek);
    },
    swapDays(weekYear, dayA, dayB) {
      const plan = mealPlans.getWeek(weekYear);
      const slotA = plan.find((p) => p.dayOfWeek === dayA);
      const slotB = plan.find((p) => p.dayOfWeek === dayB);
      if (!slotA || !slotB) return;
      const tx = db.transaction(() => {
        mealPlans.setRecipe(weekYear, dayA, slotB.recipeId, slotA.status);
        mealPlans.setRecipe(weekYear, dayB, slotA.recipeId, slotB.status);
      });
      tx();
    },
    exists(weekYear) {
      return (
        db.prepare('SELECT 1 FROM meal_plans WHERE week_year = ? LIMIT 1').get(weekYear) != null
      );
    },
    /**
     * En uke er "komplett" når alle 7 dager har tatt et eksplisitt valg:
     * - recipe_id satt (planned/cooked), eller
     * - status IN ('away','skipped','removed')
     * Dager med recipe_id=NULL og status='planned' regnes som "ikke avklart".
     * Returnerer false hvis uken ikke finnes i det hele tatt.
     */
    isWeekComplete(weekYear) {
      const rows = db
        .prepare(
          `
        SELECT day_of_week as dayOfWeek, recipe_id as recipeId, status
        FROM meal_plans
        WHERE week_year = ? AND meal_type = 'middag'
      `
        )
        .all(weekYear);
      if (rows.length < 7) return false;
      const seen = new Set();
      for (const r of rows) {
        seen.add(r.dayOfWeek);
        const decided =
          r.recipeId != null ||
          r.status === 'away' ||
          r.status === 'skipped' ||
          r.status === 'removed';
        if (!decided) return false;
      }
      // Alle 7 unike dager må være til stede
      for (let d = 0; d < 7; d++) if (!seen.has(d)) return false;
      return true;
    },
  };

  // ==========================================================
  // CHORES
  // ==========================================================
  const chores = {
    getAll() {
      return db.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY default_day, task').all();
    },
    upsertMany(choreList) {
      const ins = db.prepare(`
        INSERT OR REPLACE INTO chores (id, task, details, frequency, default_day, icon, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const c of choreList) {
          ins.run(
            c.id,
            c.task,
            c.details ?? null,
            c.frequency,
            c.defaultDay,
            c.icon ?? null,
            c.active ? 1 : 0
          );
        }
      });
      tx();
    },
  };

  const choreSchedules = {
    getWeek(weekYear) {
      return db
        .prepare(
          `
        SELECT id, chore_id as choreId, week_year as weekYear,
               scheduled_day as scheduledDay, status, postponed_to as postponedTo,
               completed_at as completedAt, notes
        FROM chore_schedules WHERE week_year = ?
      `
        )
        .all(weekYear);
    },
    exists(weekYear) {
      return (
        db.prepare('SELECT 1 FROM chore_schedules WHERE week_year = ? LIMIT 1').get(weekYear) !=
        null
      );
    },
    seedDefault(weekYear) {
      const all = chores.getAll();
      const ins = db.prepare(`
        INSERT OR IGNORE INTO chore_schedules (chore_id, week_year, scheduled_day, status)
        VALUES (?, ?, ?, 'pending')
      `);
      const tx = db.transaction(() => {
        for (const c of all) {
          if (c.default_day != null) ins.run(c.id, weekYear, c.default_day);
        }
      });
      tx();
    },
    postpone(weekYear, choreId, newDay) {
      db.prepare(
        `
        UPDATE chore_schedules SET postponed_to = ?, status = 'postponed'
        WHERE week_year = ? AND chore_id = ?
      `
      ).run(newDay, weekYear, choreId);
    },
    markDone(weekYear, choreId) {
      db.prepare(
        `
        UPDATE chore_schedules SET status = 'done', completed_at = datetime('now')
        WHERE week_year = ? AND chore_id = ?
      `
      ).run(weekYear, choreId);
    },
    add(weekYear, choreId, scheduledDay) {
      db.prepare(
        `
        INSERT OR IGNORE INTO chore_schedules (chore_id, week_year, scheduled_day, status)
        VALUES (?, ?, ?, 'pending')
      `
      ).run(choreId, weekYear, scheduledDay);
    },
  };

  // ==========================================================
  // SHOPPING EXTRAS
  // ==========================================================
  const shoppingExtras = {
    getWeek(weekYear) {
      return db
        .prepare(
          `
        SELECT * FROM shopping_extras WHERE week_year = ? ORDER BY created_at
      `
        )
        .all(weekYear);
    },
    add(weekYear, { name, category, quantity = null }) {
      return db
        .prepare(
          `
        INSERT INTO shopping_extras (week_year, name, category, quantity) VALUES (?, ?, ?, ?)
      `
        )
        .run(weekYear, name, category || 'T\u00f8rrvarer & annet', quantity).lastInsertRowid;
    },
    toggleChecked(id) {
      db.prepare(`UPDATE shopping_extras SET checked = 1 - checked WHERE id = ?`).run(id);
    },
    remove(id) {
      db.prepare('DELETE FROM shopping_extras WHERE id = ?').run(id);
    },
  };

  // ==========================================================
  // SHOPPING LISTS (fase 3b — persistente handlelister)
  // ==========================================================
  //
  // Hver "aktiv" handleliste lever som én rad i shopping_lists + N rader
  // i shopping_list_items. Ved regenerering flyttes forrige 'active' til
  // 'superseded' før ny 'active' inserteres — partial unique index
  // idx_shopping_lists_active_per_week sørger for at det bare kan finnes
  // én 'active' per uke. Vi pakker alltid create+supersede i én transaksjon
  // slik at det ikke er mulig å få 0 eller 2 'active' samtidig.
  const shoppingLists = {
    /**
     * Opprett en ny aktiv handleliste for uken med sine items.
     * Flytter ev. eksisterende 'active' for samme uke til 'superseded' først.
     * Returnerer { listId, itemCount, needsBuyCount }.
     */
    createActive(weekYear, items, { totalEstPrice = null, notes = null } = {}) {
      const supersede = db.prepare(`
        UPDATE shopping_lists SET status = 'superseded'
        WHERE week_year = ? AND status = 'active'
      `);
      const insertList = db.prepare(`
        INSERT INTO shopping_lists (week_year, status, total_est_price, notes)
        VALUES (?, 'active', ?, ?)
      `);
      const insertItem = db.prepare(`
        INSERT INTO shopping_list_items (
          list_id, source_type, source_ref, ingredient_name, ingredient_name_no,
          product_key, qty, unit, brand_hint, category,
          pack_size, pack_unit, pack_count, est_price,
          pantry_has, pantry_qty, needs_buy,
          meals_json, dairy_note, sort_order, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        supersede.run(weekYear);
        const listId = Number(insertList.run(weekYear, totalEstPrice, notes).lastInsertRowid);
        let needsBuyCount = 0;
        let sort = 0;
        for (const it of items) {
          const needsBuy = it.needsBuy ? 1 : 0;
          if (needsBuy) needsBuyCount++;
          insertItem.run(
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
      const list = db
        .prepare(
          `
        SELECT id, week_year as weekYear, status,
               generated_at as generatedAt, confirmed_at as confirmedAt,
               enrichment_status as enrichmentStatus,
               enrichment_started_at as enrichmentStartedAt,
               enrichment_finished_at as enrichmentFinishedAt,
               total_est_price as totalEstPrice, notes
        FROM shopping_lists WHERE id = ?
      `
        )
        .get(id);
      if (!list) return null;
      list.items = shoppingLists._getItems(id);
      return list;
    },

    /**
     * Hent den aktive handlelisten for en uke, eller null.
     */
    getActive(weekYear) {
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
        WHERE week_year = ? AND status = 'active'
        LIMIT 1
      `
        )
        .get(weekYear);
      if (!row) return null;
      row.items = shoppingLists._getItems(row.id);
      return row;
    },

    /**
     * Finn aktive handlelister som trenger berikelse (pending eller partial).
     * Brukes av cron-jobben for å resumere berikelse etter rate-limit/crash.
     */
    listPendingEnrichment(limit = 10) {
      return db
        .prepare(
          `
        SELECT id FROM shopping_lists
        WHERE status = 'active' AND enrichment_status IN ('pending', 'partial')
        ORDER BY generated_at ASC
        LIMIT ?
      `
        )
        .all(limit)
        .map((r) => r.id);
    },

    /**
     * Lister (uten items) for en uke, nyeste først. Brukt av historikk-UI.
     */
    getByWeek(weekYear) {
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, status,
               generated_at as generatedAt, confirmed_at as confirmedAt,
               enrichment_status as enrichmentStatus,
               total_est_price as totalEstPrice
        FROM shopping_lists WHERE week_year = ?
        ORDER BY generated_at DESC
      `
        )
        .all(weekYear);
    },

    _getItems(listId) {
      const rows = db
        .prepare(
          `
        SELECT id, list_id as listId, source_type as sourceType, source_ref as sourceRef,
               ingredient_name as ingredientName, ingredient_name_no as ingredientNameNo,
               product_key as productKey, qty, unit, brand_hint as brandHint, category,
               pack_size as packSize, pack_unit as packUnit, pack_count as packCount,
               est_price as estPrice,
               pantry_has as pantryHas, pantry_qty as pantryQty, needs_buy as needsBuy,
               bought_at as boughtAt, bought_qty as boughtQty,
               kassal_product_id as kassalProductId, resolution_id as resolutionId,
               resolution_candidates_json as resolutionCandidatesJson,
               resolution_confidence as resolutionConfidence,
               resolved_via as resolvedVia,
               meals_json as mealsJson, dairy_note as dairyNote, sort_order as sortOrder, notes
        FROM shopping_list_items
        WHERE list_id = ?
        ORDER BY sort_order, id
      `
        )
        .all(listId);
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
      const item = db
        .prepare(
          `
        SELECT id, list_id as listId, source_type as sourceType, source_ref as sourceRef,
               ingredient_name as ingredientName, product_key as productKey,
               qty, unit, pack_size as packSize, pack_unit as packUnit, pack_count as packCount,
               pantry_has as pantryHas, needs_buy as needsBuy,
               bought_at as boughtAt, bought_qty as boughtQty,
               kassal_product_id as kassalProductId, resolution_id as resolutionId
        FROM shopping_list_items WHERE id = ?
      `
        )
        .get(itemId);
      if (!item) return null;
      item.pantryHas = !!item.pantryHas;
      item.needsBuy = !!item.needsBuy;
      const list = db
        .prepare(
          `
        SELECT id, week_year as weekYear, status FROM shopping_lists WHERE id = ?
      `
        )
        .get(item.listId);
      return { item, list };
    },

    /**
     * Merk item som kjøpt. Setter bought_at og bought_qty.
     * Kallerne (service-laget) må selv oppdatere inventory og
     * eventuelt productResolutions — repo-en gjør ikke side-effekter
     * utenfor sin egen tabell.
     */
    markItemBought(itemId, boughtQty) {
      db.prepare(
        `
        UPDATE shopping_list_items
        SET bought_at = datetime('now'),
            bought_qty = ?,
            needs_buy = 0
        WHERE id = ?
      `
      ).run(boughtQty ?? null, itemId);
    },

    /**
     * "Jeg har ikke denne varen likevel": flytt item fra pantry-dekket
     * til må-kjøpes. needs_buy=1, pantry_has=0.
     */
    markItemUnpantry(itemId) {
      db.prepare(
        `
        UPDATE shopping_list_items
        SET pantry_has = 0, needs_buy = 1
        WHERE id = ?
      `
      ).run(itemId);
    },

    /**
     * Lukk en handleliste manuelt. Setter status='done' + confirmed_at.
     */
    markDone(listId) {
      db.prepare(
        `
        UPDATE shopping_lists
        SET status = 'done', confirmed_at = datetime('now')
        WHERE id = ?
      `
      ).run(listId);
    },

    /**
     * Oppdater berikelse-status (brukt av fase B enricher).
     */
    setEnrichmentStatus(listId, status, { startedAt = false, finishedAt = false } = {}) {
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
        UPDATE shopping_lists SET ${fields.join(', ')} WHERE id = ?
      `
      ).run(...args, listId);
    },

    /**
     * Skriv Kassal-resolusjon på et item (brukt av fase B enricher).
     */
    attachResolution(
      itemId,
      { kassalProductId, resolutionId, confidence, resolvedVia, candidatesJson, estimatedPrice }
    ) {
      db.prepare(
        `
        UPDATE shopping_list_items
        SET kassal_product_id = ?,
            resolution_id = ?,
            resolution_confidence = ?,
            resolved_via = ?,
            resolution_candidates_json = ?,
            est_price = COALESCE(?, est_price)
        WHERE id = ?
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
        itemId
      );
    },

    stats() {
      const totalLists = db.prepare('SELECT COUNT(*) as c FROM shopping_lists').get().c;
      const activeLists = db
        .prepare("SELECT COUNT(*) as c FROM shopping_lists WHERE status = 'active'")
        .get().c;
      const totalItems = db.prepare('SELECT COUNT(*) as c FROM shopping_list_items').get().c;
      const boughtItems = db
        .prepare('SELECT COUNT(*) as c FROM shopping_list_items WHERE bought_at IS NOT NULL')
        .get().c;
      return { totalLists, activeLists, totalItems, boughtItems };
    },
  };

  // ==========================================================
  // CONSUMABLES
  // ==========================================================
  const consumables = {
    getAll() {
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, name, pack_name as packName, category,
               depletion_model as depletionModel, depletion_rate as depletionRate,
               depletion_unit as depletionUnit, current_qty as currentQty, unit,
               pack_size as packSize, pack_unit as packUnit, est_price as estPrice,
               reorder_threshold as reorderThreshold, auto_add as autoAdd,
               store, notes, last_purchased as lastPurchased, purchase_count as purchaseCount
        FROM consumables ORDER BY category, name
      `
        )
        .all()
        .map((c) => ({ ...c, autoAdd: !!c.autoAdd }));
    },
    getById(id) {
      return consumables.getAll().find((c) => c.id === id) || null;
    },
    upsertMany(list) {
      const ins = db.prepare(`
        INSERT OR REPLACE INTO consumables (
          id, product_key, name, pack_name, category, depletion_model, depletion_rate, depletion_unit,
          current_qty, unit, pack_size, pack_unit, est_price, reorder_threshold, auto_add, store, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const c of list) {
          ins.run(
            c.id,
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
      vals.push(id);
      db.prepare(`UPDATE consumables SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    },
    markBought(id, qty) {
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
         WHERE id = ?
      `
      ).run(addQty, id);
      return consumables.getById(id);
    },
    toggleAuto(id) {
      db.prepare(`UPDATE consumables SET auto_add = 1 - auto_add WHERE id = ?`).run(id);
      return consumables.getById(id);
    },
    reduceDaily(recipeEquipment) {
      const list = consumables.getAll();
      const upd = db.prepare(
        `UPDATE consumables SET current_qty = MAX(0, current_qty - ?) WHERE id = ?`
      );
      const tx = db.transaction(() => {
        for (const c of list) {
          if (c.depletionModel === 'daily_rate' && c.currentQty > 0) {
            upd.run(c.depletionRate || 0, c.id);
          }
          if (c.depletionModel === 'per_recipe_type' && Array.isArray(recipeEquipment)) {
            const usesOven = recipeEquipment.some((e) =>
              ['stekeovn', 'airfryer', 'langpanne'].includes(e)
            );
            if (usesOven && c.currentQty > 0) upd.run(c.depletionRate || 0, c.id);
          }
        }
      });
      tx();
    },
  };

  // ==========================================================
  // KNOWLEDGE BASE (m/ FTS5-s\u00f8k hvis tilgjengelig)
  // ==========================================================
  const hasFTS = (() => {
    try {
      return (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_base_fts'`
          )
          .get() != null
      );
    } catch {
      return false;
    }
  })();

  const kb = {
    insert(entry) {
      return db
        .prepare(
          `
        INSERT INTO knowledge_base (timestamp, user_message, ai_response, context_json, intent, entities_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          entry.timestamp || new Date().toISOString(),
          entry.userMessage,
          entry.aiResponse,
          entry.context ? JSON.stringify(entry.context) : null,
          entry.intent || null,
          entry.entities ? JSON.stringify(entry.entities) : null
        ).lastInsertRowid;
    },
    search(query, limit = 10) {
      if (hasFTS && query && query.trim()) {
        // FTS5 BM25-s\u00f8k
        const safe = query
          .replace(/["']/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => `${t}*`)
          .join(' OR ');
        if (!safe) return [];
        try {
          return db
            .prepare(
              `
            SELECT kb.* FROM knowledge_base kb
            JOIN knowledge_base_fts fts ON fts.rowid = kb.id
            WHERE knowledge_base_fts MATCH ?
            ORDER BY bm25(knowledge_base_fts) LIMIT ?
          `
            )
            .all(safe, limit);
        } catch {
          /* falle tilbake til LIKE */
        }
      }
      const like = `%${query}%`;
      return db
        .prepare(
          `
        SELECT * FROM knowledge_base
        WHERE user_message LIKE ? OR ai_response LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `
        )
        .all(like, like, limit);
    },
    getRecent(limit = 20) {
      return db.prepare('SELECT * FROM knowledge_base ORDER BY timestamp DESC LIMIT ?').all(limit);
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get().c;
    },
  };

  // ==========================================================
  // CALENDAR
  // ==========================================================
  const calendar = {
    getEvents(from, to) {
      return db
        .prepare(
          `
        SELECT id, title, date, start_time as startTime, end_time as endTime, location, all_day as allDay, notes, source
        FROM calendar_events WHERE date >= ? AND date <= ? ORDER BY date, start_time
      `
        )
        .all(from, to);
    },
    insert(ev) {
      const res = db
        .prepare(
          `
        INSERT INTO calendar_events (title, date, start_time, end_time, location, all_day, notes, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          ev.title,
          ev.date,
          ev.startTime ?? null,
          ev.endTime ?? null,
          ev.location ?? null,
          ev.allDay ? 1 : 0,
          ev.notes ?? null,
          ev.source ?? 'local'
        );
      return { id: res.lastInsertRowid, ...ev };
    },
    delete(id) {
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    },
  };

  // ==========================================================
  // NOTIFICATIONS
  // ==========================================================
  const notifications = {
    insert(type, message, data = null) {
      db.prepare(
        `
        INSERT INTO notifications (type, message, data_json) VALUES (?, ?, ?)
      `
      ).run(type, message, data ? JSON.stringify(data) : null);
    },
    getUnread() {
      return db
        .prepare(`SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC`)
        .all();
    },
    markAllRead() {
      db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
    },
  };

  // ==========================================================
  // PURCHASE LOG
  // ==========================================================
  const purchaseLog = {
    insert(entry) {
      db.prepare(
        `
        INSERT INTO purchase_log (product_key, qty, unit, price_paid, store, source)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        entry.productKey,
        entry.qty,
        entry.unit,
        entry.pricePaid,
        entry.store,
        entry.source || 'manual'
      );
    },
  };

  // ==========================================================
  // MEAL HISTORY
  // ==========================================================
  const mealHistory = {
    insert(entry) {
      db.prepare(
        `
        INSERT INTO meal_history (recipe_id, rating, leftovers, notes) VALUES (?, ?, ?, ?)
      `
      ).run(entry.recipeId, entry.rating ?? null, entry.leftovers ? 1 : 0, entry.notes ?? null);
    },
    getRecent(days = 28) {
      return db
        .prepare(
          `
        SELECT recipe_id as recipeId, cooked_at, rating, leftovers
        FROM meal_history
        WHERE cooked_at >= date('now', ?)
        ORDER BY cooked_at DESC
      `
        )
        .all(`-${days} days`);
    },
  };

  // ==========================================================
  // SUNDAY DRAFTS
  // ==========================================================
  const sundayDrafts = {
    get(weekYear) {
      const r = db.prepare(`SELECT * FROM sunday_drafts WHERE week_year = ?`).get(weekYear);
      if (!r) return null;
      return { ...r, meals: JSON.parse(r.meals_json), accepted: !!r.accepted };
    },
    save(weekYear, meals) {
      db.prepare(
        `
        INSERT OR REPLACE INTO sunday_drafts (week_year, meals_json, generated_at, accepted)
        VALUES (?, ?, datetime('now'), 0)
      `
      ).run(weekYear, JSON.stringify(meals));
    },
    markAccepted(weekYear) {
      db.prepare(`UPDATE sunday_drafts SET accepted = 1 WHERE week_year = ?`).run(weekYear);
    },
  };

  // ==========================================================
  // LLM CACHE (Fase 3.5)
  // ==========================================================
  // Persistert cache for LLM-responser. Unngår gjentatte kall til
  // Ollama/llama.cpp for samme (model, prompt, contextKey). Nøkkelen
  // er en SHA-256-hash som kalleren beregner; vi bryr oss kun om
  // get/set/cleanup her.
  const llmCache = {
    get(key) {
      const row = db
        .prepare(
          `
        SELECT response, model, expires_at, tokens_in, tokens_out, hits
        FROM llm_cache WHERE key = ?
      `
        )
        .get(key);
      if (!row) return null;
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        // Expired — rydd lazy og returner null
        db.prepare('DELETE FROM llm_cache WHERE key = ?').run(key);
        return null;
      }
      // Oppdater hit-stats (fire-and-forget for hot path)
      db.prepare(
        `
        UPDATE llm_cache SET hits = hits + 1, last_hit_at = datetime('now')
        WHERE key = ?
      `
      ).run(key);
      return {
        response: row.response,
        model: row.model,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        hits: row.hits + 1,
      };
    },
    set(key, { model, prompt, response, tokensIn = null, tokensOut = null, ttlSeconds = 3600 }) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      db.prepare(
        `
        INSERT INTO llm_cache (key, model, prompt, response, tokens_in, tokens_out, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          response = excluded.response,
          tokens_in = excluded.tokens_in,
          tokens_out = excluded.tokens_out,
          expires_at = excluded.expires_at,
          hits = 0,
          last_hit_at = NULL
      `
      ).run(key, model, prompt, response, tokensIn, tokensOut, expiresAt);
    },
    cleanup() {
      const res = db.prepare(`DELETE FROM llm_cache WHERE expires_at <= datetime('now')`).run();
      return res.changes || 0;
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM llm_cache').get().c;
    },
    stats() {
      const total = db
        .prepare('SELECT COUNT(*) as c, COALESCE(SUM(hits),0) as h FROM llm_cache')
        .get();
      return { entries: total.c, totalHits: total.h };
    },
  };

  // ==========================================================
  // INVENTORY LOG (Fase 6: audit for hvorfor varen kom inn)
  // ==========================================================
  // Hver insert representerer en diskret hendelse i pantry. Delta kan være
  // positivt (tillagt manuelt, via kvittering eller seed) eller negativt
  // (forbrukt via cron, korrigert, eller slettet fordi utløpt). new_qty er
  // pantry-saldoen etter at hendelsen er bokført, slik at historikken kan
  // rekonstruere pantry-tilstanden uten å måtte replaye fra null.
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
      return db
        .prepare(
          `
        INSERT INTO inventory_log (product_key, qty_delta, new_qty, unit, reason, source_id, source_table, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(productKey, qtyDelta, newQty, unit, reason, sourceId, sourceTable, notes)
        .lastInsertRowid;
    },
    getByKey(productKey, limit = 50) {
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, qty_delta as qtyDelta, new_qty as newQty,
               unit, reason, source_id as sourceId, source_table as sourceTable,
               notes, logged_at as loggedAt
        FROM inventory_log
        WHERE product_key = ?
        ORDER BY logged_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(productKey, limit);
    },
    getRecent(limit = 100) {
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, qty_delta as qtyDelta, new_qty as newQty,
               unit, reason, source_id as sourceId, source_table as sourceTable,
               notes, logged_at as loggedAt
        FROM inventory_log
        ORDER BY logged_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(limit);
    },
    getByReason(reason, limit = 100) {
      return db
        .prepare(
          `
        SELECT id, product_key as productKey, qty_delta as qtyDelta, new_qty as newQty,
               unit, reason, source_id as sourceId, source_table as sourceTable,
               notes, logged_at as loggedAt
        FROM inventory_log
        WHERE reason = ?
        ORDER BY logged_at DESC, id DESC
        LIMIT ?
      `
        )
        .all(reason, limit);
    },
    countByReason() {
      const rows = db
        .prepare(
          `
        SELECT reason, COUNT(*) as c FROM inventory_log GROUP BY reason
      `
        )
        .all();
      const out = {};
      for (const r of rows) out[r.reason] = r.c;
      return out;
    },
  };

  // ==========================================================
  // PRICE REFERENCES (Fase 6: master-data for norske priser)
  // ==========================================================
  // Siste verifiserte pris per (product_key, store, source). Brukes som
  // sammenligningspunkt ved kvittering-parsing ("betalte du mer enn
  // forventet?") og for "estimert verdi av pantry". Se price-reference.service
  // for forretningslogikk (CPI-indeksering, Kassal-sync, lookup-prioritering).
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
      // Returnerer beste tilgjengelige referanse: ferskest + høyest confidence
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
      // INSERT OR REPLACE ville slettet id og historikk-FK, så vi bruker
      // ON CONFLICT på UNIQUE-indeksen (product_key, store, source) og
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
      // Intern hjelper brukt av upsert for å returnere raden.
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

  // ==========================================================
  // PRICE HISTORY
  // ==========================================================
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

  // ==========================================================
  // STATE SNAPSHOTS (metrics-persistering)
  // ==========================================================
  // Lagrer serialiserte in-memory-strukturer til disk slik at de kan
  // rehydreres etter en restart. Retention: maks 2 rader per type,
  // eldste rad slettes bare hvis det finnes en nyere. Ferskhetsgaranti:
  // hvis ingen rad yngre enn 72t finnes, skrives en fersk uavhengig av
  // om dataen er endret siden sist.
  const stateSnapshots = {
    insert(type, dataJson) {
      return db
        .prepare(
          `
        INSERT INTO state_snapshots (type, data_json) VALUES (?, ?)
      `
        )
        .run(type, dataJson).lastInsertRowid;
    },
    getLatest(type) {
      const row = db
        .prepare(
          `
        SELECT id, type, data_json as dataJson, created_at as createdAt
        FROM state_snapshots
        WHERE type = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
        )
        .get(type);
      return row || null;
    },
    getAllForType(type) {
      return db
        .prepare(
          `
        SELECT id, type, data_json as dataJson, created_at as createdAt
        FROM state_snapshots
        WHERE type = ?
        ORDER BY created_at DESC, id DESC
      `
        )
        .all(type);
    },
    trimToLast(type, keep = 2) {
      const rows = stateSnapshots.getAllForType(type);
      if (rows.length <= keep) return 0;
      const toDelete = rows.slice(keep).map((r) => r.id);
      const del = db.prepare('DELETE FROM state_snapshots WHERE id = ?');
      const tx = db.transaction(() => {
        for (const id of toDelete) del.run(id);
      });
      tx();
      return toDelete.length;
    },
  };

  // ==========================================================
  // RECEIPTS (Iterasjon 2: kvittering-ingest)
  // ==========================================================
  const receipts = {
    insert(rec) {
      return db
        .prepare(
          `
        INSERT INTO receipts (
          file_path, mime_type, file_size_bytes, sha256, merchant,
          purchased_at, total_nok, currency, raw_text, llm_model, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
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
      const row = db
        .prepare(
          `
        SELECT id, file_path as filePath, mime_type as mimeType, file_size_bytes as fileSizeBytes,
               sha256, merchant, purchased_at as purchasedAt, total_nok as totalNok,
               currency, raw_text as rawText, llm_model as llmModel, status,
               error_message as errorMessage, created_at as createdAt, confirmed_at as confirmedAt
        FROM receipts WHERE sha256 = ?
      `
        )
        .get(sha);
      return row || null;
    },
    getById(id) {
      const row = db
        .prepare(
          `
        SELECT id, file_path as filePath, mime_type as mimeType, file_size_bytes as fileSizeBytes,
               sha256, merchant, purchased_at as purchasedAt, total_nok as totalNok,
               currency, raw_text as rawText, llm_model as llmModel, status,
               error_message as errorMessage, created_at as createdAt, confirmed_at as confirmedAt
        FROM receipts WHERE id = ?
      `
        )
        .get(id);
      return row || null;
    },
    list({ status = null, limit = 50 } = {}) {
      if (status) {
        return db
          .prepare(
            `
          SELECT id, merchant, purchased_at as purchasedAt, total_nok as totalNok,
                 status, created_at as createdAt, confirmed_at as confirmedAt
          FROM receipts WHERE status = ?
          ORDER BY created_at DESC, id DESC LIMIT ?
        `
          )
          .all(status, limit);
      }
      return db
        .prepare(
          `
        SELECT id, merchant, purchased_at as purchasedAt, total_nok as totalNok,
               status, created_at as createdAt, confirmed_at as confirmedAt
        FROM receipts ORDER BY created_at DESC, id DESC LIMIT ?
      `
        )
        .all(limit);
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
         WHERE id = ?
      `
      ).run(
        merchant ?? null,
        purchasedAt ?? null,
        totalNok ?? null,
        rawText ?? null,
        llmModel ?? null,
        status,
        errorMessage,
        id
      );
    },
    markStatus(id, status, { errorMessage = null } = {}) {
      const confirmedAt = status === 'confirmed' ? new Date().toISOString() : null;
      db.prepare(
        `
        UPDATE receipts SET status = ?, error_message = ?, confirmed_at = COALESCE(?, confirmed_at)
        WHERE id = ?
      `
      ).run(status, errorMessage, confirmedAt, id);
    },
    remove(id) {
      db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
    },
    stats() {
      const rows = db
        .prepare(
          `
        SELECT status, COUNT(*) as c FROM receipts GROUP BY status
      `
        )
        .all();
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
      const ins = db.prepare(`
        INSERT INTO receipt_items (
          receipt_id, line_text, product_key, product_name, qty, unit,
          unit_price, total_price, discount, ean, confidence, flagged_reason,
          kassal_product_id, resolution_candidates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const it of items) {
          ins.run(
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
      const rows = db
        .prepare(
          `
        SELECT id, receipt_id as receiptId, line_text as lineText,
               product_key as productKey, product_name as productName,
               qty, unit, unit_price as unitPrice, total_price as totalPrice,
               discount, ean, confidence, confirmed, flagged_reason as flaggedReason,
               kassal_product_id as kassalProductId,
               resolution_candidates_json as resolutionCandidatesJson
        FROM receipt_items WHERE receipt_id = ? ORDER BY id
      `
        )
        .all(receiptId);
      return rows.map((r) => ({
        ...r,
        resolutionCandidates: r.resolutionCandidatesJson
          ? JSON.parse(r.resolutionCandidatesJson)
          : null,
      }));
    },
    updateItem(id, fields) {
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
      vals.push(id);
      db.prepare(`UPDATE receipt_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    },
    removeByReceipt(receiptId) {
      db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(receiptId);
    },
  };

  // ==========================================================
  // KASSAL PRODUCTS — katalog over SKUer familien har berørt
  // ==========================================================
  const kassalProducts = {
    /**
     * Upsert basert på kassal_id (stable id fra Kassal).
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

  // ==========================================================
  // PRODUCT RESOLUTIONS — mange-til-mange product_key ↔ SKU
  // ==========================================================
  const productResolutions = {
    /**
     * Registrér at vi "så" en resolution (upload-fasen). times_seen++.
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

  // ==========================================================
  // KASSAL CACHE — HTTP-request-cache
  // ==========================================================
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

  // ==========================================================
  // LLM AUDIT
  // ==========================================================
  const llmAudit = {
    log({ toolName, arguments: args, result, success, userMessage }) {
      db.prepare(
        `
        INSERT INTO llm_audit (tool_name, arguments, result, success, user_message)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        toolName,
        args ? JSON.stringify(args) : null,
        result ? JSON.stringify(result).slice(0, 4000) : null,
        success ? 1 : 0,
        userMessage || null
      );
    },
    getRecent(limit = 50) {
      return db.prepare(`SELECT * FROM llm_audit ORDER BY timestamp DESC LIMIT ?`).all(limit);
    },
  };

  // ==========================================================
  // FASE F3 – Family profile + filter usage
  // ==========================================================
  const familyProfile = {
    get() {
      try {
        const r = db.prepare('SELECT * FROM family_profile WHERE id = 1').get();
        if (!r) {
          return { members: [], allergies: [], dislikes: [], preferences: {} };
        }
        return {
          members: JSON.parse(r.members || '[]'),
          allergies: JSON.parse(r.allergies || '[]'),
          dislikes: JSON.parse(r.dislikes || '[]'),
          preferences: JSON.parse(r.preferences || '{}'),
          updatedAt: r.updated_at,
        };
      } catch (err) {
        // Fallback hvis tabellen ikke finnes (eldre DB)
        return { members: [], allergies: [], dislikes: [], preferences: {} };
      }
    },
    update(profile) {
      const current = familyProfile.get();
      const merged = {
        members: profile.members ?? current.members,
        allergies: profile.allergies ?? current.allergies,
        dislikes: profile.dislikes ?? current.dislikes,
        preferences: profile.preferences ?? current.preferences,
      };
      db.prepare(
        `
        INSERT INTO family_profile (id, members, allergies, dislikes, preferences, updated_at)
        VALUES (1, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          members = excluded.members,
          allergies = excluded.allergies,
          dislikes = excluded.dislikes,
          preferences = excluded.preferences,
          updated_at = datetime('now')
      `
      ).run(
        JSON.stringify(merged.members),
        JSON.stringify(merged.allergies),
        JSON.stringify(merged.dislikes),
        JSON.stringify(merged.preferences)
      );
      return merged;
    },
  };

  const filterUsage = {
    recordUsage(filterId, action) {
      if (!filterId) return;
      const isEnable = action === 'enabled' || action === 'enable';
      const col = isEnable ? 'enable_count' : 'disable_count';
      try {
        db.prepare(
          `
          INSERT INTO filter_usage (filter_id, ${col}, last_used_at)
          VALUES (?, 1, datetime('now'))
          ON CONFLICT(filter_id) DO UPDATE SET
            ${col} = ${col} + 1,
            last_used_at = datetime('now')
        `
        ).run(filterId);
      } catch (err) {
        /* robust mot eldre DB */
      }
    },
    getTopN(n = 3) {
      try {
        return db
          .prepare(
            `
          SELECT filter_id as filterId, enable_count as enableCount,
                 disable_count as disableCount, last_used_at as lastUsedAt
          FROM filter_usage
          WHERE enable_count > 0
          ORDER BY enable_count DESC, last_used_at DESC
          LIMIT ?
        `
          )
          .all(n);
      } catch (err) {
        return [];
      }
    },
    getAll() {
      try {
        return db
          .prepare(
            `
          SELECT filter_id as filterId, enable_count as enableCount,
                 disable_count as disableCount, last_used_at as lastUsedAt
          FROM filter_usage
          ORDER BY enable_count DESC
        `
          )
          .all();
      } catch (err) {
        return [];
      }
    },
  };

  // ==========================================================
  // FASE F7 – Recipe sources
  // ==========================================================
  const recipeSources = {
    getAll() {
      try {
        return db
          .prepare(
            `
          SELECT id, url, type, label, last_sync_at as lastSyncAt,
                 last_sync_count as lastSyncCount, enabled, added_at as addedAt
          FROM recipe_sources
          ORDER BY added_at DESC
        `
          )
          .all()
          .map((r) => ({ ...r, enabled: !!r.enabled }));
      } catch (err) {
        return [];
      }
    },
    getEnabled() {
      try {
        return db
          .prepare(
            `
          SELECT id, url, type, label, last_sync_at as lastSyncAt,
                 last_sync_count as lastSyncCount, enabled, added_at as addedAt
          FROM recipe_sources
          WHERE enabled = 1
          ORDER BY COALESCE(last_sync_at, '1970-01-01') ASC
        `
          )
          .all()
          .map((r) => ({ ...r, enabled: !!r.enabled }));
      } catch (err) {
        return [];
      }
    },
    getById(id) {
      try {
        const r = db
          .prepare(
            `
          SELECT id, url, type, label, last_sync_at as lastSyncAt,
                 last_sync_count as lastSyncCount, enabled, added_at as addedAt
          FROM recipe_sources WHERE id = ?
        `
          )
          .get(id);
        return r ? { ...r, enabled: !!r.enabled } : null;
      } catch (err) {
        return null;
      }
    },
    insert({ url, type, label }) {
      const info = db
        .prepare(
          `
        INSERT INTO recipe_sources (url, type, label, enabled)
        VALUES (?, ?, ?, 1)
      `
        )
        .run(url, type, label || null);
      return info.lastInsertRowid;
    },
    delete(id) {
      db.prepare('DELETE FROM recipe_sources WHERE id = ?').run(id);
    },
    setEnabled(id, enabled) {
      db.prepare('UPDATE recipe_sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    },
    updateSyncMeta(id, { lastSyncAt, lastSyncCount }) {
      db.prepare(
        `
        UPDATE recipe_sources
           SET last_sync_at = ?, last_sync_count = ?
         WHERE id = ?
      `
      ).run(lastSyncAt, lastSyncCount || 0, id);
    },
  };

  // ==========================================================
  // SBOM-6: Audit log repository (migration 012)
  // Append-only log over destruktive API-operasjoner.
  // ==========================================================
  const auditLog = {
    /**
     * Registrer en audit-hendelse.
     * @param {object} entry
     * @param {string} entry.requestId   - X-Request-Id (uuid)
     * @param {string} [entry.actor]     - brukeridentifikator (default: 'local')
     * @param {string} entry.action      - 'DELETE' | 'PUT' | 'PATCH' | 'POST'
     * @param {string} entry.entityType  - ressurs-type (f.eks. 'recipe')
     * @param {string|number} [entry.entityId]
     * @param {string} entry.route       - full HTTP-path, f.eks. '/api/recipes/42'
     * @param {object} [entry.before]    - objekt før endring (hashes)
     * @param {object} [entry.after]     - objekt etter endring (hashes)
     * @param {object} [entry.metadata]  - ekstra context (små key-val)
     */
    record(entry) {
      const crypto = require('crypto');
      const hash = (obj) => {
        if (obj == null) return null;
        const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
        return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
      };
      try {
        db.prepare(
          `
          INSERT INTO audit_log
            (request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          entry.requestId || 'unknown',
          entry.actor || 'local',
          entry.action,
          entry.entityType,
          entry.entityId != null ? String(entry.entityId) : null,
          entry.route,
          hash(entry.before),
          hash(entry.after),
          entry.metadata ? JSON.stringify(entry.metadata).slice(0, 2000) : null
        );
      } catch (err) {
        // Audit-feil skal aldri tørke ut hovedoperasjonen. Logg stille.
        if (process.env.NODE_ENV !== 'test') {
          console.error('[audit] kunne ikke skrive til audit_log:', err.message);
        }
      }
    },

    /** Hent siste N hendelser (DESC på timestamp). */
    getRecent(limit = 100) {
      return db
        .prepare(
          `SELECT id, timestamp, request_id as requestId, actor, action,
                  entity_type as entityType, entity_id as entityId, route,
                  before_hash as beforeHash, after_hash as afterHash, metadata
           FROM audit_log ORDER BY id DESC LIMIT ?`
        )
        .all(Math.max(1, Math.min(500, limit)))
        .map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
    },

    /** Filtrer på entity_type + (optional) entity_id. */
    getByEntity(entityType, entityId = null, limit = 100) {
      if (entityId != null) {
        return db
          .prepare(
            `SELECT id, timestamp, request_id as requestId, actor, action,
                    entity_type as entityType, entity_id as entityId, route,
                    before_hash as beforeHash, after_hash as afterHash, metadata
             FROM audit_log
             WHERE entity_type = ? AND entity_id = ?
             ORDER BY id DESC LIMIT ?`
          )
          .all(entityType, String(entityId), Math.max(1, Math.min(500, limit)))
          .map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
      }
      return db
        .prepare(
          `SELECT id, timestamp, request_id as requestId, actor, action,
                  entity_type as entityType, entity_id as entityId, route,
                  before_hash as beforeHash, after_hash as afterHash, metadata
           FROM audit_log
           WHERE entity_type = ?
           ORDER BY id DESC LIMIT ?`
        )
        .all(entityType, Math.max(1, Math.min(500, limit)))
        .map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
    },

    /** Statistikk for /api/audit/stats — brukes av dashboards. */
    stats() {
      const total = db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
      const byAction = db
        .prepare('SELECT action, COUNT(*) as c FROM audit_log GROUP BY action')
        .all();
      const byEntity = db
        .prepare(
          'SELECT entity_type, COUNT(*) as c FROM audit_log GROUP BY entity_type ORDER BY c DESC LIMIT 10'
        )
        .all();
      return { total, byAction, byEntity };
    },
  };

  return {
    _db: db,
    products,
    recipes,
    inventory,
    mealPlans,
    chores,
    choreSchedules,
    shoppingExtras,
    shoppingLists,
    consumables,
    kb,
    calendar,
    notifications,
    purchaseLog,
    mealHistory,
    sundayDrafts,
    llmAudit,
    llmCache,
    inventoryLog,
    priceReferences,
    priceHistory,
    stateSnapshots,
    receipts,
    receiptItems,
    kassalProducts,
    productResolutions,
    kassalCache,
    familyProfile,
    filterUsage,
    recipeSources,
    auditLog,
    hasFTS,
    transaction: (fn) => db.transaction(fn),
  };
}

module.exports = { createRepositories };
