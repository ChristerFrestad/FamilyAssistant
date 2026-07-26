// Zero-config Docker / Portainer deploy secrets.
//
// Goal: the container MUST bind :7777 on first boot without any stack env
// secrets. AUTH_TOKEN + SESSION_SECRET are generated once, persisted to
// /app/data/bootstrap.json, and reloaded on every subsequent boot.
//
// Login / magic-link / OAuth still use these secrets at runtime — they are
// just not something the operator has to invent in Portainer before the
// app will start. Cloudflare Tunnel only needs a listening port.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function hex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function resolveBootstrapPath(explicitPath) {
  if (explicitPath) return explicitPath;
  const dockerPath = '/app/data/bootstrap.json';
  try {
    fs.accessSync(path.dirname(dockerPath), fs.constants.W_OK);
    return dockerPath;
  } catch {
    return path.resolve(process.cwd(), 'data', 'bootstrap.json');
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
 * Ensure process.env has AUTH_TOKEN + SESSION_SECRET for a Docker deploy.
 * Idempotent. Never throws for missing secrets — generates them.
 *
 * @returns {{ path: string, generated: string[] }}
 */
function ensureDockerDeploySecrets({ bootstrapFile } = {}) {
  const bootstrapPath = resolveBootstrapPath(bootstrapFile || process.env.BOOTSTRAP_FILE);
  const existing = readBootstrap(bootstrapPath);
  const generated = [];
  let dirty = false;

  // Prefer explicit env, then file, then generate.
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
  // Keep * only as last resort for LAN/tunnel first boot; Cloudflare can
  // set APP_URL / ALLOWED_ORIGINS later. Do not block bind.
  if (!allowedOrigins) {
    allowedOrigins = '*';
    if (!existing.allowedOrigins) dirty = true;
  }

  process.env.AUTH_TOKEN = authToken;
  process.env.SESSION_SECRET = sessionSecret;
  if (!process.env.ALLOWED_ORIGINS || !process.env.ALLOWED_ORIGINS.trim()) {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
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

  return { path: bootstrapPath, generated };
}

module.exports = {
  ensureDockerDeploySecrets,
  resolveBootstrapPath,
  readBootstrap,
  writeBootstrap,
};
