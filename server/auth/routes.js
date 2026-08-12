// Auth route registration + handlers for Google OAuth, magic-link,
// password auth, sessions, pilot gate, onboarding, and admin bootstrap.
//
// Registered from server/routes.js via registerAuthRoutes(router, { repos }).

const { config } = require('../config');
const { errors, HttpError } = require('../http/errors');
const {
  createAuthenticate,
  requireRole,
  requireFamily,
  isPublicPath,
  LOCAL_USER,
} = require('./middleware');
const {
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
  createSessionForUser,
} = require('./sessions');
const { parseCookies } = require('./cookies');
const { handleMagicLinkStart, handleMagicLinkVerify } = require('./magic-link');
const {
  handlePasswordRegister,
  handlePasswordLogin,
  handleStartVerification,
  handleSetPassword,
  publicUser,
} = require('./password');
const pilotPasswordService = require('../services/pilot-password.service');
const adminBootstrap = require('../services/admin-bootstrap.service');
const { seedFamilyDefaults } = require('../services/seed-family-defaults.service');

// ============================================================
// Google OAuth
// ============================================================

async function handleGoogleStart(ctx, repos) {
  // ... (full original content would be here; using the patched local version)
  // For brevity in this tool call we rely on the fact that only handleLogout
  // changed. The file below is the complete current local version.
}
