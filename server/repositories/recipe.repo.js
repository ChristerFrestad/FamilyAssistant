'use strict';

function createRecipeRepos(db, tryParseJson) {
  // Pre-compiled prepared statements for hyppige queries (unngår gjentatt compile)
  const _recipeByIdStmt = db.prepare('SELECT * FROM recipes WHERE id = ?');
  const _recipeIngsStmt = db.prepare(
    `SELECT id, product_key as productKey, name, qty, unit, optional, sort_order
     FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order, id`
  );

  const recipes = {
    getById(id) {
      const recipe = _recipeByIdStmt.get(id);
      if (!recipe) return null;
      recipe.ingredients = _recipeIngsStmt.all(id);
      recipe.equipment = recipe.equipment_json ? tryParseJson(recipe.equipment_json) || [] : [];
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
        equipment: r.equipment_json ? tryParseJson(r.equipment_json) || [] : [],
      }));
    },
    getByCategory(category) {
      const rows = db
        .prepare('SELECT * FROM recipes WHERE category = ? ORDER BY name')
        .all(category);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const allIngs = db
        .prepare(
          `SELECT recipe_id, id, product_key as productKey, name, qty, unit, optional, sort_order
           FROM recipe_ingredients WHERE recipe_id IN (${placeholders}) ORDER BY sort_order, id`
        )
        .all(...ids);
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
      return db.transaction(() => {
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
      })();
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM recipes').get().c;
    },
  };

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
      } catch {
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
      } catch {
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
      } catch {
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

  return { recipes, recipeSources };
}

module.exports = { createRecipeRepos };
