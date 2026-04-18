'use strict';

function createMealRepos(db, tryParseJson) {
  const mealPlans = {
    getWeek(weekYear) {
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, day_of_week as dayOfWeek, meal_type as mealType,
               recipe_id as recipeId, status, notes
        FROM meal_plans
        WHERE week_year = ? AND meal_type = 'middag'
        ORDER BY day_of_week
      `
        )
        .all(weekYear);
    },
    seedDefault(weekYear, defaultPlan) {
      const ins = db.prepare(`
        INSERT OR IGNORE INTO meal_plans (week_year, day_of_week, meal_type, recipe_id, status)
        VALUES (?, ?, 'middag', ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const slot of defaultPlan) {
          ins.run(weekYear, slot.dayOfWeek, slot.recipeId, slot.status || 'planned');
        }
      });
      tx();
    },
    setRecipe(weekYear, dayOfWeek, recipeId, status = 'planned') {
      db.prepare(
        `
        INSERT INTO meal_plans (week_year, day_of_week, meal_type, recipe_id, status)
        VALUES (?, ?, 'middag', ?, ?)
        ON CONFLICT(family_id, week_year, day_of_week, meal_type) DO UPDATE SET
          recipe_id = excluded.recipe_id, status = excluded.status
      `
      ).run(weekYear, dayOfWeek, recipeId, status);
    },
    setStatus(weekYear, dayOfWeek, status) {
      db.prepare(
        `
        UPDATE meal_plans SET status = ?
        WHERE week_year = ? AND day_of_week = ? AND meal_type = 'middag'
      `
      ).run(status, weekYear, dayOfWeek);
    },
    swapDays(weekYear, dayA, dayB) {
      const plan = mealPlans.getWeek(weekYear);
      const slotA = plan.find((p) => p.dayOfWeek === dayA);
      const slotB = plan.find((p) => p.dayOfWeek === dayB);
      if (!slotA || !slotB) return;
      const tx = db.transaction(() => {
        mealPlans.setRecipe(weekYear, dayA, slotB.recipeId, slotA.status);
        mealPlans.setRecipe(weekYear, dayB, slotA.recipeId, slotB.status);
      });
      tx();
    },
    exists(weekYear) {
      return (
        db.prepare('SELECT 1 FROM meal_plans WHERE week_year = ? LIMIT 1').get(weekYear) != null
      );
    },
    /**
     * En uke er "komplett" når alle 7 dager har tatt et eksplisitt valg:
     * - recipe_id satt (planned/cooked), eller
     * - status IN ('away','skipped','removed')
     * Dager med recipe_id=NULL og status='planned' regnes som "ikke avklart".
     * Returnerer false hvis uken ikke finnes i det hele tatt.
     */
    isWeekComplete(weekYear) {
      const rows = db
        .prepare(
          `
        SELECT day_of_week as dayOfWeek, recipe_id as recipeId, status
        FROM meal_plans
        WHERE week_year = ? AND meal_type = 'middag'
      `
        )
        .all(weekYear);
      if (rows.length < 7) return false;
      const seen = new Set();
      for (const r of rows) {
        seen.add(r.dayOfWeek);
        const decided =
          r.recipeId != null ||
          r.status === 'away' ||
          r.status === 'skipped' ||
          r.status === 'removed';
        if (!decided) return false;
      }
      // Alle 7 unike dager må være til stede
      for (let d = 0; d < 7; d++) if (!seen.has(d)) return false;
      return true;
    },
  };

  const mealHistory = {
    insert(entry) {
      db.prepare(
        `
        INSERT INTO meal_history (recipe_id, rating, leftovers, notes) VALUES (?, ?, ?, ?)
      `
      ).run(entry.recipeId, entry.rating ?? null, entry.leftovers ? 1 : 0, entry.notes ?? null);
    },
    getRecent(days = 28) {
      return db
        .prepare(
          `
        SELECT recipe_id as recipeId, cooked_at, rating, leftovers
        FROM meal_history
        WHERE cooked_at >= date('now', ?)
        ORDER BY cooked_at DESC
      `
        )
        .all(`-${days} days`);
    },
  };

  const sundayDrafts = {
    get(weekYear) {
      const r = db.prepare(`SELECT * FROM sunday_drafts WHERE week_year = ?`).get(weekYear);
      if (!r) return null;
      return { ...r, meals: tryParseJson(r.meals_json) || [], accepted: !!r.accepted };
    },
    save(weekYear, meals) {
      db.prepare(
        `
        INSERT OR REPLACE INTO sunday_drafts (week_year, meals_json, generated_at, accepted)
        VALUES (?, ?, datetime('now'), 0)
      `
      ).run(weekYear, JSON.stringify(meals));
    },
    markAccepted(weekYear) {
      db.prepare(`UPDATE sunday_drafts SET accepted = 1 WHERE week_year = ?`).run(weekYear);
    },
  };

  return { mealPlans, mealHistory, sundayDrafts };
}

module.exports = { createMealRepos };
