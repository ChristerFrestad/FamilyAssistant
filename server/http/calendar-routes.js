'use strict';

// Calendar integrations (Google OAuth + iCloud CalDAV). Event CRUD stays
// in routes.js. Secrets are encrypted at rest and never returned.

const { config } = require('../config');
const { errors } = require('./errors');
const { validateBody } = require('./validate');
const { requireRole } = require('../auth/middleware');
const { encrypt } = require('../auth/crypto');
const schemas = require('../schemas');
const googleOauth = require('../services/calendar/google.oauth');

function requirePositiveInt(value, name = 'id') {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw errors.badRequest(`${name} must be a positive integer`);
  }
  return n;
}

function sendUnavailable(ctx, reason) {
  ctx.json({ reason }, 503);
}

function registerCalendarIntegrationRoutes(router, { repos }) {
  router.get('/api/integrations/calendar', requireRole('adult'), (ctx) => {
    if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
    ctx.json({
      integrations: repos.calendarIntegrations.listPublic(),
      googleConfigured: googleOauth.isClientConfigured(),
    });
  });

  router.post(
    '/api/integrations/calendar/icloud',
    requireRole('adult'),
    validateBody(schemas.icloudConnectBody),
    (ctx) => {
      if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
      if (!config.ENCRYPTION_KEY) {
        sendUnavailable(ctx, 'ENCRYPTION_KEY is not configured');
        return;
      }
      let appPasswordEnc;
      try {
        appPasswordEnc = encrypt(ctx.body.appPassword);
      } catch {
        sendUnavailable(ctx, 'ENCRYPTION_KEY is not configured');
        return;
      }
      if (!appPasswordEnc) {
        throw errors.badRequest('appPassword is required');
      }
      const userId = ctx.user && Number(ctx.user.id) > 0 ? ctx.user.id : null;
      if (!userId) throw errors.forbidden('A signed-in family user is required.');
      const integration = repos.calendarIntegrations.upsertIcloud({
        userId,
        email: ctx.body.email,
        appPasswordEnc,
        calendarExternalId: ctx.body.calendarExternalId || null,
      });
      ctx.json({ ok: true, integration });
    }
  );

  router.delete('/api/integrations/calendar/:id', requireRole('adult'), (ctx) => {
    if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
    const id = requirePositiveInt(ctx.params.id);
    const changes = repos.calendarIntegrations.delete(id);
    if (!changes) throw errors.notFound('Calendar integration not found');
    ctx.json({ ok: true });
  });

  router.post('/api/integrations/google-calendar/start', requireRole('adult'), (ctx) => {
    if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
    if (!googleOauth.isClientConfigured()) {
      ctx.json({ reason: 'GOOGLE_CLIENT_ID is not configured' }, 503);
      return;
    }
    const reason = googleOauth.missingConfigReason();
    if (reason) {
      ctx.json({ reason }, 503);
      return;
    }
    const userId = ctx.user && Number(ctx.user.id) > 0 ? ctx.user.id : null;
    if (!userId) throw errors.forbidden('A signed-in family user is required.');
    const state = googleOauth.createState({ familyId: ctx.familyId, userId });
    ctx.json({ url: googleOauth.buildAuthorizationUrl({ state }) });
  });

  router.post(
    '/api/integrations/google-calendar/callback',
    requireRole('adult'),
    validateBody(schemas.googleCalendarCallbackBody),
    async (ctx) => {
      if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
      if (!config.ENCRYPTION_KEY) {
        sendUnavailable(ctx, 'ENCRYPTION_KEY is not configured');
        return;
      }
      const reason = googleOauth.missingConfigReason();
      if (reason) {
        sendUnavailable(ctx, reason);
        return;
      }
      const payload = googleOauth.verifyState(ctx.body.state);
      if (!payload) throw errors.badRequest('Invalid or expired OAuth state');
      if (payload.familyId !== ctx.familyId || payload.userId !== ctx.user.id) {
        throw errors.forbidden('OAuth state does not match this user');
      }
      let tokens;
      try {
        tokens = await googleOauth.exchangeCode({ code: ctx.body.code });
      } catch {
        throw errors.badRequest('Google calendar token exchange failed');
      }
      if (!tokens || !tokens.refresh_token) {
        throw errors.badRequest('Google did not return a refresh token');
      }
      let refreshTokenEnc;
      let accessTokenEnc = null;
      try {
        refreshTokenEnc = encrypt(tokens.refresh_token);
        if (tokens.access_token) accessTokenEnc = encrypt(tokens.access_token);
      } catch {
        sendUnavailable(ctx, 'ENCRYPTION_KEY is not configured');
        return;
      }
      const email = ctx.user.email;
      if (!email) throw errors.badRequest('Account email is required');
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
        : null;
      const integration = repos.calendarIntegrations.upsertGoogle({
        userId: ctx.user.id,
        email,
        refreshTokenEnc,
        accessTokenEnc,
        accessTokenExpiresAt: expiresAt,
        calendarExternalId: 'primary',
        calendarDisplayName: 'Google Calendar',
      });
      ctx.json({ ok: true, integration });
    }
  );
}

module.exports = { registerCalendarIntegrationRoutes };
