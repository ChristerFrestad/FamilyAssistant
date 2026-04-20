// Phase 22 — bootstrap mode: zero-config Docker deploy + setup wizard.
//
// When the server starts in BOOTSTRAP_MODE (see server/config.js for the
// activation rules), this router is the ONLY thing responding on /api/*.
// Non-bootstrap endpoints return 503 with a redirect hint to /setup.html.
//
// Endpoints:
//   GET  /api/bootstrap/status        — mode introspection
//   POST /api/bootstrap/generate-token — server-side 32-hex token
//   POST /api/bootstrap/complete      — persist {authToken, allowedOrigins,
//                                       llmBackend?, ollamaHost?, logLevel?}
//                                       to /app/data/bootstrap.json, then
//                                       gracefully exit so Docker restarts
//                                       the container in normal mode.
//
// Security design:
//   - Only active on first-run (empty data volume + BOOTSTRAP_ALLOWED=true)
//   - complete() uses {flag: 'wx'} so concurrent setup attempts get 409
//   - authToken is server-validated for length before persistence
//   - File is written with 0600 permissions
//   - After success we exit(0); Docker restart policy brings us back up,
//     this time with AUTH_TOKEN set from the file.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { errors } = require('./errors');
const { generateSessionSecret } = require('../auth/bootstrap-session-secret');

const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const ALLOWED_LLM_BACKENDS = new Set(['ollama', 'llamacpp']);

function resolveBootstrapPath(config) {
  if (config?.BOOTSTRAP_FILE) return config.BOOTSTRAP_FILE;
  // Default to the Docker mount; fall back to cwd/data for local dev.
  const dockerPath = '/app/data/bootstrap.json';
  const localPath = path.resolve(process.cwd(), 'data', 'bootstrap.json');
  try {
    // Prefer the docker mount if its parent exists (we're in a container).
    fs.accessSync(path.dirname(dockerPath), fs.constants.W_OK);
    return dockerPath;
  } catch {
    return localPath;
  }
}

function handleStatus(ctx, config) {
  ctx.json({
    mode: config.BOOTSTRAP_MODE ? 'bootstrap' : 'normal',
    allowed: Boolean(config.BOOTSTRAP_ALLOWED),
    persistedAt: config.BOOTSTRAP_FILE_PATH || null,
    setupUrl: config.BOOTSTRAP_MODE ? '/setup.html' : null,
  });
}

function handleGenerateToken(ctx) {
  const token = crypto.randomBytes(32).toString('hex');
  ctx.json({ token });
}

function handleComplete(ctx, config, exitFn) {
  if (!config.BOOTSTRAP_MODE) {
    throw errors.forbidden('Bootstrap is not active. Instance is already configured.');
  }

  const body = ctx.body || {};
  const authToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';
  if (authToken.length < 16) {
    throw errors.badRequest('authToken must be at least 16 characters.');
  }
  if (authToken.length > 256) {
    throw errors.badRequest('authToken is unreasonably long.');
  }

  const allowedOrigins =
    typeof body.allowedOrigins === 'string' && body.allowedOrigins.trim()
      ? body.allowedOrigins.trim()
      : '*';
  // Disallow a plain '*' in the persisted file — bootstrap-mode accepts it
  // temporarily, but once persisted we write the instance's real origin.
  if (allowedOrigins === '*') {
    throw errors.badRequest(
      'allowedOrigins must be an explicit origin or comma-separated list, not "*".'
    );
  }

  const llmBackend =
    typeof body.llmBackend === 'string' && ALLOWED_LLM_BACKENDS.has(body.llmBackend)
      ? body.llmBackend
      : 'ollama';
  const ollamaHost =
    typeof body.ollamaHost === 'string' && body.ollamaHost.trim()
      ? body.ollamaHost.trim()
      : 'http://host.docker.internal:11434';
  const logLevel =
    typeof body.logLevel === 'string' && ALLOWED_LOG_LEVELS.has(body.logLevel)
      ? body.logLevel
      : 'info';

  // Multi-tenant auth (uke 2 B1): persist SESSION_SECRET alongside
  // AUTH_TOKEN so new installs have working session auth from boot one.
  // Upgrade installs that predate this get the secret self-healed in
  // config.js (see auth/bootstrap-session-secret.js).
  const sessionSecret = generateSessionSecret();

  const payload = {
    completedAt: new Date().toISOString(),
    authToken,
    sessionSecret,
    sessionSecretGeneratedAt: new Date().toISOString(),
    allowedOrigins,
    llmBackend,
    ollamaHost,
    logLevel,
    generatedBy: 'setup-wizard',
    version: 2,
  };

  const targetPath = resolveBootstrapPath(config);
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw errors.conflict('Bootstrap already completed. Remove bootstrap.json to redo setup.');
    }
    throw errors.internal(`Failed to persist bootstrap: ${err.message}`);
  }

  ctx.json({
    ok: true,
    restarting: true,
    persistedTo: targetPath,
    message:
      'Setup complete. The container will restart in a moment. Wait ~10 seconds and reload the app.',
  });

  // Graceful shutdown so Docker restart-policy brings the container back
  // up with AUTH_TOKEN now loaded from bootstrap.json. Using setImmediate
  // lets the HTTP response flush first.
  setImmediate(() => {
    (exitFn || process.exit)(0);
  });
}

function registerBootstrapRoutes(router, { config, exitFn } = {}) {
  router.get('/api/bootstrap/status', (ctx) => handleStatus(ctx, config));
  router.post('/api/bootstrap/generate-token', (ctx) => handleGenerateToken(ctx));
  router.post('/api/bootstrap/complete', (ctx) => handleComplete(ctx, config, exitFn));
}

module.exports = {
  registerBootstrapRoutes,
  // Exported for tests:
  resolveBootstrapPath,
  handleStatus,
  handleGenerateToken,
  handleComplete,
};
