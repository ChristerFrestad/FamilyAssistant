// @ts-check
// Zod validation middleware
// Bruk:
//   r.post('/api/shopping/add', validateBody(addShoppingSchema), handler);
//
// After validation the result is on ctx.body (replaced with parsed data).
// Ved feil kastes en HttpError som error-handleren konverterer til RFC 7807.

const { errors } = require('./errors');

/**
 * @typedef {object} ZodLikeSchema
 * @property {(data: unknown) => { success: boolean, data?: any, error?: { issues: any[] } }} safeParse
 */

/**
 * @typedef {object} RequestCtx
 * @property {any} body
 * @property {any} query
 * @property {any} params
 */

/**
 * Validerer ctx.body mot Zod-schema. Kaster HttpError ved ugyldig.
 * @param {ZodLikeSchema} schema
 * @returns {(ctx: RequestCtx) => void}
 */
function validateBody(schema) {
  return (ctx) => {
    const result = schema.safeParse(ctx.body);
    if (!result.success) {
      throw errors.validation(result.error.issues);
    }
    ctx.body = result.data;
  };
}

/**
 * @param {ZodLikeSchema} schema
 * @returns {(ctx: RequestCtx) => void}
 */
function validateQuery(schema) {
  return (ctx) => {
    const result = schema.safeParse(ctx.query);
    if (!result.success) {
      throw errors.validation(result.error.issues);
    }
    ctx.query = result.data;
  };
}

/**
 * @param {ZodLikeSchema} schema
 * @returns {(ctx: RequestCtx) => void}
 */
function validateParams(schema) {
  return (ctx) => {
    const result = schema.safeParse(ctx.params);
    if (!result.success) {
      throw errors.validation(result.error.issues);
    }
    ctx.params = result.data;
  };
}

module.exports = { validateBody, validateQuery, validateParams };
