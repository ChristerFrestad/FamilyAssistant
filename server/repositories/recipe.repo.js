'use strict';

const { getFamilyId } = require('../auth/family-context');

function createRecipeRepos(db, tryParseJson) {
  // Pre-compiled prepared statements for hot queries.
  const _recipeByIdStmt = db.prepare('SELECT * FROM recipes WHERE family_id = ? AND id = ?');
  const _recipeIngsStmt = db.prepare(
    `SELECT id, product_key as productKey, name, qty, unit, optional, sort_order
     FROM recipe_ingredients WHERE family_id = ? AND recipe_id = ? ORDER BY sort_order, id`
  );

  const recipes = {
    getById(id) {
      const familyId = getFamilyId();
      const recipe = _recipeByIdStmt.get(familyId, id);
      if (!recipe) return null;
      recipe.ingredients = _recipeIngsStmt.all(familyId, id);
      recipe.equipment = recipe.equipment_json ? tryParseJson(recipe.equipment_json) || [] : [];
      recipe.prepTime = recipe.prep_time;
      recipe.sourceType = recipe.source_type || 'manual';
      return recipe;
    },
    getAll() {
      const familyId = getFamilyId();
      const rows = db
        .prepare('SELECT * FROM recipes WHERE family_id = ? ORDER BY category, name')
        .all(familyId);
      const ingsByRecipe = {};
      const allIngs = db
        .prepare(
          `
        SELECT recipe_id, id, product_key as productKey, name, qty, unit, optional, sort_order
        FROM recipe_ingredients WHERE family_id = ? ORDER BY sort_order, id
      `
        )
        .all(familyId);
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
        equipment: r.equipment_json ? tryParseJson(r.equipment_json) || [] : [],
      }));
    },
    getByCategory(category) {
      const familyId = getFamilyId();
      const rows = db
        .prepare('SELECT * FROM recipes WHERE family_id = ? AND category = ? ORDER BY name')
        .all(familyId, category);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const allIngs = db
        .prepare(
          `SELECT recipe_id, id, product_key as productKey, name, qty, unit, optional, sort_order
           FROM recipe_ingredients
           WHERE family_id = ? AND recipe_id IN (${placeholders})
           ORDER BY sort_order, id`
        )
        .all(familyId, ...ids);
      const ingsByRecipe = {};
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
        equipment: r.equipment_json ? tryParseJson(r.equipment_json) || [] : [],
      }));
    },
    insert(r) {
      const familyId = getFamilyId();
      return db.transaction(() => {
        const result = db
          .prepare(
            `
          INSERT INTO recipes (family_id, name, category, prep_time, source, url, pinterest_url, servings, equipment_json, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            familyId,
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
            INSERT INTO recipe_ingredients (family_id, recipe_id, product_key, name, qty, unit, optional, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          r.ingredients.forEach((ing, idx) => {
            ins.run(
              familyId,
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
      })();
    },
    count() {
      const familyId = getFamilyId();
      return db.prepare('SELECT COUNT(*) as c FROM recipes WHERE family_id = ?').get(familyId).c;
    },
    // Fuzzy name lookup used by meal-swap to see if a user-typed term
    // already exists in the family's library before calling the LLM.
    // Prefers exact match (case-insensitive), then LIKE %name%, ordered
    // by times_cooked DESC so a frequently-used recipe wins on ties.
    //
    // Case-folding is done in JavaScript because SQLite's LOWER() and
    // COLLATE NOCASE only handle ASCII — they would not match Norwegian
    // characters like æ/ø/å (e.g. 'KJØTTDEIG' vs 'kjøttdeig'). We scan
    // all of the family's recipes and filter in JS; families have at most
    // a few hundred recipes so the cost is negligible.
    findByName(name) {
      const familyId = getFamilyId();
      const t = String(name || '').trim();
      if (!t) return null;
      const lowered = t.toLowerCase();
      const rows = db
        .prepare('SELECT * FROM recipes WHERE family_id = ? ORDER BY times_cooked DESC, id')
        .all(familyId);
      let row = rows.find((r) => String(r.name || '').toLowerCase() === lowered);
      if (!row) {
        row = rows.find((r) =>
          String(r.name || '')
            .toLowerCase()
            .includes(lowered)
        );
      }
      if (!row) return null;
      row.ingredients = _recipeIngsStmt.all(familyId, row.id);
      row.equipment = row.equipment_json ? tryParseJson(row.equipment_json) || [] : [];
      row.prepTime = row.prep_time;
      row.sourceType = row.source_type || 'manual';
      return row;
    },
  };

  const recipeSources = {
    getAll() {
      const familyId = getFamilyId();
      try {
        return db
          .prepare(
            `
          SELECT id, url, type, label, last_sync_at as lastSyncAt,
                 last_sync_count as lastSyncCount, enabled, added_at as addedAt
          FROM recipe_sources
          WHERE family_id = ?
          ORDER BY added_at DESC
        `
          )
          .all(familyId)
          .map((r) => ({ ...r, enabled: !!r.enabled }));
      } catch {
        return [];
      }
    },
    getEnabled() {
      const familyId = getFamilyId();
      try {
        return db
          .prepare(
            `
          SELECT id, url, type, label, last_sync_at as lastSyncAt,
                 last_sync_count as lastSyncCount, enabled, added_at as addedAt
          FROM recipe_sources
          WHERE family_id = ? AND enabled = 1
          ORDER BY COALESCE(last_sync_at, '1970-01-01') ASC
        `
          )
          .all(familyId)
          .map((r) => ({ ...r, enabled: !!r.enabled }));
      } catch {
        return [];
      }
    },
    getById(id) {
      const familyId = getFamilyId();
      try {
        const r = db
          .prepare(
            `
          SELECT id, url, type, label, last_sync_at as lastSyncAt,
                 last_sync_count as lastSyncCount, enabled, added_at as addedAt
          FROM recipe_sources WHERE family_id = ? AND id = ?
        `
          )
          .get(familyId, id);
        return r ? { ...r, enabled: !!r.enabled } : null;
      } catch {
        return null;
      }
    },
    insert({ url, type, label }) {
      const familyId = getFamilyId();
      const info = db
        .prepare(
          `
        INSERT INTO recipe_sources (family_id, url, type, label, enabled)
        VALUES (?, ?, ?, ?, 1)
      `
        )
        .run(familyId, url, type, label || null);
      return info.lastInsertRowid;
    },
    delete(id) {
      const familyId = getFamilyId();
      db.prepare('DELETE FROM recipe_sources WHERE family_id = ? AND id = ?').run(familyId, id);
    },
    setEnabled(id, enabled) {
      const familyId = getFamilyId();
      db.prepare('UPDATE recipe_sources SET enabled = ? WHERE family_id = ? AND id = ?').run(
        enabled ? 1 : 0,
        familyId,
        id
      );
    },
    updateSyncMeta(id, { lastSyncAt, lastSyncCount }) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE recipe_sources
           SET last_sync_at = ?, last_sync_count = ?
         WHERE family_id = ? AND id = ?
      `
      ).run(lastSyncAt, lastSyncCount || 0, familyId, id);
    },
  };

  return { recipes, recipeSources };
}

module.exports = { createRecipeRepos };
