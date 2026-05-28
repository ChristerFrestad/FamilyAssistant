'use strict';

// Admin bootstrap state machine.
//
// Sprint 7. The first user to onboard becomes the system admin (is_admin=1)
// either because their email matches APP_ADMIN_EMAIL or because no such
// env-var is set and the first-user-wins fallback applies. The decision is
// recorded in app_setup so the bootstrap can never run twice — every later
// onboarding leaves is_admin=0.
//
// Multi-tenant policy reminder:
//   is_admin grants access to /api/admin/* endpoints (system stats and
//   future admin UI). It does NOT grant cross-family read/write access.
//   Admin sees other families' AGGREGATES; cannot see their CONTENT.
//   See AGENTS.md DEL 14.

const { config } = require('../config');

function normaliseEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function getAppSetup(db) {
  return db.prepare(`SELECT * FROM app_setup WHERE id = 1`).get() || null;
}

function isBootstrapped(db) {
  return getAppSetup(db) !== null;
}

// Decide whether the freshly-onboarded user should become admin.
// Returns { promote: boolean, method: 'env' | 'first_user' | null }.
function decideAdminBootstrap({ db, userEmail }) {
  if (isBootstrapped(db)) {
    return { promote: false, method: null };
  }

  const adminEmail = normaliseEmail(config.APP_ADMIN_EMAIL || '');
  const onboardingEmail = normaliseEmail(userEmail || '');

  if (adminEmail.length > 0) {
    if (onboardingEmail === adminEmail) {
      return { promote: true, method: 'env' };
    }
    // APP_ADMIN_EMAIL is set but this user does not match — do NOT
    // bootstrap yet. Wait for the matching user to onboard.
    return { promote: false, method: null };
  }

  // APP_ADMIN_EMAIL unset → first user to onboard wins.
  return { promote: true, method: 'first_user' };
}

// Apply the bootstrap decision: flip is_admin on the user and record
// the app_setup row. Caller must run this in the same transaction as
// the onboarding completion to keep state consistent.
function applyBootstrap({ db, userId, method }) {
  db.prepare(`UPDATE users SET is_admin = 1, promoted_at = datetime('now') WHERE id = ?`).run(
    userId
  );
  db.prepare(
    `INSERT INTO app_setup (id, admin_user_id, bootstrap_method)
     VALUES (1, ?, ?)`
  ).run(userId, method);
}

// Convenience: combine decide + apply for the onboarding flow.
function bootstrapAdminIfNeeded({ db, userId, userEmail }) {
  const decision = decideAdminBootstrap({ db, userEmail });
  if (decision.promote) {
    applyBootstrap({ db, userId, method: decision.method });
    return { promoted: true, method: decision.method };
  }
  return { promoted: false, method: null };
}

module.exports = {
  decideAdminBootstrap,
  applyBootstrap,
  bootstrapAdminIfNeeded,
  isBootstrapped,
  getAppSetup,
};
