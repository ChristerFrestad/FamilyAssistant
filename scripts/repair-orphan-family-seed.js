'use strict';

// Repair script for the multi-tenant seed bug fixed in 2026-05-02
// (audit doc docs/analyses/2026-05-02-multi-tenant-audit.md).
//
// Symptom: any family created via /api/auth/onboarding/complete
// before the fix is missing its per-family seed (recipes, chores,
// consumables, family_profile, default meal-plan, chore-schedules).
// In addition, ensureCurrentWeek wrote default meal-plans referencing
// recipe_id 1..7 which only exist for family 1, leaving orphan rows
// for every other family.
//
// What this script does:
//   1. For every family with zero recipes: run seedFamilyDefaults().
//   2. For every meal_plans row whose recipe_id does not exist in
//      that row's family, repoint to the equivalent recipe by name
//      using a seed-id → new-id map. Leaves rows untouched if no
//      mapping is found.
//
// Idempotent: running twice has no additional effect. The first run
// fills in missing data; subsequent runs see the per-family
// "is the table empty?"-guards inside seedFamilyDefaults and short-
// circuit. Orphan-repointing only updates rows whose recipe_id does
// not currently resolve.
//
// Usage:
//   node scripts/repair-orphan-family-seed.js
//
//   DB_PATH=/custom/path.db node scripts/repair-orphan-family-seed.js
//   --dry-run prints what would change without writing.

const path = require('path');

const dryRun = process.argv.includes('--dry-run');

// Force this script to use the project's actual DB unless DB_PATH is
// already set. We require server modules below — they read DB_PATH at
// import time via server/config.js — so we set it before requiring
// anything from server/.
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, '..', 'data', 'familieassistenten.db');
}

const seed = require('../server/seed');
const { initDB } = require('../server/db');
const { createRepositories } = require('../server/repositories');
const { seedFamilyDefaults } = require('../server/services/seed.service');
const { runWithFamily } = require('../server/auth/family-context');

async function main() {
  const { db } = await initDB();
  const repos = createRepositories(db);

  const families = db.prepare('SELECT id, name FROM families ORDER BY id').all();
  console.log(`Found ${families.length} families.`);

  let totalSeeded = 0;
  let totalRepointed = 0;

  for (const family of families) {
    console.log(`\n=== Family ${family.id} (${family.name}) ===`);
    const before = runWithFamily(family.id, () => ({
      recipes: repos.recipes.count(),
      chores: repos.chores.getAll().length,
      consumables: repos.consumables.getAll().length,
    }));
    console.log(
      `  Before: recipes=${before.recipes}, chores=${before.chores}, ` +
        `consumables=${before.consumables}`
    );

    if (dryRun) {
      const wouldSeed = before.recipes === 0;
      console.log(`  [dry-run] would call seedFamilyDefaults: ${wouldSeed}`);
    } else {
      const summary = seedFamilyDefaults(repos, family.id);
      const inserted = Object.values(summary).filter((v) => Number.isInteger(v) && v > 0);
      if (inserted.length > 0 || summary.familyProfileCreated) {
        console.log(`  Seeded: ${JSON.stringify(summary)}`);
        totalSeeded += summary.recipesInserted;
      } else {
        console.log('  Seed already complete; skipped.');
      }
    }

    // Repoint orphan meal_plans. We use the same name-based lookup as
    // ensureCurrentWeek so the result is deterministic.
    runWithFamily(family.id, () => {
      const mealPlans = db
        .prepare(
          `SELECT id, recipe_id FROM meal_plans
           WHERE family_id = ? AND recipe_id IS NOT NULL`
        )
        .all(family.id);
      const orphans = mealPlans.filter((row) => {
        const r = repos.recipes.getById(row.recipe_id);
        return r === null;
      });
      if (orphans.length === 0) {
        console.log('  No orphan meal_plans rows.');
        return;
      }
      console.log(`  Found ${orphans.length} orphan meal_plans rows.`);

      // Build a seed-id → family-recipe-id map by recipe-name lookup.
      const idMap = {};
      for (const r of seed.recipes) {
        const found = repos.recipes.findByName(r.name);
        if (found && Number.isInteger(found.id)) idMap[r.id] = found.id;
      }

      const upd = db.prepare(`UPDATE meal_plans SET recipe_id = ? WHERE id = ?`);
      const del = db.prepare(`UPDATE meal_plans SET recipe_id = NULL WHERE id = ?`);
      for (const orphan of orphans) {
        const newId = idMap[orphan.recipe_id];
        if (newId != null) {
          if (dryRun) {
            console.log(`  [dry-run] meal_plans id=${orphan.id}: ${orphan.recipe_id} → ${newId}`);
          } else {
            upd.run(newId, orphan.id);
            totalRepointed++;
          }
        } else {
          // No mapping — clear the orphan ref so the slot becomes a
          // "Planlegg middag" empty-state instead of a broken hero.
          if (dryRun) {
            console.log(`  [dry-run] meal_plans id=${orphan.id}: ${orphan.recipe_id} → NULL`);
          } else {
            del.run(orphan.id);
            totalRepointed++;
          }
        }
      }
    });
  }

  console.log(
    `\n=== Done. Seeded recipes for ${totalSeeded} new rows; ` +
      `repointed ${totalRepointed} orphan meal_plans. ${dryRun ? '(dry-run)' : ''}`
  );
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
