'use strict';

const { getFamilyId } = require('../auth/family-context');

function createChoreRepos(db) {
  const chores = {
    getAll() {
      const familyId = getFamilyId();
      return db
        .prepare(
          'SELECT * FROM chores WHERE family_id = ? AND active = 1 ORDER BY default_day, task'
        )
        .all(familyId);
    },
    /**
     * Insert seed chores for the current family. Does NOT pass a
     * caller-supplied id — the INSERT OR REPLACE pattern that did so
     * was a multi-tenant footgun (family 2 seeding with seed-id=1
     * would REPLACE family 1's row on the same global id). With
     * AUTOINCREMENT each family gets its own id-range.
     *
     * Caller is expected to gate this behind a "is the table empty
     * for this family?"-check so re-seeding doesn't duplicate. The
     * helper is idempotent at the call-site level, not internally.
     */
    upsertMany(choreList) {
      const familyId = getFamilyId();
      const ins = db.prepare(`
        INSERT INTO chores (family_id, task, details, frequency, default_day, icon, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const c of choreList) {
          ins.run(
            familyId,
            c.task,
            c.details ?? null,
            c.frequency,
            c.defaultDay,
            c.icon ?? null,
            c.active ? 1 : 0
          );
        }
      });
      tx();
    },
  };

  const choreSchedules = {
    getWeek(weekYear) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, chore_id as choreId, week_year as weekYear,
               scheduled_day as scheduledDay, status, postponed_to as postponedTo,
               completed_at as completedAt, notes
        FROM chore_schedules WHERE family_id = ? AND week_year = ?
      `
        )
        .all(familyId, weekYear);
    },
    exists(weekYear) {
      const familyId = getFamilyId();
      return (
        db
          .prepare('SELECT 1 FROM chore_schedules WHERE family_id = ? AND week_year = ? LIMIT 1')
          .get(familyId, weekYear) != null
      );
    },
    seedDefault(weekYear) {
      const familyId = getFamilyId();
      const all = chores.getAll();
      const ins = db.prepare(`
        INSERT OR IGNORE INTO chore_schedules (family_id, chore_id, week_year, scheduled_day, status)
        VALUES (?, ?, ?, ?, 'pending')
      `);
      const tx = db.transaction(() => {
        for (const c of all) {
          if (c.default_day != null) ins.run(familyId, c.id, weekYear, c.default_day);
        }
      });
      tx();
    },
    postpone(weekYear, choreId, newDay) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE chore_schedules SET postponed_to = ?, status = 'postponed'
        WHERE family_id = ? AND week_year = ? AND chore_id = ?
      `
      ).run(newDay, familyId, weekYear, choreId);
    },
    /**
     * Mark a chore as done for a given week, and append a gamification
     * history row in the same transaction. B5 (uke 2): the history row
     * is used by future XP/streak/leaderboard features.
     *
     * @param {string} weekYear — 'YYYY-WNN'
     * @param {number} choreId
     * @param {object} [opts]
     * @param {number|null} [opts.userId] — id of the user who completed,
     *        or null for synthetic LOCAL_USER (single-tenant pilot).
     */
    markDone(weekYear, choreId, opts = {}) {
      const familyId = getFamilyId();
      const userId = opts.userId ?? null;
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE chore_schedules SET status = 'done', completed_at = datetime('now')
            WHERE family_id = ? AND week_year = ? AND chore_id = ?`
        ).run(familyId, weekYear, choreId);
        // History insert — atomic with the schedule update so we never
        // end up with status='done' but no history row (or vice versa).
        db.prepare(
          `INSERT INTO chore_completions (family_id, week_year, chore_id, user_id)
             VALUES (?, ?, ?, ?)`
        ).run(familyId, weekYear, choreId, userId);
      });
      tx();
    },
    /**
     * Undo "done" or "postponed" — resets the row to 'pending' AND
     * removes the most recent history row for the (family, week, chore)
     * triple. Used by PUT /api/chores/undone. Atomic: either both
     * happen or neither.
     *
     * Design note: we only delete the newest completion row. In the rare
     * event a chore was completed twice in the same week (e.g., via
     * future "do X twice"-logic), the earlier completion remains on
     * record — undo rolls back exactly ONE action.
     */
    markUndone(weekYear, choreId) {
      const familyId = getFamilyId();
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE chore_schedules
              SET status = 'pending', completed_at = NULL, postponed_to = NULL
            WHERE family_id = ? AND week_year = ? AND chore_id = ?`
        ).run(familyId, weekYear, choreId);
        db.prepare(
          `DELETE FROM chore_completions
            WHERE id = (
              SELECT id FROM chore_completions
               WHERE family_id = ? AND week_year = ? AND chore_id = ?
               ORDER BY completed_at DESC, id DESC
               LIMIT 1
            )`
        ).run(familyId, weekYear, choreId);
      });
      tx();
    },
    add(weekYear, choreId, scheduledDay) {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT OR IGNORE INTO chore_schedules (family_id, chore_id, week_year, scheduled_day, status)
        VALUES (?, ?, ?, ?, 'pending')
      `
      ).run(familyId, choreId, weekYear, scheduledDay);
    },
  };

  return { chores, choreSchedules };
}

module.exports = { createChoreRepos };
