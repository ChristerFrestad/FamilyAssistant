'use strict';

const { getFamilyId } = require('../auth/family-context');

function createMealRepos(db, tryParseJson) {
  const mealPlans = {
    getWeek(weekYear) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, day_of_week as dayOfWeek, meal_type as mealType,
               recipe_id as recipeId, status, notes
        FROM meal_plans
        WHERE family_id = ? AND week_year = ? AND meal_type = 'middag'
        ORDER BY day_of_week
      `
        )
        .all(familyId, weekYear);
    },
    seedDefault(weekYear, defaultPlan) {
      const familyId = getFamilyId();
      const ins = db.prepare(`
        INSERT OR IGNORE INTO meal_plans (family_id, week_year, day_of_week, meal_type, recipe_id, status)
        VALUES (?, ?, ?, 'middag', ?, ?)
      `);
      const tx = db.transaction(() => {
        for (const slot of defaultPlan) {
          ins.run(familyId, weekYear, slot.dayOfWeek, slot.recipeId, slot.status || 'planned');
        }
      });
      tx();
    },
    setRecipe(weekYear, dayOfWeek, recipeId, status = 'planned') {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT INTO meal_plans (family_id, week_year, day_of_week, meal_type, recipe_id, status)
        VALUES (?, ?, ?, 'middag', ?, ?)
        ON CONFLICT(family_id, week_year, day_of_week, meal_type) DO UPDATE SET
          recipe_id = excluded.recipe_id, status = excluded.status
      `
      ).run(familyId, weekYear, dayOfWeek, recipeId, status);
    },
    setStatus(weekYear, dayOfWeek, status) {
      const familyId = getFamilyId();
      db.prepare(
        `
        UPDATE meal_plans SET status = ?
        WHERE family_id = ? AND week_year = ? AND day_of_week = ? AND meal_type = 'middag'
      `
      ).run(status, familyId, weekYear, dayOfWeek);
    },
    /**
     * Sprint 6 — fetch a single meal_plan row by primary key. The
     * mark-cooked endpoint receives meal_plans.id from the client and
     * needs to resolve the slot before computing pantry suggestions.
     * Family-scoped to the current context, so a stranger meal id is
     * indistinguishable from "not found".
     */
    getById(mealId) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, day_of_week as dayOfWeek,
               meal_type as mealType, recipe_id as recipeId, status, notes
        FROM meal_plans
        WHERE family_id = ? AND id = ?
      `
        )
        .get(familyId, mealId);
    },
    /**
     * Sprint 6 — flip status by id. Used by mark-cooked + unmark-cooked
     * so the UI does not have to resolve weekYear+dayOfWeek client-side.
     */
    setStatusById(mealId, status) {
      const familyId = getFamilyId();
      db.prepare(
        `UPDATE meal_plans SET status = ?
         WHERE family_id = ? AND id = ?`
      ).run(status, familyId, mealId);
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
      const familyId = getFamilyId();
      return (
        db
          .prepare('SELECT 1 FROM meal_plans WHERE family_id = ? AND week_year = ? LIMIT 1')
          .get(familyId, weekYear) != null
      );
    },
    /**
     * A week is "complete" when all 7 days have made an explicit choice:
     * - recipe_id satt (planned/cooked), eller
     * - status IN ('away','skipped','removed')
     * Dager med recipe_id=NULL og status='planned' regnes som "ikke avklart".
     * Returnerer false hvis uken ikke finnes i det hele tatt.
     */
    isWeekComplete(weekYear) {
      const familyId = getFamilyId();
      const rows = db
        .prepare(
          `
        SELECT day_of_week as dayOfWeek, recipe_id as recipeId, status
        FROM meal_plans
        WHERE family_id = ? AND week_year = ? AND meal_type = 'middag'
      `
        )
        .all(familyId, weekYear);
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
      for (let d = 0; d < 7; d++) if (!seen.has(d)) return false;
      return true;
    },
  };

  const mealHistory = {
    insert(entry) {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT INTO meal_history (family_id, recipe_id, rating, leftovers, notes) VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        familyId,
        entry.recipeId,
        entry.rating ?? null,
        entry.leftovers ? 1 : 0,
        entry.notes ?? null
      );
    },
    getRecent(days = 28) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT recipe_id as recipeId, cooked_at, rating, leftovers
        FROM meal_history
        WHERE family_id = ? AND cooked_at >= date('now', ?)
        ORDER BY cooked_at DESC
      `
        )
        .all(familyId, `-${days} days`);
    },
  };

  const sundayDrafts = {
    get(weekYear) {
      const familyId = getFamilyId();
      const r = db
        .prepare(`SELECT * FROM sunday_drafts WHERE family_id = ? AND week_year = ?`)
        .get(familyId, weekYear);
      if (!r) return null;
      return { ...r, meals: tryParseJson(r.meals_json) || [], accepted: !!r.accepted };
    },
    save(weekYear, meals) {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT OR REPLACE INTO sunday_drafts (family_id, week_year, meals_json, generated_at, accepted)
        VALUES (?, ?, ?, datetime('now'), 0)
      `
      ).run(familyId, weekYear, JSON.stringify(meals));
    },
    markAccepted(weekYear) {
      const familyId = getFamilyId();
      db.prepare(`UPDATE sunday_drafts SET accepted = 1 WHERE family_id = ? AND week_year = ?`).run(
        familyId,
        weekYear
      );
    },
  };

  return { mealPlans, mealHistory, sundayDrafts };
}

module.exports = { createMealRepos };
