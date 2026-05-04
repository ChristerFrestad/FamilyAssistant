'use strict';

// Read-only inspection of family-1 orphan state.
// Used to verify cleanup-orphan-family-1.js is safe to run.
//
// Usage:
//   node scripts/inspect-family-1-state.js

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'familieassistenten.db');

console.log(`Reading DB: ${DB_PATH}`);
console.log('');

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// 1) Schema state
console.log('=== Schema migrations applied ===');
const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
console.log(`  Latest: ${migrations[migrations.length - 1].version}`);
console.log(`  Total: ${migrations.length}`);

// 2) Families
console.log('');
console.log('=== Families ===');
const families = db
  .prepare('SELECT id, name, owner_user_id, created_at FROM families ORDER BY id')
  .all();
families.forEach((f) => {
  console.log(
    `  id=${f.id}  name='${f.name}'  owner_user_id=${f.owner_user_id ?? 'NULL'}  created=${f.created_at}`
  );
});

// 3) Users by family_id
console.log('');
console.log('=== Users by family_id ===');
const users = db.prepare('SELECT id, email, family_id FROM users ORDER BY family_id, id').all();
users.forEach((u) => {
  console.log(`  user id=${u.id}  email=${u.email}  family_id=${u.family_id}`);
});

// 4) Per-family row counts across all per-family tables
console.log('');
console.log('=== Per-family row counts ===');
const PER_FAMILY_TABLES = [
  'recipes',
  'recipe_ingredients',
  'meal_plans',
  'meal_history',
  'shopping_lists',
  'shopping_list_items',
  'shopping_extras',
  'inventory',
  'inventory_log',
  'pantry',
  'consumables',
  'consumable_log',
  'purchase_log',
  'chores',
  'chore_completions',
  'chore_schedules',
  'family_profile',
  'family_profile_members',
  'audit_log',
  'calendar_events',
  'knowledge_base',
  'llm_audit',
  'notifications',
  'receipts',
  'receipt_items',
];

for (const table of PER_FAMILY_TABLES) {
  try {
    const rows = db
      .prepare(
        `SELECT family_id, COUNT(*) as cnt FROM ${table} GROUP BY family_id ORDER BY family_id`
      )
      .all();
    if (rows.length === 0) continue;
    const summary = rows.map((r) => `family_id=${r.family_id ?? 'NULL'}: ${r.cnt}`).join(', ');
    console.log(`  ${table}: ${summary}`);
  } catch (err) {
    if (err.message.includes('no such table') || err.message.includes('no such column')) {
      // Some tables in the PER_FAMILY_TABLES list may not exist on this DB version
      // (e.g. consumables, calendar_events) — skip silently.
      continue;
    }
    throw err;
  }
}

// 5) Sessions per user (verify Christer's session count)
console.log('');
console.log('=== Sessions per user ===');
const sessions = db
  .prepare('SELECT user_id, COUNT(*) as cnt FROM sessions GROUP BY user_id ORDER BY user_id')
  .all();
sessions.forEach((s) => console.log(`  user_id=${s.user_id}: ${s.cnt} sessions`));

// 6) FK enforcement state
console.log('');
console.log('=== FK enforcement ===');
const fk = db.pragma('foreign_keys');
console.log(`  foreign_keys = ${JSON.stringify(fk)}`);

// 7) Verify family 1 has no users (cleanup safety check)
console.log('');
console.log('=== Cleanup safety check ===');
const family1Users = db.prepare('SELECT id, email FROM users WHERE family_id = 1').all();
if (family1Users.length === 0) {
  console.log('  SAFE: family_id=1 has 0 users — cleanup is non-destructive of user data.');
} else {
  console.log(`  UNSAFE: family_id=1 has ${family1Users.length} users:`);
  family1Users.forEach((u) => console.log(`    user id=${u.id} email=${u.email}`));
  console.log('  ABORT cleanup until users are migrated or removed.');
}

db.close();
