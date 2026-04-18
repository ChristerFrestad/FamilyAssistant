// Repository for in-app feedback + per-recipe thumb ratings (phase 15).
//
// Two tables (migration 015):
//   - feedback          general free-text user feedback (bug/suggestion/
//                       question/praise/other) with optional 1-5 star rating
//   - recipe_feedback   per-user thumb up/down on recipes; upserted on
//                       (user_id, recipe_id) so the last click wins
//
// All writes carry family_id explicitly — callers provide it from ctx
// rather than relying on AsyncLocalStorage since feedback-routes run
// with the authenticated request context directly.

function createFeedbackRepo(db) {
  const insertFeedbackStmt = db.prepare(`
    INSERT INTO feedback (family_id, user_id, category, message, rating,
                          page_url, user_agent, contact_ok)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getFeedbackByIdStmt = db.prepare('SELECT * FROM feedback WHERE id = ?');

  const listFeedbackForFamilyStmt = db.prepare(
    `SELECT * FROM feedback WHERE family_id = ? ORDER BY created_at DESC LIMIT ?`
  );

  function insertFeedback({
    familyId,
    userId,
    category,
    message,
    rating = null,
    pageUrl = null,
    userAgent = null,
    contactOk = false,
  }) {
    const res = insertFeedbackStmt.run(
      familyId,
      userId,
      category,
      message,
      rating,
      pageUrl,
      userAgent,
      contactOk ? 1 : 0
    );
    return getFeedbackByIdStmt.get(Number(res.lastInsertRowid));
  }

  function listFeedbackForFamily(familyId, limit = 100) {
    return listFeedbackForFamilyStmt.all(familyId, limit);
  }

  // ============================================================
  // recipe_feedback — last-click-wins per (user_id, recipe_id)
  // ============================================================

  const findExistingRecipeFeedbackStmt = db.prepare(
    `SELECT id FROM recipe_feedback WHERE family_id = ? AND user_id = ? AND recipe_id = ?`
  );
  const insertRecipeFeedbackStmt = db.prepare(`
    INSERT INTO recipe_feedback (family_id, user_id, recipe_id, meal_plan_id, rating, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateRecipeFeedbackStmt = db.prepare(`
    UPDATE recipe_feedback
       SET rating = ?, comment = ?, meal_plan_id = ?, created_at = datetime('now')
     WHERE id = ?
  `);
  const getRecipeFeedbackByIdStmt = db.prepare('SELECT * FROM recipe_feedback WHERE id = ?');
  const listRatingsForFamilyStmt = db.prepare(
    `SELECT recipe_id, rating, COUNT(*) AS count
       FROM recipe_feedback
      WHERE family_id = ?
      GROUP BY recipe_id, rating`
  );

  function upsertRecipeFeedback({
    familyId,
    userId,
    recipeId,
    mealPlanId = null,
    rating,
    comment = null,
  }) {
    const existing = findExistingRecipeFeedbackStmt.get(familyId, userId, recipeId);
    if (existing) {
      updateRecipeFeedbackStmt.run(rating, comment, mealPlanId, existing.id);
      return getRecipeFeedbackByIdStmt.get(existing.id);
    }
    const res = insertRecipeFeedbackStmt.run(
      familyId,
      userId,
      recipeId,
      mealPlanId,
      rating,
      comment
    );
    return getRecipeFeedbackByIdStmt.get(Number(res.lastInsertRowid));
  }

  function listRatingsForFamily(familyId) {
    return listRatingsForFamilyStmt.all(familyId);
  }

  return {
    insertFeedback,
    listFeedbackForFamily,
    upsertRecipeFeedback,
    listRatingsForFamily,
  };
}

module.exports = { createFeedbackRepo };
