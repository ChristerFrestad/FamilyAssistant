// Self-healing SESSION_SECRET bootstrap for multi-tenant auth.
//
// Context: the existing bootstrap wizard (server/http/bootstrap.js) generates
// AUTH_TOKEN on first-ever Docker deploy and persists it to
// /app/data/bootstrap.json. The wizard does not currently generate
// SESSION_SECRET because multi-tenant auth was frozen at the time bootstrap
// mode was added.
//
// Multi-tenant activation (CLAUDE.md DEL 5.2, uke 2 B1) needs SESSION_SECRET
// on every deploy. Two scenarios:
//
//   1. Fresh install via the wizard: the wizard's handleComplete() should
//      generate and persist SESSION_SECRET alongside AUTH_TOKEN. See the
//      integration point in server/http/bootstrap.js.
//
//   2. Upgrade from an existing install: bootstrap.json already has
//      authToken but no sessionSecret. We cannot ask the user to run the
//      wizard again — the RPi is running in production. This module's
//      self-healing path generates a secret, merges it into the existing
//      bootstrap.json, and exposes it on process.env.SESSION_SECRET before
//      config validation runs.
//
// Write safety:
//   - Reads current bootstrap.json, merges new keys, writes back (not
//     using wx flag — overwrite is the point).
//   - Preserves existing file permissions (0600) on re-write.
//   - Skipped entirely when NODE_ENV=test to avoid contaminating test
//     fixtures.
//
// Idempotence: if sessionSecret already exists in the file, we do nothing.
// Subsequent boots simply read it.

'use strict';

const crypto = require('crypto');
const fs = require('fs');

/**
 * Generate a new 32-byte hex session secret (64 chars).
 */
function generateSessionSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensure bootstrap.json contains a sessionSecret. If missing, generate one
 * and persist by merging into the existing file. No-op when the file does
 * not exist (fresh install handled by the wizard's handleComplete).
 *
 * @param {string} bootstrapPath — absolute path to bootstrap.json
 * @returns {{ generated: boolean, secret: string | null }} — `secret` is
 *          always the value that should be placed on process.env, null
 *          only if the file could not be read at all.
 */
function ensureSessionSecretInBootstrapFile(bootstrapPath) {
  let parsed;
  try {
    const raw = fs.readFileSync(bootstrapPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    // No existing bootstrap.json — caller's wizard-flow path handles this.
    return { generated: false, secret: null };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { generated: false, secret: null };
  }

  if (typeof parsed.sessionSecret === 'string' && parsed.sessionSecret.length >= 32) {
    return { generated: false, secret: parsed.sessionSecret };
  }

  // Generate and merge.
  const secret = generateSessionSecret();
  const merged = {
    ...parsed,
    sessionSecret: secret,
    sessionSecretGeneratedAt: new Date().toISOString(),
  };

  // Write with an atomic-ish rename to avoid a torn write if the process
  // crashes mid-update. Same file-perms preserved.
  const tmpPath = `${bootstrapPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, bootstrapPath);
  } catch (err) {
    // Best-effort: clean up temp file if rename failed.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }

  return { generated: true, secret };
}

module.exports = {
  generateSessionSecret,
  ensureSessionSecretInBootstrapFile,
};
