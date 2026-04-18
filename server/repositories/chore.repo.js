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
    upsertMany(choreList) {
      const familyId = getFamilyId();
      const ins = db.prepare(`
        INSERT OR REPLACE INTO chores (id, family_id, task, details, frequency, default_day, icon, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const c of choreList) {
          ins.run(
            c.id,
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
    markDone(weekYear, choreId) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE chore_schedules SET status = 'done', completed_at = datetime('now')
        WHERE family_id = ? AND week_year = ? AND chore_id = ?
      `
      ).run(familyId, weekYear, choreId);
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
