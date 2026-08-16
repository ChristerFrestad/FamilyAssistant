// Per-family LLM configuration endpoints.
//
// Registered from server/routes.js via registerLlmConfigRoutes(router, { repos }).
//
//   GET  /api/family/llm            any authenticated member — returns
//                                    { backend, model, baseUrl, hasKey }
//                                    (never exposes the actual key).
//   PUT  /api/family/llm            owner — persist backend/model/baseUrl,
//                                    and encrypt+store apiKey when supplied.
//                                    apiKey === '' clears the stored key,
//                                    undefined keeps the existing value.
//   POST /api/family/llm/test       any authed member — run a minimal
//                                    health-check against the backend the
//                                    caller wants to probe. Payload may
//                                    reference the stored config or pass
//                                    ad-hoc fields; the ad-hoc apiKey is
//                                    used in-memory only and never saved.

const { errors } = require('../http/errors');
const { requireRole } = require('./middleware');
const {
  getClientForFamily,
  getClientFromCandidate,
  NotConfiguredError,
} = require('../llm/per-family');
const { SUPPORTED_BACKENDS } = require('../repositories/llm-config.repo');
const { getInstanceLlmPublic } = require('../llm/instance-fallback');

function handleGetLlmConfig(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const row = repos.llmConfig.getForFamilyPublic(ctx.familyId);
  return { config: row, instanceFallback: getInstanceLlmPublic() };
}

function handlePutLlmConfig(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const { backend, model, baseUrl, apiKey } = ctx.body || {};
  if (!SUPPORTED_BACKENDS.includes(backend)) {
    throw errors.badRequest(`backend must be one of: ${SUPPORTED_BACKENDS.join(', ')}`);
  }
  // apiKey handling:
  //   undefined → keep existing ciphertext
  //   ''        → clear stored key
  //   string    → encrypt + overwrite
  let apiKeyArg;
  if (apiKey === undefined || apiKey === null) {
    apiKeyArg = undefined;
  } else if (typeof apiKey !== 'string') {
    throw errors.badRequest('apiKey must be a string.');
  } else {
    apiKeyArg = apiKey;
  }
  try {
    const saved = repos.llmConfig.upsert(ctx.familyId, {
      backend,
      model: model || null,
      baseUrl: baseUrl || null,
      apiKey: apiKeyArg,
      updatedBy: ctx.user?.id ?? null,
    });
    return { ok: true, config: saved };
  } catch (err) {
    throw errors.badRequest(err.message);
  }
}

async function handleTestLlmConfig(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const { backend, model, baseUrl, apiKey } = ctx.body || {};

  let client;
  try {
    if (backend) {
      client = getClientFromCandidate({ backend, model, baseUrl, apiKey });
    } else {
      client = getClientForFamily(repos, ctx.familyId);
    }
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      ctx.json({ ok: false, error: err.code, detail: err.message }, 412);
      return;
    }
    throw errors.badRequest(err.message);
  }

  try {
    const result = await client.testConnection();
    return { ok: true, backend: client.backend, model: client.model, result };
  } catch (err) {
    ctx.json({ ok: false, error: 'backend_unreachable', detail: err.message }, 502);
    return;
  }
}

function registerLlmConfigRoutes(router, { repos }) {
  router.get('/api/family/llm', (ctx) => handleGetLlmConfig(ctx, repos));
  router.put('/api/family/llm', requireRole('owner'), (ctx) => handlePutLlmConfig(ctx, repos));
  router.post('/api/family/llm/test', async (ctx) => handleTestLlmConfig(ctx, repos));
}

module.exports = { registerLlmConfigRoutes };
