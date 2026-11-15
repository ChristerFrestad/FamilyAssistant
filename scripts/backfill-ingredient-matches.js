'use strict';

// Re-match ingredient lines that have no product key. Does not delete
// rows and does not replace a key that is already set. Prints the match
// rate before and after. Safe to run more than once.
//
//   node scripts/backfill-ingredient-matches.js
//   DB_PATH=/path/to/familieassistenten.db node scripts/backfill-ingredient-matches.js

const path = require('path');
const Database = require('better-sqlite3');
const { backfillIngredientMatches } = require('../server/services/ingredient-match-backfill');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'familieassistenten.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const products = {};
for (const row of db.prepare('SELECT key FROM products').all()) {
  products[row.key] = true;
}
const report = backfillIngredientMatches(db, products);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
db.close();
