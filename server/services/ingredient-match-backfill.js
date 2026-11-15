'use strict';

const { matchCatalogKey } = require('./recipe-library/catalog-match');

function rate(matched, total) {
  return {
    total,
    matched,
    rate: total === 0 ? 0 : matched / total,
  };
}

/**
 * Fill empty product keys on library and family ingredients.
 * Existing keys and every other column stay as they are. Safe to run
 * again: a second pass updates nothing.
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} productsMap
 */
function backfillIngredientMatches(db, productsMap) {
  const tables = [
    {
      name: 'recipe_library_ingredients',
      id: 'id',
      nameCol: 'name',
      keyCol: 'product_key',
    },
    {
      name: 'recipe_ingredients',
      id: 'id',
      nameCol: 'name',
      keyCol: 'product_key',
    },
  ];
  const report = {};
  const tx = db.transaction(() => {
    for (const table of tables) {
      const before = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN ${table.keyCol} IS NOT NULL AND ${table.keyCol} != '' THEN 1 ELSE 0 END) AS matched
             FROM ${table.name}`
        )
        .get();
      const pending = db
        .prepare(
          `SELECT ${table.id} AS id, ${table.nameCol} AS name
             FROM ${table.name}
            WHERE ${table.keyCol} IS NULL OR ${table.keyCol} = ''`
        )
        .all();
      const update = db.prepare(
        `UPDATE ${table.name} SET ${table.keyCol} = ? WHERE ${table.id} = ? AND (${table.keyCol} IS NULL OR ${table.keyCol} = '')`
      );
      let updated = 0;
      for (const row of pending) {
        const key = matchCatalogKey(row.name, productsMap);
        if (!key) continue;
        updated += update.run(key, row.id).changes;
      }
      const after = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN ${table.keyCol} IS NOT NULL AND ${table.keyCol} != '' THEN 1 ELSE 0 END) AS matched
             FROM ${table.name}`
        )
        .get();
      report[table.name] = {
        before: rate(Number(before.matched) || 0, Number(before.total) || 0),
        after: rate(Number(after.matched) || 0, Number(after.total) || 0),
        updated,
      };
    }
  });
  tx();
  return report;
}

module.exports = { backfillIngredientMatches };
