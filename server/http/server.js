// HTTP server lifecycle: request \u2192 middleware chain \u2192 route handler \u2192 response
// Inkluderer unified error handling (RFC 7807) og structured request logging.

const http = require('http');
const fs = require('fs');
const path = require('path');

const { config } = require('../config');
const { logger } = require('../logger');
const { HttpError, errors } = require('./errors');
const {
  handleCorsPreflight,
  applyCorsHeaders,
  parseBody,
  createContext,
  parseQuery,
} = require('./middleware');
const { bearerAuth, rateLimit, applySecurityHeaders } = require('./security');
const metrics = require('./metrics');

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
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
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

function createServer(router) {
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
      // Fase 4: rate limit + auth f\u00f8r routing
      rateLimit(ctx);
      bearerAuth(ctx);

      const dispatched = router.dispatch(req.method, pathname);

      if (!dispatched) {
        // /api/* og /metrics g\u00e5r aldri gjennom SPA-fallback \u2014 returner 404.
        // Ellers pr\u00f8v SPA-fallback for GET (klient-navigasjon).
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

      // Parse body for POST/PUT/DELETE
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
        // Handler returnerte undefined uten \u00e5 skrive respons
        ctx.json({ ok: true });
      }
      const dur = Date.now() - started;
      metrics.record(req.method, routeTemplate, res.statusCode, dur);
      logRequest(ctx, res.statusCode, dur);
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
