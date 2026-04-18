// Onboarding endpoints used by public/js/family-onboarding.js.
//
// POST /api/onboarding/create-family  authenticated — creates a new
//                                      family, attaches the caller as
//                                      owner, and sets families.owner_user_id.
//                                      Fails if the caller is already in
//                                      a family (409).

const { errors } = require('../http/errors');

function handleCreateFamily(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  if (ctx.user.family_id) {
    throw errors.conflict('User is already in a family.');
  }
  const name = (ctx.body?.name || '').trim();
  if (!name) throw errors.badRequest('Family name is required.');
  if (name.length > 100) throw errors.badRequest('Family name is too long (max 100 chars).');

  const family = repos.family.createFamily(name, ctx.user.id);
  repos.auth.setFamily(ctx.user.id, family.id, 'owner');

  return {
    ok: true,
    family: {
      id: family.id,
      name: family.name,
      ownerUserId: ctx.user.id,
      createdAt: family.created_at,
    },
  };
}

function registerOnboardingRoutes(router, { repos }) {
  router.post('/api/onboarding/create-family', (ctx) => handleCreateFamily(ctx, repos));
}

module.exports = { registerOnboardingRoutes };
