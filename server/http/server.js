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
const { tryHandleMarketing, tryServeAppRobots } = require('./marketing');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// ============================================================
// Static file serving (fallback for SPA)
// ============================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    const headers = { 'Content-Type': mime };
    const basename = path.basename(filePath);
    // M5.2: Service worker MUST be served without long-term cache and must be able to control
    // roten av originen. Service-Worker-Allowed tillater dette eksplisitt.
    if (basename === 'sw.js' || basename === 'index.html') {
      if (basename === 'sw.js') headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, must-revalidate';
    }
    res.writeHead(200, headers);
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// The React app (built into public/v2/) is the only frontend. Public URLs
// have no /v2 prefix: /login, /dashboard, /assets/*. The build folder name
// is an implementation detail. Legacy /v2/* bookmarks get a 301.
const ALLOWED_PUBLIC_FILES = new Set([
  '/privacy.html',
  '/privacy-en.html',
  '/terms.html',
  '/terms-en.html',
  '/sw.js',
  // Phase 22 zero-config Docker/Portainer wizard. Restored after Sprint 8
  // accidentally deleted public/setup.html (see docs/known-issues/
  // setup-html-missing-after-sprint-8-cleanup.md). Self-contained HTML +
  // inline JS — no /js/setup.js dependency.
  '/setup.html',
]);

function tryServePublicFile(pathname, res) {
  if (!ALLOWED_PUBLIC_FILES.has(pathname)) return false;
  const filePath = path.join(PUBLIC_DIR, pathname);
  const resolved = path.resolve(filePath);
  // Defence in depth: even though pathname is matched against an exact-
  // string set, refuse to serve if path resolution escapes the public dir.
  if (path.relative(PUBLIC_DIR, resolved).startsWith('..')) return false;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveStatic(res, filePath);
  }
  return false;
}

// ============================================================
// React SPA — files live in public/v2/, URLs do not include /v2
// ============================================================
const SPA_DIR = path.join(PUBLIC_DIR, 'v2');

function isReservedFromSpa(pathname) {
  if (pathname === '/health' || pathname === '/ready' || pathname === '/metrics') return true;
  if (pathname.startsWith('/api/')) return true;
  // Legal pages + setup wizard stay as real files, not SPA fallback.
  if (pathname === '/privacy.html' || pathname === '/privacy-en.html') return true;
  if (pathname === '/terms.html' || pathname === '/terms-en.html') return true;
  if (pathname === '/setup.html') return true;
  return false;
}

function looksLikeStaticAsset(pathname) {
  const base = pathname.split('/').pop() || '';
  return base.includes('.') && !base.endsWith('.html');
}

function tryRedirectLegacyV2(req, res, pathname) {
  if (pathname !== '/v2' && !pathname.startsWith('/v2/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const dest = pathname === '/v2' || pathname === '/v2/' ? '/' : pathname.slice('/v2'.length);
  const url = new URL(req.url, 'http://localhost');
  res.writeHead(301, { Location: dest + url.search });
  res.end();
  return true;
}

function tryServeSpaApp(pathname, res) {
  if (isReservedFromSpa(pathname)) return false;
  if (!fs.existsSync(SPA_DIR) || !fs.statSync(SPA_DIR).isDirectory()) {
    return false;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');

  if (rel && rel !== 'index.html') {
    const filePath = path.join(SPA_DIR, rel);
    const resolved = path.resolve(filePath);
    if (path.relative(SPA_DIR, resolved).startsWith('..')) return false;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStatic(res, filePath);
    }
    // Missing hashed asset / unknown file → 404, not the HTML shell.
    if (looksLikeStaticAsset(pathname)) return false;
  }

  const indexPath = path.join(SPA_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return serveStatic(res, indexPath);
  }
  return false;
}

function tryServeSw(pathname, res) {
  if (pathname !== '/sw.js') return false;
  const spaSw = path.join(SPA_DIR, 'sw.js');
  if (fs.existsSync(spaSw) && fs.statSync(spaSw).isFile()) {
    return serveStatic(res, spaSw);
  }
  return tryServePublicFile(pathname, res);
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

    // Default noindex: /login, /dashboard and the SPA must not compete
    // with the landing page. Marketing sendFile() overwrites this.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    try {
      // Apex / listed marketing hosts serve crawlable HTML, never the SPA
      // and never the bootstrap wizard.
      if (tryHandleMarketing(req, res, pathname, config)) {
        const dur = Date.now() - started;
        const status = res.statusCode || 200;
        metrics.record(req.method, 'marketing', status, dur);
        logRequest(ctx, status, dur, 'marketing');
        return;
      }

      if (tryServeAppRobots(req, res, pathname, config)) {
        const dur = Date.now() - started;
        metrics.record(req.method, '/robots.txt', 200, dur);
        logRequest(ctx, 200, dur, 'app_robots');
        return;
      }

      // Fresh Docker install: land on the Portainer wizard, not the SPA.
      if (pathname === '/' && req.method === 'GET' && config.BOOTSTRAP_MODE) {
        res.writeHead(302, { Location: '/setup.html' });
        res.end();
        const dur = Date.now() - started;
        metrics.record(req.method, '/', 302, dur);
        logRequest(ctx, 302, dur, 'root_redirect_setup');
        return;
      }

      // Bookmarks, emails, and cached HTML still use /v2/*.
      if (tryRedirectLegacyV2(req, res, pathname)) {
        const dur = Date.now() - started;
        metrics.record(req.method, '/v2/*', 301, dur);
        logRequest(ctx, 301, dur, 'legacy_v2_redirect');
        return;
      }

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
          // /api/* and /metrics are never served as static — return 404.
          const isApi = pathname.startsWith('/api/') || pathname === '/metrics';
          if (!isApi && req.method === 'GET') {
            if (
              tryServeSw(pathname, res) ||
              tryServePublicFile(pathname, res) ||
              tryServeSpaApp(pathname, res)
            ) {
              const dur = Date.now() - started;
              metrics.record(req.method, 'static', 200, dur);
              logRequest(ctx, 200, dur, 'static');
              return;
            }
          }
          ctx.problem(errors.notFound(`Route ${req.method} ${pathname} not found`));
          const dur = Date.now() - started;
          metrics.record(req.method, 'not_found', 404, dur);
          logRequest(ctx, 404, dur);
          return;
        }

        routeTemplate = dispatched.route.path;
        ctx.params = dispatched.params;

        // Parse body for write methods (PATCH: chore catalog + recipe update).
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          try {
            const maxBytes = pathname === '/api/family/backup/import' ? 2 * 1024 * 1024 : undefined;
            ctx.body = await parseBody(req, maxBytes ? { maxBytes } : {});
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
