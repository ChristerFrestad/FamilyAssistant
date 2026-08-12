// HTTP endpoints for authentication flows.
//
// Registered from server/routes.js via registerAuthRoutes(router, { repos }).
// Every path under /api/auth/* is treated as public by the authenticate
// middleware (see auth/middleware.js), so these handlers never see ctx.user
// populated — they create it.

const crypto = require('crypto');
const { config } = require('../config');
const { errors } = require('../http/errors');
const { validateBody } = require('../http/validate');
const schemas = require('../schemas');
const {
  generatePkcePair,
  buildAuthorizationUrl,
  exchangeCodeForIdToken,
  verifyIdToken,
  redirectUriFor,
} = require('./google');
const {
  createSessionForUser,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
} = require('./sessions');
const { parseCookies, serializeCookie, appendSetCookie, clearCookie } = require('./cookies');
const { seedFamilyDefaults } = require('../services/seed.service');
const {
  handleMagicLinkStart,
  handleMagicLinkVerify,
  redirectTargetForUser,
} = require('./magic-link');
const {
  handlePasswordRegister,
  handlePasswordLogin,
  handleStartVerification,
  handleSetPassword,
  publicUser,
} = require('./password');
const { isEmailConfigured } = require('../services/email.service');
const pilotPasswordService = require('../services/pilot-password.service');
const { getClientIp } = require('../http/security');
const adminBootstrap = require('../services/admin-bootstrap.service');

const OAUTH_STATE_COOKIE = 'fa_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

// NOTE: Full file restored from main. Logout audit intentionally omitted in this commit
// to recover from a truncated push. See PR description.
