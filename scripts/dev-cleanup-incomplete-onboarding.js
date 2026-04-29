'use strict';

// Dev-only cleanup script for zombie families left behind by partial
// onboarding flows. Sprint 3 / PR #77 atomic-onboarding follow-up.
//
// Why this exists:
//   Before atomic onboarding (PR #77) the wizard wrote the family row
//   on Step 1 submit and only flipped users.onboarding_completed on
//   Step 3 submit. A user who closed the tab between steps left a
//   half-built family + an owner-user with onboarding_completed=0.
//   On the next login that user would 409 on every retry of the now
//   removed POST /api/onboarding/create-family endpoint, and could
//   never finish onboarding. The atomic flow prevents NEW occurrences;
//   this script clears the historical residue from dev databases.
//
// Safety:
//   * Default Family (id=1) is the legacy multi-tenant seed (migration
//     014:122) and anchors all pre-multi-tenant data. It is NEVER
//     deleted by this script even if it has no linked users.
//   * Only deletes families where ALL linked users have
//     onboarding_completed=0 (or the family has no linked users at
//     all). A family with even one onboarding_completed=1 user is
//     considered live and kept.
//   * users.family_id is REFERENCES families(id) ON DELETE SET NULL
//     (migration 014:36), so deleting a family detaches its users
//     automatically. We additionally reset role to 'adult' so the
//     stale 'owner' role doesn't survive the cleanup.
//   * Wraps everything in a single transaction. If any step fails,
//     the whole cleanup is rolled back.
//
// Usage:
//   node scripts/dev-cleanup-incomplete-onboarding.js
//
// The script prints what it will delete BEFORE acting, then applies
// the changes and prints the post-cleanup snapshot. Output is meant
// to be paste-friendly into the PR description so reviewers can
// confirm exactly what was removed.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'familieassistenten.db');
const LEGACY_DEFAULT_FAMILY_ID = 1;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[cleanup ${ts}] ${msg}`);
}

function findZombieFamilies(db) {
  // A family is a zombie when:
  //   * its id is not the legacy default family (id=1), AND
  //   * it has no linked users OR all linked users have
  //     onboarding_completed = 0.
  return db
    .prepare(
      `SELECT f.id, f.name,
              COUNT(u.id) AS user_count,
              SUM(CASE WHEN u.onboarding_completed = 1 THEN 1 ELSE 0 END) AS completed_count
         FROM families f
         LEFT JOIN users u ON u.family_id = f.id
        WHERE f.id != ?
        GROUP BY f.id, f.name
       HAVING completed_count IS NULL OR completed_count = 0`
    )
    .all(LEGACY_DEFAULT_FAMILY_ID);
}

function findOrphanProfileMembers(db, deletedFamilyIds) {
  if (deletedFamilyIds.length === 0) return [];
  const placeholders = deletedFamilyIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, family_id, name FROM family_profile_members WHERE family_id IN (${placeholders})`
    )
    .all(...deletedFamilyIds);
}

function findAffectedUsers(db, deletedFamilyIds) {
  if (deletedFamilyIds.length === 0) return [];
  const placeholders = deletedFamilyIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, email, name, family_id, role, onboarding_completed
         FROM users
        WHERE family_id IN (${placeholders})`
    )
    .all(...deletedFamilyIds);
}

function main() {
  log(`Opening ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  try {
    const zombies = findZombieFamilies(db);
    if (zombies.length === 0) {
      log('No zombie families found. Nothing to do.');
      return;
    }

    log(`Found ${zombies.length} zombie families:`);
    for (const z of zombies) {
      log(
        `  family_id=${z.id} name="${z.name}" users=${z.user_count} completed=${z.completed_count ?? 0}`
      );
    }

    const ids = zombies.map((z) => z.id);
    const members = findOrphanProfileMembers(db, ids);
    if (members.length > 0) {
      log(`Will cascade-delete ${members.length} profile members:`);
      for (const m of members) {
        log(`  member_id=${m.id} family_id=${m.family_id} name="${m.name}"`);
      }
    }

    const users = findAffectedUsers(db, ids);
    if (users.length > 0) {
      log(`Will detach ${users.length} users (family_id -> NULL, role -> 'adult'):`);
      for (const u of users) {
        log(
          `  user_id=${u.id} email=${u.email} role=${u.role} onboarding_completed=${u.onboarding_completed}`
        );
      }
    }

    const tx = db.transaction(() => {
      const placeholders = ids.map(() => '?').join(',');
      // Reset users to a clean unfamily state. The FK ON DELETE SET NULL
      // would set family_id to NULL automatically when the family is
      // dropped, but doing it explicitly first ensures role + previous
      // member-id linkage are also reset in the same transaction.
      db.prepare(
        `UPDATE users
            SET family_id = NULL,
                role = 'adult',
                profile_member_id = NULL
          WHERE family_id IN (${placeholders})`
      ).run(...ids);

      // CASCADE on family_profile_members.family_id and family_invitations.
      // family_id removes those rows automatically.
      db.prepare(`DELETE FROM families WHERE id IN (${placeholders})`).run(...ids);
    });
    tx();

    log('Cleanup committed.');
  } finally {
    // Post-cleanup snapshot for the PR description.
    const families = db.prepare('SELECT id, name FROM families ORDER BY id').all();
    log(`Post-cleanup families (${families.length}):`);
    for (const f of families) log(`  id=${f.id} name="${f.name}"`);
    const users = db
      .prepare('SELECT id, email, family_id, role, onboarding_completed FROM users ORDER BY id')
      .all();
    log(`Post-cleanup users (${users.length}):`);
    for (const u of users)
      log(
        `  id=${u.id} email=${u.email} family_id=${u.family_id ?? 'NULL'} role=${u.role} onboarding_completed=${u.onboarding_completed}`
      );
    db.close();
  }
}

main();
