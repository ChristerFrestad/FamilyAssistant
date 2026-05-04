'use strict';

// Cleanup script: remove orphan family-1 ("Default Family") and all its
// per-family rows.
//
// Background: docs/analyses/2026-05-03-pre-pilot-comprehensive-audit.md § 2.2
// (CRITICAL C1). Family 1 is leftover seed-data from before PR #91 fixed the
// multi-tenant onboarding flow. It has no users — no human can ever see it
// in the UI — but its rows pollute backups and debugging. This script removes
// it cleanly via the FK CASCADE chain established in migration 024.
//
// Safety:
//   1. Verifies migration 024 is applied (FK CASCADE is wired up).
//   2. Verifies foreign_keys=1 (CASCADE will fire).
//   3. Verifies family 1 has zero users (cleanup never touches user data).
//   4. Aborts loudly if any safety check fails.
//
// Idempotent: if family 1 is already gone, prints a friendly message and
// exits 0. Running twice in a row is safe.
//
// Usage:
//   node scripts/cleanup-orphan-family-1.js --dry-run   # preview only
//   node scripts/cleanup-orphan-family-1.js             # perform cleanup
//   DB_PATH=/custom/path.db node scripts/cleanup-orphan-family-1.js
//
// IMPORTANT: take a backup before running without --dry-run. The script does
// NOT take its own backup — backup-on-demand is left to the operator so that
// a single backup can cover multiple operations in one maintenance window.

const path = require('path');
const Database = require('better-sqlite3');

const DRY_RUN = process.argv.includes('--dry-run');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'familieassistenten.db');

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

function log(msg) {
  process.stdout.write(msg + '\n');
}

function countFamilyRows(db, familyId) {
  const counts = {};
  for (const table of PER_FAMILY_TABLES) {
    try {
      const row = db
        .prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE family_id = ?`)
        .get(familyId);
      if (row.cnt > 0) counts[table] = row.cnt;
    } catch (err) {
      if (err.message.includes('no such table') || err.message.includes('no such column')) {
        // Table may not exist on this DB version — skip silently.
        continue;
      }
      throw err;
    }
  }
  return counts;
}

function main() {
  log(`DB: ${DB_PATH}`);
  log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (will modify DB)'}`);
  log('');

  const db = new Database(DB_PATH, { readonly: false, fileMustExist: true });

  // Safety check 1: migration 024 applied?
  const m024 = db.prepare(`SELECT version FROM schema_migrations WHERE version = '024'`).get();
  if (!m024) {
    log('ABORT: Migration 024 not applied — FK CASCADE chain not in place.');
    log('       Apply pending migrations before running this cleanup.');
    db.close();
    process.exit(1);
  }
  log('Safety check 1/3: migration 024 applied — OK');

  // Safety check 2: FK enforcement?
  const fk = db.pragma('foreign_keys', { simple: true });
  if (fk !== 1) {
    log(`ABORT: PRAGMA foreign_keys is ${fk}, expected 1.`);
    log('       FK CASCADE will not fire without enforcement enabled.');
    db.close();
    process.exit(1);
  }
  log('Safety check 2/3: foreign_keys = 1 — OK');

  // Idempotency check: does family 1 still exist?
  const family1 = db.prepare(`SELECT id, name FROM families WHERE id = 1`).get();
  if (!family1) {
    log('');
    log('Family 1 does not exist — nothing to clean up.');
    log('This script is idempotent; previous run already cleaned it.');
    db.close();
    process.exit(0);
  }
  log(`Found family 1: name='${family1.name}'`);

  // Safety check 3: family 1 has zero users?
  const users = db.prepare(`SELECT id, email FROM users WHERE family_id = 1`).all();
  if (users.length > 0) {
    log(`ABORT: family_id=1 has ${users.length} active user(s):`);
    users.forEach((u) => log(`         user id=${u.id} email=${u.email}`));
    log('       Migrate or remove these users before deleting family 1.');
    db.close();
    process.exit(1);
  }
  log('Safety check 3/3: family 1 has 0 users — SAFE to delete');
  log('');

  // Print before-state for family 1
  log('=== BEFORE: family 1 row counts ===');
  const beforeFam1 = countFamilyRows(db, 1);
  if (Object.keys(beforeFam1).length === 0) {
    log('  (no rows in any per-family table)');
  } else {
    Object.entries(beforeFam1).forEach(([t, n]) => log(`  ${t}: ${n}`));
  }

  // Print before-state for family 3 (Christer's) for diff verification
  log('');
  log('=== BEFORE: family 3 row counts (for verification) ===');
  const beforeFam3 = countFamilyRows(db, 3);
  Object.entries(beforeFam3).forEach(([t, n]) => log(`  ${t}: ${n}`));

  // Detect cross-family pollution: rows in OTHER families that reference
  // family-1 entities via NO ACTION FKs (meal_plans.recipe_id,
  // meal_history.recipe_id, chore_schedules.chore_id, consumable_log.consumable_id).
  // These are leftovers from the pre-PR-#91 onboarding bug (see
  // docs/analyses/2026-05-02-multi-tenant-audit.md). They must be repointed
  // (or nulled) before family 1's parent rows can be deleted.
  log('');
  log('=== Cross-family pollution scan ===');
  const crossMealPlans = db
    .prepare(
      `SELECT mp.id, mp.family_id AS mp_fam, mp.recipe_id, r.name AS recipe_name
       FROM meal_plans mp
       JOIN recipes r ON r.id = mp.recipe_id AND r.family_id = 1
       WHERE mp.family_id != 1`
    )
    .all();
  const crossMealHistory = db
    .prepare(
      `SELECT mh.id, mh.family_id AS mh_fam, mh.recipe_id, r.name AS recipe_name
       FROM meal_history mh
       JOIN recipes r ON r.id = mh.recipe_id AND r.family_id = 1
       WHERE mh.family_id != 1`
    )
    .all();
  const crossChoreSchedules = db
    .prepare(
      `SELECT cs.id, cs.family_id AS cs_fam, cs.chore_id, c.task AS chore_name
       FROM chore_schedules cs
       JOIN chores c ON c.id = cs.chore_id AND c.family_id = 1
       WHERE cs.family_id != 1`
    )
    .all();
  const crossConsumableLog = db
    .prepare(
      `SELECT cl.id, cl.family_id AS cl_fam, cl.consumable_id, c.name AS consumable_name
       FROM consumable_log cl
       JOIN consumables c ON c.id = cl.consumable_id AND c.family_id = 1
       WHERE cl.family_id != 1`
    )
    .all();

  log(`  meal_plans cross-pointing to family 1 recipes: ${crossMealPlans.length}`);
  log(`  meal_history cross-pointing to family 1 recipes: ${crossMealHistory.length}`);
  log(`  chore_schedules cross-pointing to family 1 chores: ${crossChoreSchedules.length}`);
  log(`  consumable_log cross-pointing to family 1 consumables: ${crossConsumableLog.length}`);

  // Build repoint plans (by name match) for each cross-family set.
  function buildRepointPlan(rows, lookupTable, lookupCol) {
    if (rows.length === 0) return [];
    const findStmt = db.prepare(
      `SELECT id FROM ${lookupTable} WHERE family_id = ? AND ${lookupCol} = ?`
    );
    return rows.map((row) => {
      const targetFam = row.mp_fam ?? row.mh_fam ?? row.cs_fam ?? row.cl_fam;
      const refName = row.recipe_name ?? row.chore_name ?? row.consumable_name;
      const target = findStmt.get(targetFam, refName);
      return {
        ...row,
        targetId: target ? target.id : null,
        targetFam,
        refName,
      };
    });
  }
  const mealPlanPlan = buildRepointPlan(crossMealPlans, 'recipes', 'name');
  const mealHistoryPlan = buildRepointPlan(crossMealHistory, 'recipes', 'name');
  const choreSchedulePlan = buildRepointPlan(crossChoreSchedules, 'chores', 'task');
  const consumableLogPlan = buildRepointPlan(crossConsumableLog, 'consumables', 'name');

  if (
    mealPlanPlan.length +
      mealHistoryPlan.length +
      choreSchedulePlan.length +
      consumableLogPlan.length >
    0
  ) {
    log('');
    log('  Repoint plans (target id by name lookup in destination family):');
    [
      ['meal_plans.recipe_id', mealPlanPlan],
      ['meal_history.recipe_id', mealHistoryPlan],
      ['chore_schedules.chore_id', choreSchedulePlan],
      ['consumable_log.consumable_id', consumableLogPlan],
    ].forEach(([label, plan]) => {
      if (plan.length === 0) return;
      log(`    ${label}:`);
      plan.forEach((p) => {
        const arrow =
          p.targetId == null ? 'NULL (no name match)' : `${p.targetId} (fam ${p.targetFam})`;
        log(
          `      row id=${p.id}: ${p.recipe_id ?? p.chore_id ?? p.consumable_id} -> ${arrow}  (name="${p.refName}")`
        );
      });
    });
  }

  if (DRY_RUN) {
    log('');
    log('[DRY-RUN] Would execute (in a transaction):');
    log(
      '[DRY-RUN]   0a. Repoint cross-family meal_plans/meal_history/chore_schedules/consumable_log'
    );
    log('[DRY-RUN]       (UPDATE ... SET ref_id = matched-or-NULL WHERE id IN ...)');
    log('[DRY-RUN]   1. DELETE FROM meal_plans WHERE family_id=1');
    log('[DRY-RUN]   2. DELETE FROM meal_history WHERE family_id=1');
    log('[DRY-RUN]   3. DELETE FROM chore_schedules WHERE family_id=1');
    log('[DRY-RUN]   4. DELETE FROM consumable_log WHERE family_id=1');
    log('[DRY-RUN]   5. DELETE FROM families WHERE id=1  (CASCADE handles rest)');
    log('[DRY-RUN] Family 3 rows would be untouched (only ref-IDs repointed).');
    db.close();
    return;
  }

  // Perform repoint + deletion in a single transaction.
  //
  // Step 0: repoint cross-family rows to the destination family's equivalent
  // entity by name, or NULL if no match is found. This is necessary because
  // these FKs are NO ACTION — they would block the cascade otherwise.
  //
  // Step 1-4: delete family-1 rows whose own FK to a sibling per-family table
  // is NO ACTION (meal_plans -> recipes, meal_history -> recipes,
  // chore_schedules -> chores, consumable_log -> consumables) BEFORE running
  // DELETE FROM families. Otherwise SQLite blocks the cascade because the
  // dependent rows still reference soon-to-be-deleted parents.
  //
  // Step 5: DELETE FROM families WHERE id = 1. CASCADE removes recipes,
  // recipe_ingredients (via recipes-CASCADE), chores, consumables,
  // family_profile, family_llm_config, sunday_drafts, notifications, and
  // any other family_id-CASCADE rows for family 1.
  log('');
  log('Executing cleanup transaction…');

  function applyRepoint(plan, table, refCol) {
    if (plan.length === 0) return 0;
    const updTo = db.prepare(`UPDATE ${table} SET ${refCol} = ? WHERE id = ?`);
    const updNull = db.prepare(`UPDATE ${table} SET ${refCol} = NULL WHERE id = ?`);
    let changes = 0;
    for (const p of plan) {
      if (p.targetId == null) {
        updNull.run(p.id);
      } else {
        updTo.run(p.targetId, p.id);
      }
      changes += 1;
    }
    return changes;
  }

  const cleanup = db.transaction(() => {
    // Step 0: repoint cross-family pollution
    const repointMP = applyRepoint(mealPlanPlan, 'meal_plans', 'recipe_id');
    const repointMH = applyRepoint(mealHistoryPlan, 'meal_history', 'recipe_id');
    const repointCS = applyRepoint(choreSchedulePlan, 'chore_schedules', 'chore_id');
    const repointCL = applyRepoint(consumableLogPlan, 'consumable_log', 'consumable_id');
    log(`  - repointed meal_plans: ${repointMP} row(s)`);
    log(`  - repointed meal_history: ${repointMH} row(s)`);
    log(`  - repointed chore_schedules: ${repointCS} row(s)`);
    log(`  - repointed consumable_log: ${repointCL} row(s)`);

    // Steps 1-4: pre-delete the family-1 rows that block cascade
    const stmts = [
      [
        'family-1 meal_plans (NO ACTION FK to recipes)',
        `DELETE FROM meal_plans WHERE family_id = 1`,
      ],
      [
        'family-1 meal_history (NO ACTION FK to recipes)',
        `DELETE FROM meal_history WHERE family_id = 1`,
      ],
      [
        'family-1 chore_schedules (NO ACTION FK to chores)',
        `DELETE FROM chore_schedules WHERE family_id = 1`,
      ],
      [
        'family-1 consumable_log (NO ACTION FK to consumables)',
        `DELETE FROM consumable_log WHERE family_id = 1`,
      ],
      ['families row (CASCADE handles the rest)', `DELETE FROM families WHERE id = 1`],
    ];
    for (const [label, sql] of stmts) {
      const r = db.prepare(sql).run();
      log(`  - ${label}: ${r.changes} row(s) deleted`);
    }
  });
  cleanup();
  log('  Transaction committed.');

  // Print after-state
  log('');
  log('=== AFTER: family 1 row counts ===');
  const afterFam1 = countFamilyRows(db, 1);
  if (Object.keys(afterFam1).length === 0) {
    log('  (cleanup successful — 0 rows remain for family 1)');
  } else {
    log('  WARNING: residual rows remain:');
    Object.entries(afterFam1).forEach(([t, n]) => log(`    ${t}: ${n}`));
  }

  log('');
  log('=== AFTER: family 3 row counts (verify untouched) ===');
  const afterFam3 = countFamilyRows(db, 3);
  Object.entries(afterFam3).forEach(([t, n]) => log(`  ${t}: ${n}`));

  // Diff verification
  log('');
  log('=== Family 3 diff (must be all zero) ===');
  const tables = new Set([...Object.keys(beforeFam3), ...Object.keys(afterFam3)]);
  let drift = 0;
  for (const t of tables) {
    const before = beforeFam3[t] || 0;
    const after = afterFam3[t] || 0;
    if (before !== after) {
      log(`  DRIFT: ${t}: ${before} → ${after}`);
      drift += 1;
    }
  }
  if (drift === 0) {
    log('  All family 3 row counts unchanged — cleanup safe.');
  } else {
    log(`  ${drift} table(s) drifted on family 3 — investigate immediately.`);
  }

  db.close();
  log('');
  log('Done.');
}

try {
  main();
} catch (err) {
  process.stderr.write(`ERROR: ${err.message}\n`);
  if (err.stack) process.stderr.write(err.stack + '\n');
  process.exit(2);
}
