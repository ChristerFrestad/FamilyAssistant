'use strict';

function createChoreRepos(db) {
  const chores = {
    getAll() {
      return db.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY default_day, task').all();
    },
    upsertMany(choreList) {
      const ins = db.prepare(`
        INSERT OR REPLACE INTO chores (id, task, details, frequency, default_day, icon, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const c of choreList) {
          ins.run(
            c.id,
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
      return db
        .prepare(
          `
        SELECT id, chore_id as choreId, week_year as weekYear,
               scheduled_day as scheduledDay, status, postponed_to as postponedTo,
               completed_at as completedAt, notes
        FROM chore_schedules WHERE week_year = ?
      `
        )
        .all(weekYear);
    },
    exists(weekYear) {
      return (
        db.prepare('SELECT 1 FROM chore_schedules WHERE week_year = ? LIMIT 1').get(weekYear) !=
        null
      );
    },
    seedDefault(weekYear) {
      const all = chores.getAll();
      const ins = db.prepare(`
        INSERT OR IGNORE INTO chore_schedules (chore_id, week_year, scheduled_day, status)
        VALUES (?, ?, ?, 'pending')
      `);
      const tx = db.transaction(() => {
        for (const c of all) {
          if (c.default_day != null) ins.run(c.id, weekYear, c.default_day);
        }
      });
      tx();
    },
    postpone(weekYear, choreId, newDay) {
      db.prepare(
        `
        UPDATE chore_schedules SET postponed_to = ?, status = 'postponed'
        WHERE week_year = ? AND chore_id = ?
      `
      ).run(newDay, weekYear, choreId);
    },
    markDone(weekYear, choreId) {
      db.prepare(
        `
        UPDATE chore_schedules SET status = 'done', completed_at = datetime('now')
        WHERE week_year = ? AND chore_id = ?
      `
      ).run(weekYear, choreId);
    },
    add(weekYear, choreId, scheduledDay) {
      db.prepare(
        `
        INSERT OR IGNORE INTO chore_schedules (chore_id, week_year, scheduled_day, status)
        VALUES (?, ?, ?, 'pending')
      `
      ).run(choreId, weekYear, scheduledDay);
    },
  };

  return { chores, choreSchedules };
}

module.exports = { createChoreRepos };
