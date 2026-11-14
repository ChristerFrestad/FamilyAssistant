'use strict';

function createRecipeLibraryRepo(db) {
  const upsertRecipe = db.prepare(`
    INSERT INTO recipe_library (
      title, source_name, canonical_url, image_url, servings,
      total_time_min, category, fetched_at, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(canonical_url) DO UPDATE SET
      title = excluded.title,
      source_name = excluded.source_name,
      image_url = excluded.image_url,
      servings = excluded.servings,
      total_time_min = excluded.total_time_min,
      category = excluded.category,
      fetched_at = excluded.fetched_at,
      active = 1
  `);
  const deleteIngredients = db.prepare(
    'DELETE FROM recipe_library_ingredients WHERE library_id = ?'
  );
  const insertIngredient = db.prepare(`
    INSERT INTO recipe_library_ingredients (
      library_id, raw_line, qty, unit, name, product_key, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const idByUrl = db.prepare('SELECT id FROM recipe_library WHERE canonical_url = ?');

  return {
    upsert(record) {
      const tx = db.transaction(() => {
        upsertRecipe.run(
          record.title,
          record.sourceName,
          record.canonicalUrl,
          record.imageUrl ?? null,
          record.servings ?? null,
          record.totalTimeMin ?? null,
          record.category ?? null,
          record.fetchedAt
        );
        const row = idByUrl.get(record.canonicalUrl);
        const libraryId = row.id;
        deleteIngredients.run(libraryId);
        (record.ingredients || []).forEach((ing, idx) => {
          insertIngredient.run(
            libraryId,
            ing.rawLine,
            ing.qty ?? null,
            ing.unit ?? null,
            ing.name,
            ing.productKey ?? null,
            idx
          );
        });
        return libraryId;
      });
      return tx();
    },
    getById(id) {
      const recipe = db.prepare('SELECT * FROM recipe_library WHERE id = ?').get(id);
      if (!recipe) return null;
      recipe.ingredients = db
        .prepare(
          `SELECT raw_line as rawLine, qty, unit, name, product_key as productKey, sort_order as sortOrder
           FROM recipe_library_ingredients WHERE library_id = ? ORDER BY sort_order, id`
        )
        .all(id);
      return recipe;
    },
    getFetch(url) {
      return db.prepare('SELECT * FROM recipe_library_fetch WHERE url = ?').get(url) || null;
    },
    saveFetch(row) {
      db.prepare(
        `INSERT INTO recipe_library_fetch (
           url, source_name, etag, last_modified, http_status, error, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           etag = excluded.etag,
           last_modified = excluded.last_modified,
           http_status = excluded.http_status,
           error = excluded.error,
           fetched_at = excluded.fetched_at`
      ).run(
        row.url,
        row.sourceName,
        row.etag ?? null,
        row.lastModified ?? null,
        row.httpStatus ?? null,
        row.error ?? null,
        row.fetchedAt
      );
    },
  };
}

module.exports = { createRecipeLibraryRepo };
