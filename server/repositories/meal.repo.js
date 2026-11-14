'use strict';

const { getFamilyId } = require('../auth/family-context');

function createMealRepos(db, tryParseJson) {
  function placeDinner(weekYear, day, source, status) {
    if (source && source.libraryRecipeId != null && source.recipeId == null) {
      mealPlans.setLibraryRecipe(weekYear, day, source.libraryRecipeId, status, 'manual');
      return;
    }
    mealPlans.setRecipe(weekYear, day, source ? source.recipeId : null, status, 'manual');
  }

  const mealPlans = {
    getWeek(weekYear) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        SELECT id, week_year as weekYear, day_of_week as dayOfWeek, meal_type as mealType,
               recipe_id as recipeId, library_recipe_id as libraryRecipeId,
               status, notes, plan_origin as planOrigin
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
        INSERT OR IGNORE INTO meal_plans (
          family_id, week_year, day_of_week, meal_type, recipe_id, library_recipe_id, status, plan_origin
        )
        VALUES (?, ?, ?, 'middag', ?, ?, ?, 'auto')
      `);
      const tx = db.transaction(() => {
        for (const slot of defaultPlan) {
          ins.run(
            familyId,
            weekYear,
            slot.dayOfWeek,
            slot.recipeId ?? null,
            slot.libraryRecipeId ?? null,
            slot.status || 'planned'
          );
        }
      });
      tx();
    },
    setRecipe(weekYear, dayOfWeek, recipeId, status = 'planned', planOrigin = 'manual') {
      const familyId = getFamilyId();
      const origin = planOrigin === 'auto' ? 'auto' : 'manual';
      db.prepare(
        `
        INSERT INTO meal_plans (
          family_id, week_year, day_of_week, meal_type, recipe_id, status, plan_origin
        )
        VALUES (?, ?, ?, 'middag', ?, ?, ?)
        ON CONFLICT(family_id, week_year, day_of_week, meal_type) DO UPDATE SET
          recipe_id = excluded.recipe_id,
          library_recipe_id = NULL,
          status = excluded.status,
          plan_origin = excluded.plan_origin
      `
      ).run(familyId, weekYear, dayOfWeek, recipeId, status, origin);
    },
    setLibraryRecipe(
      weekYear,
      dayOfWeek,
      libraryRecipeId,
      status = 'planned',
      planOrigin = 'auto'
    ) {
      const familyId = getFamilyId();
      const origin = planOrigin === 'auto' ? 'auto' : 'manual';
      db.prepare(
        `
        INSERT INTO meal_plans (
          family_id, week_year, day_of_week, meal_type, recipe_id, library_recipe_id, status, plan_origin
        )
        VALUES (?, ?, ?, 'middag', NULL, ?, ?, ?)
        ON CONFLICT(family_id, week_year, day_of_week, meal_type) DO UPDATE SET
          recipe_id = NULL,
          library_recipe_id = excluded.library_recipe_id,
          status = excluded.status,
          plan_origin = excluded.plan_origin
      `
      ).run(familyId, weekYear, dayOfWeek, libraryRecipeId, status, origin);
    },
    /**
     * Mark a day as explicitly having no dinner. recipe_id is cleared
     * so shopping skips the slot (status 'removed' is already excluded).
     * Inserts the row when the week was ensured without that day.
     */
    clearDinner(weekYear, dayOfWeek) {
      const familyId = getFamilyId();
      const result = db
        .prepare(
          `
        UPDATE meal_plans
           SET recipe_id = NULL, status = 'removed'
         WHERE family_id = ? AND week_year = ? AND day_of_week = ? AND meal_type = 'middag'
      `
        )
        .run(familyId, weekYear, dayOfWeek);
      if (result.changes === 0) {
        db.prepare(
          `
          INSERT INTO meal_plans (family_id, week_year, day_of_week, meal_type, recipe_id, status)
          VALUES (?, ?, ?, 'middag', NULL, 'removed')
        `
        ).run(familyId, weekYear, dayOfWeek);
      }
    },
    /**
     * Recipe ids used on recent weeks strictly before `beforeWeekYear`.
     * Used so a newly seeded week does not repeat the last few menus.
     * @param {string} beforeWeekYear
     * @param {number} [weekCount]
     * @returns {number[]}
     */
    recentRecipeIds(beforeWeekYear, weekCount = 4) {
      const familyId = getFamilyId();
      const limit = Number.isInteger(weekCount) && weekCount > 0 ? weekCount : 4;
      const weeks = db
        .prepare(
          `
        SELECT DISTINCT week_year AS weekYear
          FROM meal_plans
         WHERE family_id = ? AND week_year < ? AND meal_type = 'middag'
         ORDER BY week_year DESC
         LIMIT ?
      `
        )
        .all(familyId, beforeWeekYear, limit);
      if (weeks.length === 0) return [];
      const placeholders = weeks.map(() => '?').join(',');
      const rows = db
        .prepare(
          `
        SELECT DISTINCT recipe_id AS recipeId
          FROM meal_plans
         WHERE family_id = ? AND meal_type = 'middag'
           AND recipe_id IS NOT NULL
           AND week_year IN (${placeholders})
      `
        )
        .all(familyId, ...weeks.map((w) => w.weekYear));
      return rows.map((r) => r.recipeId);
    },
    setStatus(weekYear, dayOfWeek, status) {
      const familyId = getFamilyId();
      const result = db
        .prepare(
          `
        UPDATE meal_plans SET status = ?
        WHERE family_id = ? AND week_year = ? AND day_of_week = ? AND meal_type = 'middag'
      `
        )
        .run(status, familyId, weekYear, dayOfWeek);
      return result.changes;
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
        placeDinner(weekYear, dayA, slotB, slotA.status);
        placeDinner(weekYear, dayB, slotA, slotB.status);
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
        SELECT day_of_week as dayOfWeek, recipe_id as recipeId,
               library_recipe_id as libraryRecipeId, status
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
          r.libraryRecipeId != null ||
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
