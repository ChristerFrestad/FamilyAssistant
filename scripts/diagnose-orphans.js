'use strict';

// Diagnostic: find all orphan rows that would violate the FK constraints
// added by migration 024.
//
// Usage: node scripts/diagnose-orphans.js [path-to-db]

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'familieassistenten.db');
console.log(`Inspecting: ${dbPath}\n`);

const db = new Database(dbPath, { readonly: true });
db.pragma('foreign_keys = OFF');

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function rowCount(table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } catch (err) {
    return `(error: ${err.message})`;
  }
}

section('Schema state');
const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
console.log('Applied migrations:', applied.map((r) => r.version).join(', '));

section('Table row counts');
const tables = [
  'families',
  'recipes',
  'recipe_ingredients',
  'chores',
  'chore_schedules',
  'consumables',
  'consumable_log',
  'meal_plans',
  'meal_history',
  'audit_log',
  'calendar_events',
  'inventory_log',
  'knowledge_base',
  'llm_audit',
  'notifications',
  'purchase_log',
  'receipts',
  'receipt_items',
  'shopping_lists',
  'shopping_list_items',
  'shopping_extras',
];
for (const t of tables) {
  console.log(`  ${t.padEnd(25)} ${rowCount(t)}`);
}

section('Families');
const fams = db.prepare('SELECT id, name FROM families ORDER BY id').all();
for (const f of fams) console.log(`  family_id=${f.id} name="${f.name}"`);
const familyIds = new Set(fams.map((f) => f.id));

section('Orphan family_id (would fail families FK)');
const tablesWithFamilyId = [
  'audit_log',
  'calendar_events',
  'chore_schedules',
  'chores',
  'consumable_log',
  'consumables',
  'inventory_log',
  'knowledge_base',
  'llm_audit',
  'meal_history',
  'notifications',
  'purchase_log',
  'receipt_items',
  'recipe_ingredients',
  'recipes',
  'shopping_extras',
  'shopping_list_items',
];
for (const t of tablesWithFamilyId) {
  try {
    const orphans = db
      .prepare(`SELECT family_id, COUNT(*) AS n FROM ${t} GROUP BY family_id`)
      .all();
    const bad = orphans.filter((row) => !familyIds.has(row.family_id));
    if (bad.length > 0) {
      console.log(`  ⚠ ${t}:`);
      for (const r of bad) console.log(`      family_id=${r.family_id} → ${r.n} orphan rows`);
    }
  } catch (err) {
    console.log(`  (skip ${t}: ${err.message})`);
  }
}

section('Orphan FK references on tables that migration 024 rebuilds');

function checkFK(child, childCol, parent, parentCol = 'id') {
  try {
    const orphans = db
      .prepare(
        `SELECT c.${childCol} AS child_val, COUNT(*) AS n
         FROM ${child} c
        WHERE c.${childCol} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.${parentCol} = c.${childCol})
        GROUP BY c.${childCol}`
      )
      .all();
    if (orphans.length > 0) {
      console.log(`  ⚠ ${child}.${childCol} → ${parent}.${parentCol}:`);
      for (const r of orphans) console.log(`      ${childCol}=${r.child_val} → ${r.n} orphan rows`);
    }
  } catch (err) {
    console.log(`  (skip ${child}.${childCol}: ${err.message})`);
  }
}

checkFK('recipe_ingredients', 'recipe_id', 'recipes');
checkFK('chore_schedules', 'chore_id', 'chores');
checkFK('consumable_log', 'consumable_id', 'consumables');
checkFK('meal_history', 'recipe_id', 'recipes');
checkFK('receipt_items', 'receipt_id', 'receipts');
checkFK('shopping_list_items', 'list_id', 'shopping_lists');

section('meal_plans (NOT in migration 024 but referenced in user report)');
checkFK('meal_plans', 'recipe_id', 'recipes');
const mealPlansByFamily = db
  .prepare(
    `SELECT family_id, recipe_id, COUNT(*) AS n FROM meal_plans GROUP BY family_id, recipe_id ORDER BY family_id, recipe_id`
  )
  .all();
console.log('  meal_plans rows by (family_id, recipe_id):');
for (const r of mealPlansByFamily) {
  console.log(`      family_id=${r.family_id} recipe_id=${r.recipe_id} → ${r.n} rows`);
}

section('recipes by family');
const recipesByFamily = db
  .prepare(`SELECT family_id, COUNT(*) AS n FROM recipes GROUP BY family_id ORDER BY family_id`)
  .all();
for (const r of recipesByFamily) {
  console.log(`      family_id=${r.family_id} → ${r.n} recipes`);
}

section('Try migration 024 dry-simulation: PRAGMA foreign_key_check on each rebuilt table');
const rebuiltTables = [
  'recipes',
  'recipe_ingredients',
  'chores',
  'chore_schedules',
  'consumables',
  'consumable_log',
  'audit_log',
  'calendar_events',
  'inventory_log',
  'knowledge_base',
  'llm_audit',
  'meal_history',
  'notifications',
  'purchase_log',
  'receipt_items',
  'shopping_extras',
  'shopping_list_items',
];
console.log('PRAGMA foreign_key_check on each rebuilt table:');
for (const t of rebuiltTables) {
  try {
    const violations = db.prepare(`PRAGMA foreign_key_check(${t})`).all();
    if (violations.length > 0) {
      console.log(`  ⚠ ${t}: ${violations.length} violations`);
      for (const v of violations.slice(0, 5)) console.log(`      ${JSON.stringify(v)}`);
    }
  } catch (err) {
    console.log(`  (skip ${t}: ${err.message})`);
  }
}

section('Global PRAGMA foreign_key_check');
const allViolations = db.prepare(`PRAGMA foreign_key_check`).all();
if (allViolations.length === 0) {
  console.log('  ✓ no FK violations against current schema');
} else {
  console.log(`  ⚠ ${allViolations.length} violations against current schema:`);
  const grouped = {};
  for (const v of allViolations) {
    const key = `${v.table} → ${v.parent} (fkid=${v.fkid})`;
    grouped[key] = (grouped[key] || 0) + 1;
  }
  for (const [k, n] of Object.entries(grouped)) console.log(`      ${k}: ${n}`);
}

db.close();
