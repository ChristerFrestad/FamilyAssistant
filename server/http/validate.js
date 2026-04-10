// Zod validation middleware
// Bruk:
//   r.post('/api/shopping/add', validateBody(addShoppingSchema), handler);
//
// Etter validering finnes resultatet p\u00e5 ctx.body (erstattet med parsed data).
// Ved feil kastes en HttpError som error-handleren konverterer til RFC 7807.

const { errors } = require('./errors');

function validateBody(schema) {
  return (ctx) => {
    const result = schema.safeParse(ctx.body);
    if (!result.success) {
      throw errors.validation(result.error.issues);
    }
    ctx.body = result.data;
  };
}

function validateQuery(schema) {
  return (ctx) => {
    const result = schema.safeParse(ctx.query);
    if (!result.success) {
      throw errors.validation(result.error.issues);
    }
    ctx.query = result.data;
  };
}

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
