// Diagnose script for pantry auto-add bug.
// Reads recent shopping_list_items + inventory + inventory_log to verify
// the hypothesis that manuelle items (productKey IS NULL) never make it
// into the inventory table even when toggled "kjøpt".

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'familieassistenten.db');
const db = new Database(DB_PATH, { readonly: true });

console.log(`Reading: ${DB_PATH}\n`);

console.log('=== Recent shopping_list_items (last 20) ===');
const items = db
  .prepare(
    `SELECT id, list_id, product_key, ingredient_name, qty, unit, source_type,
            bought_at, bought_qty, needs_buy
       FROM shopping_list_items
      ORDER BY id DESC
      LIMIT 20`
  )
  .all();
console.log(JSON.stringify(items, null, 2));

console.log('\n=== Manuelt-addede items (source_type = "manual") som er bought ===');
const manualBought = db
  .prepare(
    `SELECT id, product_key, ingredient_name, qty, unit, bought_at, bought_qty
       FROM shopping_list_items
      WHERE source_type = 'manual'
        AND bought_at IS NOT NULL
      ORDER BY bought_at DESC
      LIMIT 20`
  )
  .all();
console.log(JSON.stringify(manualBought, null, 2));

console.log('\n=== Inventory state (alle non-zero rows) ===');
const inv = db
  .prepare(
    `SELECT product_key, qty_remaining, total_size, unit, last_purchased, expires_est
       FROM inventory
      WHERE qty_remaining > 0
      ORDER BY last_purchased DESC`
  )
  .all();
console.log(JSON.stringify(inv, null, 2));

console.log('\n=== inventory_log siste 10 entries ===');
const log = db
  .prepare(
    `SELECT product_key, qty_delta, new_qty, unit, reason, source_table, source_id, logged_at
       FROM inventory_log
      ORDER BY id DESC
      LIMIT 10`
  )
  .all();
console.log(JSON.stringify(log, null, 2));

console.log('\n=== Sammenligning: hvor mange manuelle items er kjøpt vs i inventory ===');
const manualBoughtCount = manualBought.length;
const inventoryCount = inv.length;
console.log(`manuelle items kjøpt:                  ${manualBoughtCount}`);
console.log(`inventory rows non-zero:               ${inventoryCount}`);
console.log(
  `manuelle items i inventory:            ${
    manualBought.filter((m) => m.product_key && inv.some((i) => i.product_key === m.product_key))
      .length
  }`
);
console.log(
  `manuelle items UTEN product_key:       ${manualBought.filter((m) => !m.product_key).length}`
);

db.close();
