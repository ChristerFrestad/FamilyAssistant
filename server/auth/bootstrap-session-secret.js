// Self-healing SESSION_SECRET bootstrap for multi-tenant auth.
//
// Context: the existing bootstrap wizard (server/http/bootstrap.js) generates
// AUTH_TOKEN on first-ever Docker deploy and persists it to
// /app/data/bootstrap.json. Multi-tenant activation needs SESSION_SECRET on
// every deploy that uses magic-link / Google OAuth / MAGIC_LINK_CONSOLE.
//
// Scenarios:
//
//   1. Fresh install via the wizard: handleComplete() writes sessionSecret
//      alongside authToken.
//
//   2. Upgrade: bootstrap.json has authToken but no sessionSecret. We merge
//      a generated secret into the existing file.
//
//   3. Portainer partial config: AUTH_TOKEN set in stack env (or DB exists)
//      but SESSION_SECRET was never provisioned, and MAGIC_LINK_CONSOLE /
//      RESEND / Google is on. Without a secret the process crash-loops with
//      empty Published Ports. When `createIfMissing` is true we create or
//      update bootstrap.json and return a secret so boot can continue.
//
// Write safety:
//   - Atomic write via rename
//   - mode 0600
//   - Skipped in NODE_ENV=test by callers

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Generate a new 32-byte hex session secret (64 chars).
 */
function generateSessionSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Ensure bootstrap.json contains a sessionSecret.
 *
 * @param {string} bootstrapPath — absolute path to bootstrap.json
 * @param {{ createIfMissing?: boolean }} [opts]
 * @returns {{ generated: boolean, secret: string | null, createdFile: boolean }}
 */
function ensureSessionSecretInBootstrapFile(bootstrapPath, opts = {}) {
  const createIfMissing = Boolean(opts.createIfMissing);
  const emptyShell = () => ({
    completedAt: null,
    generatedBy: 'session-secret-auto-provision',
    version: 2,
  });
  let parsed;
  let fileExisted = false;

  try {
    const raw = fs.readFileSync(bootstrapPath, 'utf8');
    parsed = JSON.parse(raw);
    fileExisted = true;
  } catch {
    if (!createIfMissing) {
      return { generated: false, secret: null, createdFile: false };
    }
    parsed = emptyShell();
  }

  if (!parsed || typeof parsed !== 'object') {
    if (!createIfMissing) {
      return { generated: false, secret: null, createdFile: false };
    }
    parsed = emptyShell();
  }

  if (typeof parsed.sessionSecret === 'string' && parsed.sessionSecret.length >= 32) {
    return { generated: false, secret: parsed.sessionSecret, createdFile: false };
  }

  const secret = generateSessionSecret();
  const merged = {
    ...parsed,
    sessionSecret: secret,
    sessionSecretGeneratedAt: new Date().toISOString(),
  };

  const dir = path.dirname(bootstrapPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${bootstrapPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, bootstrapPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    generated: true,
    secret,
    createdFile: !fileExisted,
  };
}

/**
 * Resolve the default bootstrap.json path (Docker volume first).
 */
function resolveDefaultBootstrapPath(explicitPath) {
  if (explicitPath) return explicitPath;
  const dockerPath = '/app/data/bootstrap.json';
  try {
    fs.accessSync(path.dirname(dockerPath), fs.constants.W_OK);
    return dockerPath;
  } catch {
    return path.resolve(process.cwd(), 'data', 'bootstrap.json');
  }
}

module.exports = {
  generateSessionSecret,
  ensureSessionSecretInBootstrapFile,
  resolveDefaultBootstrapPath,
};
