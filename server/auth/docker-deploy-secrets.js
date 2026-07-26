// Zero-config Docker / Portainer deploy secrets.
//
// Portainer "GitHub URL → Deploy" must work with zero stack env vars.
// This module always runs inside a container and ensures AUTH_TOKEN +
// SESSION_SECRET exist BEFORE production gates can kill the process.
// Magic-link / OAuth use these secrets later at login — they must never
// block binding :7777.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function hex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function envTruthy(name) {
  const v = process.env[name];
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** True when we should auto-provision secrets and never crash-loop. */
function isZeroConfigDeploy() {
  if (envTruthy('BOOTSTRAP_ALLOWED')) return true;
  try {
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {
    // ignore
  }
  // Dockerfile WORKDIR + DB_PATH defaults
  if (process.cwd() === '/app') return true;
  if (typeof process.env.DB_PATH === 'string' && process.env.DB_PATH.startsWith('/app/data')) {
    return true;
  }
  return false;
}

function resolveBootstrapPath(explicitPath) {
  if (explicitPath) return explicitPath;
  const dockerPath = '/app/data/bootstrap.json';
  try {
    const dir = path.dirname(dockerPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dockerPath;
  } catch {
    const local = path.resolve(process.cwd(), 'data', 'bootstrap.json');
    try {
      fs.mkdirSync(path.dirname(local), { recursive: true });
    } catch {
      // ignore
    }
    return local;
  }
}

function readBootstrap(bootstrapPath) {
  try {
    const raw = fs.readFileSync(bootstrapPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // missing / unreadable
  }
  return {};
}

function writeBootstrap(bootstrapPath, data) {
  fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
  const tmp = `${bootstrapPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, bootstrapPath);
}

/**
 * Clear empty / too-short secret env vars that Portainer often injects as
 * blank stack fields — those would otherwise fail length gates.
 */
function scrubWeakSecretEnv() {
  const token = process.env.AUTH_TOKEN;
  if (token !== undefined && String(token).trim().length < 16) {
    delete process.env.AUTH_TOKEN;
  }
  const session = process.env.SESSION_SECRET;
  if (session !== undefined && String(session).trim().length < 32) {
    delete process.env.SESSION_SECRET;
  }
  // Normalize false-y string flags Portainer injects (and strip empty).
  for (const key of [
    'MAGIC_LINK_CONSOLE',
    'PILOT_BYPASS',
    'PILOT_BYPASS_PRODUCTION_ACK',
    'PILOT_MODE',
    'LOG_PRETTY',
  ]) {
    if (process.env[key] === undefined) continue;
    const s = String(process.env[key]).trim().toLowerCase();
    if (s === '' || s === '0' || s === 'false' || s === 'no' || s === 'off') {
      process.env[key] = 'false';
    } else if (s === '1' || s === 'true' || s === 'yes' || s === 'on') {
      process.env[key] = 'true';
    }
  }
}

/**
 * Ensure process.env has AUTH_TOKEN + SESSION_SECRET.
 * Idempotent. Never throws for missing secrets — generates them.
 *
 * @returns {{ path: string, generated: string[], zeroConfig: boolean }}
 */
function ensureDockerDeploySecrets({ bootstrapFile } = {}) {
  scrubWeakSecretEnv();

  const bootstrapPath = resolveBootstrapPath(bootstrapFile || process.env.BOOTSTRAP_FILE);
  const existing = readBootstrap(bootstrapPath);
  const generated = [];
  let dirty = false;

  let authToken =
    (typeof process.env.AUTH_TOKEN === 'string' && process.env.AUTH_TOKEN.trim()) ||
    (typeof existing.authToken === 'string' && existing.authToken.trim()) ||
    '';
  if (!authToken || authToken.length < 16) {
    authToken = hex(32);
    generated.push('AUTH_TOKEN');
    dirty = true;
  }

  let sessionSecret =
    (typeof process.env.SESSION_SECRET === 'string' && process.env.SESSION_SECRET.trim()) ||
    (typeof existing.sessionSecret === 'string' && existing.sessionSecret.trim()) ||
    '';
  if (!sessionSecret || sessionSecret.length < 32) {
    sessionSecret = hex(32);
    generated.push('SESSION_SECRET');
    dirty = true;
  }

  let allowedOrigins =
    (typeof process.env.ALLOWED_ORIGINS === 'string' && process.env.ALLOWED_ORIGINS.trim()) ||
    (typeof existing.allowedOrigins === 'string' && existing.allowedOrigins.trim()) ||
    '';
  if (!allowedOrigins) {
    allowedOrigins = '*';
    if (!existing.allowedOrigins) dirty = true;
  }

  process.env.AUTH_TOKEN = authToken;
  process.env.SESSION_SECRET = sessionSecret;
  if (!process.env.ALLOWED_ORIGINS || !String(process.env.ALLOWED_ORIGINS).trim()) {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
  }
  // Ensure Docker path is marked for config.js even if compose forgot it.
  if (!envTruthy('BOOTSTRAP_ALLOWED')) {
    process.env.BOOTSTRAP_ALLOWED = 'true';
  }

  if (dirty || !fs.existsSync(bootstrapPath)) {
    const payload = {
      ...existing,
      completedAt: existing.completedAt || new Date().toISOString(),
      authToken,
      sessionSecret,
      sessionSecretGeneratedAt: existing.sessionSecretGeneratedAt || new Date().toISOString(),
      allowedOrigins: process.env.ALLOWED_ORIGINS || allowedOrigins,
      generatedBy: existing.generatedBy || 'docker-deploy-auto',
      version: 2,
    };
    writeBootstrap(bootstrapPath, payload);
  }

  return { path: bootstrapPath, generated, zeroConfig: true };
}

module.exports = {
  ensureDockerDeploySecrets,
  isZeroConfigDeploy,
  envTruthy,
  resolveBootstrapPath,
  scrubWeakSecretEnv,
  readBootstrap,
  writeBootstrap,
};
