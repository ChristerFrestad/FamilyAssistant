// HTTP server lifecycle: request \u2192 middleware chain \u2192 route handler \u2192 response
// Inkluderer unified error handling (RFC 7807) og structured request logging.

const http = require('http');
const fs = require('fs');
const path = require('path');

const { config } = require('../config');
const { HttpError, errors } = require('./errors');
const {
  handleCorsPreflight,
  applyCorsHeaders,
  parseBody,
  createContext,
  parseQuery,
} = require('./middleware');
const { rateLimit, applySecurityHeaders } = require('./security');
const { runWithFamily } = require('../auth/family-context');
const metrics = require('./metrics');
const sentry = require('../observability/sentry');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// ============================================================
// Static file serving (fallback for SPA)
// ============================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    const headers = { 'Content-Type': mime };
    const basename = path.basename(filePath);
    // M5.2: Service worker MÅ serves uten langtids-cache, og må kunne kontrollere
    // roten av originen. Service-Worker-Allowed tillater dette eksplisitt.
    if (basename === 'sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, must-revalidate';
    }
    res.writeHead(200, headers);
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function tryServeSpaFallback(pathname, res) {
  const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const resolved = path.resolve(filePath);
  if (path.relative(PUBLIC_DIR, resolved).startsWith('..')) return false;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveStatic(res, filePath);
  }
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return serveStatic(res, indexPath);
  }
  return false;
}

// ============================================================
// Main server
// ============================================================

function createServer(router, { authenticate } = {}) {
  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (handleCorsPreflight(req, res)) return;
    applyCorsHeaders(res, req.headers.origin);
    applySecurityHeaders(res);

    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const query = parseQuery(url);
    const ctx = createContext(req, res, pathname, query);
    let routeTemplate = pathname; // overridet etter dispatch

    try {
      // Rate limit + authentication always first (incl. static files).
      // When authenticate is injected it performs bearer-token fallback,
      // session-cookie lookup and attaches ctx.user / ctx.familyId.
      rateLimit(ctx);
      // Phase 22 — in BOOTSTRAP_MODE we deliberately skip auth. There is
      // no AUTH_TOKEN yet; the setup wizard has to be reachable, and the
      // catch-all in routes.js blocks every non-bootstrap API path with
      // a 503 that points at /setup.html.
      if (authenticate && !config.BOOTSTRAP_MODE) authenticate(ctx);

      // Wrap routing + handler execution in the family async-local context so
      // that every repo query inside the handler picks up the caller's family.
      const familyId = Number.isInteger(ctx.familyId) && ctx.familyId > 0 ? ctx.familyId : null;
      const runRouted = async () => {
        const dispatched = router.dispatch(req.method, pathname);

        if (!dispatched) {
          // /api/* and /metrics are never served as SPA fallback — return 404.
          const isApi = pathname.startsWith('/api/') || pathname === '/metrics';
          if (!isApi && req.method === 'GET' && tryServeSpaFallback(pathname, res)) {
            const dur = Date.now() - started;
            metrics.record(req.method, 'static', 200, dur);
            logRequest(ctx, 200, dur, 'static');
            return;
          }
          ctx.problem(errors.notFound(`Route ${req.method} ${pathname} not found`));
          const dur = Date.now() - started;
          metrics.record(req.method, 'not_found', 404, dur);
          logRequest(ctx, 404, dur);
          return;
        }

        routeTemplate = dispatched.route.path;
        ctx.params = dispatched.params;

        // Parse body for POST/PUT/DELETE.
        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
          try {
            ctx.body = await parseBody(req);
          } catch (err) {
            ctx.problem(err instanceof HttpError ? err : errors.badRequest(err.message));
            const dur = Date.now() - started;
            metrics.record(req.method, routeTemplate, err.status || 400, dur);
            logRequest(ctx, err.status || 400, dur);
            return;
          }
        }

        await router.runHandlers(ctx, dispatched.route.handlers);
        if (!res.writableEnded) {
          ctx.json({ ok: true });
        }
        const dur = Date.now() - started;
        metrics.record(req.method, routeTemplate, res.statusCode, dur);
        logRequest(ctx, res.statusCode, dur);
      };

      if (familyId) {
        await runWithFamily(familyId, runRouted);
      } else {
        await runRouted();
      }
    } catch (err) {
      const dur = Date.now() - started;
      const status = err instanceof HttpError ? err.status : 500;
      metrics.record(req.method, routeTemplate, status, dur);
      handleError(ctx, err, dur);
    }
  });

  return server;
}

function handleError(ctx, err, durationMs) {
  if (err instanceof HttpError) {
    ctx.problem(err);
    logRequest(ctx, err.status, durationMs, err.detail);
    return;
  }
  // Uventet feil \u2014 maskerer detaljer i produksjon
  ctx.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
  // Phase 17: ship the 500 to Sentry with scrubbed request + hashed family-id
  // user context. No-op if Sentry is not initialised.
  sentry.captureException(err, ctx);
  ctx.problem(errors.internal(config.NODE_ENV === 'production' ? 'Intern feil' : err.message));
  logRequest(ctx, 500, durationMs, err.message);
}

function logRequest(ctx, status, durationMs, extra) {
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  ctx.log[level]({
    method: ctx.req.method,
    path: ctx.pathname,
    status,
    durationMs,
    ...(extra ? { detail: extra } : {}),
  });
}

module.exports = { createServer };
