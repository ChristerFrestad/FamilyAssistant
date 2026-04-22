'use strict';

// Chore completion history — gamification foundation (uke 2 B5).
//
// Append-only log of every chore-completion event. Written by
// chore.repo.js's markDone (and partially undone by markUndone) inside
// a single db.transaction, so schedule-status and history always agree.
//
// This file exposes the explicit read/write helpers that tests and
// future XP/streak/leaderboard queries need:
//
//   insert({ weekYear, choreId, userId })
//   removeLatest({ weekYear, choreId })
//   countForFamilyWeek(weekYear)
//   countForUserWeek(userId, weekYear)
//   listForFamilyWeek(weekYear)
//
// All queries are family-scoped via getFamilyId() from
// server/auth/family-context.js, so callers cannot leak across
// tenants regardless of week_year / chore_id.

const { getFamilyId } = require('../auth/family-context');

function createChoreCompletionRepos(db) {
  const choreCompletions = {
    /**
     * Append a completion row. Used by chore.repo.markDone (inside a
     * transaction) and by tests that want to seed history directly.
     *
     * @param {object} opts
     * @param {string} opts.weekYear — 'YYYY-WNN'
     * @param {number} opts.choreId  — chores.id (no FK enforcement;
     *                                  soft-inactivated chores still get
     *                                  history attributed)
     * @param {number|null} opts.userId — users.id, or null for synthetic
     *                                    LOCAL_USER (pilot single-tenant)
     * @returns {{ id: number }}
     */
    insert({ weekYear, choreId, userId = null }) {
      const familyId = getFamilyId();
      const res = db
        .prepare(
          `INSERT INTO chore_completions (family_id, week_year, chore_id, user_id)
           VALUES (?, ?, ?, ?)`
        )
        .run(familyId, weekYear, choreId, userId);
      return { id: Number(res.lastInsertRowid) };
    },

    /**
     * Remove the newest history row for (family, week, chore). Used by
     * chore.repo.markUndone. If multiple rows share the same millisecond
     * completed_at (unlikely but possible in automated tests), the highest
     * id wins — deterministic and matches "most recently inserted".
     *
     * @returns {{ removed: number }} — how many rows were deleted (0 or 1)
     */
    removeLatest({ weekYear, choreId }) {
      const familyId = getFamilyId();
      const res = db
        .prepare(
          `DELETE FROM chore_completions
             WHERE id = (
               SELECT id FROM chore_completions
                WHERE family_id = ? AND week_year = ? AND chore_id = ?
                ORDER BY completed_at DESC, id DESC
                LIMIT 1
             )`
        )
        .run(familyId, weekYear, choreId);
      return { removed: res.changes };
    },

    /**
     * Total completions in a given week for the current family.
     * Reserved for future week-goal progress / family leaderboard.
     */
    countForFamilyWeek(weekYear) {
      const familyId = getFamilyId();
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM chore_completions
             WHERE family_id = ? AND week_year = ?`
        )
        .get(familyId, weekYear);
      return row.c;
    },

    /**
     * Total completions for a specific user in a given week. user_id
     * must be a real user id — passing null would match every synthetic-
     * user completion, which is rarely what a caller wants. Reserved for
     * future per-user XP and streak calculations.
     */
    countForUserWeek(userId, weekYear) {
      const familyId = getFamilyId();
      if (userId == null) return 0;
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM chore_completions
             WHERE family_id = ? AND user_id = ? AND week_year = ?`
        )
        .get(familyId, userId, weekYear);
      return row.c;
    },

    /**
     * Raw rows for a given week, newest first. Read-only helper for
     * future leaderboard UI and analytics queries. Columns are
     * snake_case from the schema; callers can rename as they wish.
     */
    listForFamilyWeek(weekYear) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `SELECT id, chore_id, user_id, completed_at, xp_awarded
             FROM chore_completions
            WHERE family_id = ? AND week_year = ?
            ORDER BY completed_at DESC, id DESC`
        )
        .all(familyId, weekYear);
    },
  };

  return { choreCompletions };
}

module.exports = { createChoreCompletionRepos };
