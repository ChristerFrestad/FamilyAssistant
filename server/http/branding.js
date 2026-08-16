// Sprint 10 — runtime branding endpoints.
//
// Three public, no-auth routes that let the same Docker image render
// any white-label brand based on env-vars:
//
//   GET /api/config       → JSON snapshot of brand fields the frontend
//                            consumes via useBrandConfig()
//   GET /favicon.svg      → SVG rendered from the favicon template
//                            with {{LETTER}} + {{APP_NAME}} substituted
//   GET /logo-mark.svg    → larger SVG for splash + OG-image fallback
//   GET /manifest.json    → PWA manifest with brand-aware name/colors
//
// Templates live under server/branding/templates/ (server-only — not
// exposed as raw browser assets so the {{...}} placeholders never
// leak). Each template is loaded once at module-init; runtime cost
// per request is one string-replace pass.
//
// Cache policy:
//   /api/config        public, max-age=300  (5 min)
//   /favicon.svg       public, max-age=3600 (1 hour, but browsers
//                      cache favicons aggressively regardless — see
//                      cache-bust query in client/src/main.tsx)
//   /logo-mark.svg     public, max-age=3600
//   /manifest.json     public, max-age=300
//
// Why 5 min on /api/config + /manifest.json: the frontend reads them
// at every cold-load, and an operator that flips brand env-vars wants
// users to see the new brand within minutes — not the full hour the
// SVG endpoints get. The trade-off is one extra fetch per page-load
// in the worst case (after 5 min), still a single 1.6 KB JSON.
// Removed the `immutable` flag from SVG cache because the rendered
// content does change when env flips; immutable would actively defeat
// the cache-bust query string we now ship with the favicon link.

const fs = require('fs');
const path = require('path');

const pngRenderer = require('../branding/png-renderer');
const { getInstanceIntegrationsPublic } = require('../llm/instance-fallback');

const TEMPLATES_DIR = path.join(__dirname, '..', 'branding', 'templates');
const FAVICON_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'favicon.template.svg'), 'utf8');
const LOGO_MARK_TEMPLATE = fs.readFileSync(
  path.join(TEMPLATES_DIR, 'logo-mark.template.svg'),
  'utf8'
);
const OG_IMAGE_TEMPLATE = fs.readFileSync(
  path.join(TEMPLATES_DIR, 'og-image.template.svg'),
  'utf8'
);

const SVG_CACHE = 'public, max-age=3600';
const CONFIG_CACHE = 'public, max-age=300';
// PNGs are expensive to regenerate (50 ms favicon → 400 ms og-image)
// and change only when an operator flips brand env-vars and
// redeploys, so a longer browser cache is appropriate.
const PNG_CACHE = 'public, max-age=86400';

function escapeXml(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Validates and normalizes APP_FAVICON_LETTER for inclusion in SVG.
// The Zod schema already rejects non-letters at boot, but a runtime
// double-check costs nothing and protects against config-mutation in
// tests.
function sanitizeLetter(input) {
  if (typeof input !== 'string' || input.length !== 1) return 'F';
  return /^[a-zA-Z]$/.test(input) ? input : 'F';
}

function renderTemplate(template, config) {
  const letter = sanitizeLetter(config.APP_FAVICON_LETTER);
  return template
    .split('{{LETTER}}')
    .join(escapeXml(letter))
    .split('{{APP_NAME}}')
    .join(escapeXml(config.APP_NAME))
    .split('{{APP_TAGLINE}}')
    .join(escapeXml(config.APP_TAGLINE || ''));
}

function handleFavicon(ctx, config) {
  const svg = renderTemplate(FAVICON_TEMPLATE, config);
  ctx.res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': SVG_CACHE,
    'Content-Length': Buffer.byteLength(svg, 'utf8'),
  });
  ctx.res.end(svg);
}

function handleLogoMark(ctx, config) {
  const svg = renderTemplate(LOGO_MARK_TEMPLATE, config);
  ctx.res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': SVG_CACHE,
    'Content-Length': Buffer.byteLength(svg, 'utf8'),
  });
  ctx.res.end(svg);
}

// PNG handlers. Each one renders the source SVG with the current
// brand-config, then sharp-rasterises it to the target dimensions.
// Cache + ETag come from png-renderer; the handler maps result to
// HTTP response headers.
async function handlePng({ ctx, config, template, width, height, endpoint }) {
  try {
    const ifNoneMatch = ctx.req.headers['if-none-match'];
    const svg = renderTemplate(template, config);
    const { buffer, etag } = await pngRenderer.renderPng({
      endpoint,
      config,
      svg,
      width,
      height,
    });

    const shareHeaders =
      endpoint === 'og-image' ? { 'Cross-Origin-Resource-Policy': 'cross-origin' } : {};

    if (ifNoneMatch && ifNoneMatch === etag) {
      ctx.res.writeHead(304, {
        ETag: etag,
        'Cache-Control': PNG_CACHE,
        ...shareHeaders,
      });
      ctx.res.end();
      return;
    }

    ctx.res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': PNG_CACHE,
      ETag: etag,
      'Content-Length': buffer.length,
      ...shareHeaders,
    });
    ctx.res.end(buffer);
  } catch (err) {
    // Sharp not loaded → 503 with a clear reason. Frontend falls back
    // to the SVG favicon/logo-mark, which always works. Any other
    // failure propagates as 500 via the central error handler.
    if (err.code === 'SHARP_UNAVAILABLE') {
      ctx.res.writeHead(503, {
        'Content-Type': 'application/problem+json',
        'Cache-Control': 'no-store',
      });
      ctx.res.end(
        JSON.stringify({
          title: 'PNG renderer unavailable',
          detail: err.message,
          status: 503,
        })
      );
      return;
    }
    throw err;
  }
}

// Public brand-config snapshot. Only fields that drive UI/branding are
// exposed — env-vars carrying secrets (SESSION_SECRET, RESEND_API_KEY,
// AUTH_TOKEN, etc.) are NOT in this surface. Schema additions must be
// reviewed for sensitivity before going in.
function handleApiConfig(ctx, config) {
  const body = JSON.stringify({
    appName: config.APP_NAME,
    namePrimary: config.APP_NAME_PRIMARY,
    nameAccent: config.APP_NAME_ACCENT,
    faviconLetter: config.APP_FAVICON_LETTER,
    tagline: config.APP_TAGLINE,
    primaryColor: config.APP_PRIMARY_COLOR,
    accentColor: config.APP_ACCENT_COLOR,
    dotColor: config.APP_DOT_COLOR,
    integrations: getInstanceIntegrationsPublic(),
  });
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': CONFIG_CACHE,
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  ctx.res.end(body);
}

// PWA manifest — Sprint 8 deleted the static public/manifest.json so a
// browser that hits /manifest.json (legacy v1 path) currently 404s.
// Sprint 10 replaces it with a dynamic, brand-aware response served at
// the same path. v2 frontend also references this via
// <link rel="manifest" href="/manifest.json"> in client/index.html.
function handleManifest(ctx, config) {
  const manifest = {
    name: config.APP_NAME,
    short_name: config.APP_NAME,
    description: config.APP_TAGLINE,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F7F3E8',
    theme_color: config.APP_PRIMARY_COLOR,
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/logo-mark.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      // Sprint-11 / issue #123 — PNG fallbacks for Android adaptive
      // icons. Browsers that don't honour SVG manifest icons (some
      // older Android versions, certain PWA install flows) pick
      // these up by size.
      {
        src: '/android-chrome-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/android-chrome-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  const body = JSON.stringify(manifest);
  ctx.res.writeHead(200, {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': CONFIG_CACHE,
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  ctx.res.end(body);
}

function registerBrandingRoutes(router, { config }) {
  if (!config) throw new Error('registerBrandingRoutes: config is required');
  router.get('/favicon.svg', (ctx) => handleFavicon(ctx, config));
  router.get('/logo-mark.svg', (ctx) => handleLogoMark(ctx, config));
  router.get('/api/config', (ctx) => handleApiConfig(ctx, config));
  router.get('/manifest.json', (ctx) => handleManifest(ctx, config));

  // Sprint-11 / issue #123 — PNG raster derivatives.
  router.get('/favicon-32.png', (ctx) =>
    handlePng({
      ctx,
      config,
      template: FAVICON_TEMPLATE,
      width: 32,
      height: 32,
      endpoint: 'favicon-32',
    })
  );
  router.get('/apple-touch-icon.png', (ctx) =>
    handlePng({
      ctx,
      config,
      template: LOGO_MARK_TEMPLATE,
      width: 180,
      height: 180,
      endpoint: 'apple-touch-icon',
    })
  );
  router.get('/android-chrome-192.png', (ctx) =>
    handlePng({
      ctx,
      config,
      template: LOGO_MARK_TEMPLATE,
      width: 192,
      height: 192,
      endpoint: 'android-chrome-192',
    })
  );
  router.get('/android-chrome-512.png', (ctx) =>
    handlePng({
      ctx,
      config,
      template: LOGO_MARK_TEMPLATE,
      width: 512,
      height: 512,
      endpoint: 'android-chrome-512',
    })
  );
  router.get('/og-image.png', (ctx) =>
    handlePng({
      ctx,
      config,
      template: OG_IMAGE_TEMPLATE,
      width: 1200,
      height: 630,
      endpoint: 'og-image',
    })
  );
}

module.exports = {
  registerBrandingRoutes,
  // Exported for unit tests that want to assert on the rendered output
  // without spinning up the full HTTP stack.
  __renderTemplate: renderTemplate,
  __FAVICON_TEMPLATE: FAVICON_TEMPLATE,
  __LOGO_MARK_TEMPLATE: LOGO_MARK_TEMPLATE,
  __OG_IMAGE_TEMPLATE: OG_IMAGE_TEMPLATE,
};
