// Phase 15 — in-app feedback endpoints.
//
//   POST /api/feedback
//     authenticated — body {category, message, rating?, contactOk?}
//     category must be one of bug|suggestion|question|praise|other
//     message 1..2000 chars; rating 1..5 or null
//     page_url and user_agent are captured server-side from headers.
//     per-user rate limit: 10 submissions per hour.
//
//   POST /api/recipe-feedback
//     authenticated — body {recipeId, mealPlanId?, rating:-1|0|1, comment?}
//     last-click wins per (user_id, recipe_id) — upsert.
//     recipe must belong to caller's family (tenant isolation).

const { errors } = require('./errors');
const { runWithFamily } = require('../auth/family-context');

const FEEDBACK_CATEGORIES = new Set(['bug', 'suggestion', 'question', 'praise', 'other']);
const MAX_MESSAGE_LEN = 2000;
const MAX_COMMENT_LEN = 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const rateState = new Map(); // userId -> { count, windowStart }

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateState.get(userId);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateState.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.count += 1;
  return { allowed: true };
}

function resetRateLimitForTests() {
  rateState.clear();
}

function requireAuthenticatedUser(ctx) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  if (!ctx.user.family_id) {
    throw errors.forbidden('User is not attached to a family.');
  }
}

function handlePostFeedback(ctx, repos) {
  requireAuthenticatedUser(ctx);

  const rate = checkRateLimit(ctx.user.id);
  if (!rate.allowed) {
    ctx.res.setHeader('Retry-After', String(rate.retryAfter));
    throw errors.tooManyRequests(
      `Too many feedback submissions. Try again in ${rate.retryAfter}s.`
    );
  }

  const body = ctx.body || {};
  const category = typeof body.category === 'string' ? body.category : 'other';
  if (!FEEDBACK_CATEGORIES.has(category)) {
    throw errors.badRequest(
      `Invalid category. Must be one of: ${[...FEEDBACK_CATEGORIES].join(', ')}.`
    );
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) throw errors.badRequest('message is required.');
  if (message.length > MAX_MESSAGE_LEN) {
    throw errors.badRequest(`message is too long (max ${MAX_MESSAGE_LEN} chars).`);
  }

  let rating = null;
  if (body.rating !== undefined && body.rating !== null) {
    const r = Number(body.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      throw errors.badRequest('rating must be an integer 1-5 or null.');
    }
    rating = r;
  }

  const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : null;
  const userAgent =
    typeof ctx.req?.headers?.['user-agent'] === 'string'
      ? ctx.req.headers['user-agent'].slice(0, 500)
      : null;
  const contactOk = body.contactOk === true || body.contactOk === 1;

  const row = repos.feedback.insertFeedback({
    familyId: ctx.user.family_id,
    userId: ctx.user.id,
    category,
    message,
    rating,
    pageUrl,
    userAgent,
    contactOk,
  });

  ctx.json(
    {
      ok: true,
      feedback: {
        id: row.id,
        category: row.category,
        rating: row.rating,
        createdAt: row.created_at,
      },
    },
    201
  );
}

function handlePostRecipeFeedback(ctx, repos) {
  requireAuthenticatedUser(ctx);

  const body = ctx.body || {};
  const recipeId = Number(body.recipeId);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    throw errors.badRequest('recipeId is required (positive integer).');
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || ![-1, 0, 1].includes(rating)) {
    throw errors.badRequest('rating must be -1, 0, or 1.');
  }

  let mealPlanId = null;
  if (body.mealPlanId !== undefined && body.mealPlanId !== null) {
    const m = Number(body.mealPlanId);
    if (!Number.isInteger(m) || m <= 0) {
      throw errors.badRequest('mealPlanId must be a positive integer if provided.');
    }
    mealPlanId = m;
  }

  let comment = null;
  if (body.comment !== undefined && body.comment !== null) {
    if (typeof body.comment !== 'string') {
      throw errors.badRequest('comment must be a string.');
    }
    const trimmed = body.comment.trim();
    if (trimmed.length > MAX_COMMENT_LEN) {
      throw errors.badRequest(`comment is too long (max ${MAX_COMMENT_LEN} chars).`);
    }
    comment = trimmed || null;
  }

  // Tenant isolation: the recipe must belong to the caller's family.
  // Recipe lookup uses AsyncLocalStorage family-context.
  const recipe = runWithFamily(ctx.user.family_id, () => repos.recipes.getById(recipeId));
  if (!recipe) {
    throw errors.forbidden('Recipe not found in this family.');
  }

  const row = repos.feedback.upsertRecipeFeedback({
    familyId: ctx.user.family_id,
    userId: ctx.user.id,
    recipeId,
    mealPlanId,
    rating,
    comment,
  });

  ctx.json(
    {
      ok: true,
      recipeFeedback: {
        id: row.id,
        recipeId: row.recipe_id,
        rating: row.rating,
        mealPlanId: row.meal_plan_id,
        createdAt: row.created_at,
      },
    },
    201
  );
}

function registerFeedbackRoutes(router, { repos }) {
  router.post('/api/feedback', (ctx) => handlePostFeedback(ctx, repos));
  router.post('/api/recipe-feedback', (ctx) => handlePostRecipeFeedback(ctx, repos));
}

module.exports = {
  registerFeedbackRoutes,
  resetRateLimitForTests,
  FEEDBACK_CATEGORIES,
};
