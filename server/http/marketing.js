// Public marketing pages on the same origin as the app.
//
// Path-split, not host-split:
//   GET /  /middag/  /llms.txt  /site/*  → static HTML
//   GET /login  /dashboard  /api/*       → SPA / API
//
// MARKETING_HOSTS gates this so a LAN/self-host `/` stays the SPA.
// Empty default = off. www.* 301s to MARKETING_CANONICAL.
// Operator production hostnames must not appear in this repo;
// {{CANONICAL}} in marketing files is rewritten at serve time.

'use strict';

const fs = require('fs');
const path = require('path');
const { applyMarketingDocumentHeaders } = require('./security');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const SRC_DIR = path.join(__dirname, '..', '..', 'marketing');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const OPS_PATHS = new Set(['/health', '/ready', '/metrics']);

const MARKETING_PAGE_ROOTS = new Set([
  '',
  'en',
  'middag',
  'handleliste',
  'gjoremål',
  'slik-fungerer-det',
  'personvern',
  'vilkar',
]);

const MARKETING_FILES = new Set(['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt']);

function isReservedAppPath(pathname) {
  if (OPS_PATHS.has(pathname) || pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/assets/')) return true;
  return false;
}

function isMarketingPath(pathname) {
  const decoded = decodePathname(pathname);
  const raw = decoded === '/' ? '' : decoded.replace(/^\/+|\/+$/g, '');
  if (raw === '') return true;
  if (MARKETING_FILES.has(raw)) return true;
  if (raw.startsWith('site/') || raw === 'site') return true;
  if (raw.startsWith('screens/') || raw === 'screens') return true;
  if (raw.startsWith('fonts/') || raw === 'fonts') return true;
  const first = raw.split('/')[0];
  return MARKETING_PAGE_ROOTS.has(first);
}

function normalizeHost(hostHeader) {
  if (!hostHeader) return '';
  return String(hostHeader).split(':')[0].trim().toLowerCase();
}

function isMarketingHost(hostHeader, hostSet) {
  if (!hostSet || hostSet.size === 0) return false;
  return hostSet.has(normalizeHost(hostHeader));
}

function wwwDir() {
  return path.join(PUBLIC_DIR, 'www');
}

function marketingRoots() {
  const roots = [];
  if (fs.existsSync(path.join(SRC_DIR, 'index.html'))) roots.push(SRC_DIR);
  const www = wwwDir();
  // CI and fresh checkouts have no public/www/index.html (gitignored).
  // Still search the directory so /fonts can fall back after mkdir.
  if (fs.existsSync(www) && fs.statSync(www).isDirectory()) roots.push(www);
  return roots;
}

function marketingRoot() {
  return marketingRoots()[0] || wwwDir();
}

function resolveSafe(root, rel) {
  const target = path.resolve(root, rel);
  const relToRoot = path.relative(root, target);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
  return target;
}

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function existingFile(root, rel) {
  const asFile = resolveSafe(root, rel);
  if (asFile && fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return asFile;
  return null;
}

function mapPathnameToFile(root, pathname) {
  const decoded = decodePathname(pathname);
  const raw = decoded === '/' ? '' : decoded.replace(/^\/+|\/+$/g, '');
  if (!raw) {
    return existingFile(root, 'index.html');
  }

  // /site/* is the marketing static prefix so we never collide with
  // the SPA's hashed /assets/main-*.js files.
  if (raw === 'site' || raw.startsWith('site/')) {
    const rest = raw === 'site' ? '' : raw.slice('site/'.length);
    return (
      existingFile(root, path.join('site', rest)) ||
      existingFile(root, path.join('assets', rest)) ||
      existingFile(root, path.join('site', rest, 'index.html'))
    );
  }

  const direct = existingFile(root, raw);
  if (direct) return direct;

  return existingFile(root, path.join(raw, 'index.html'));
}

function cacheControlFor(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath);
  if (base === 'robots.txt' || base === 'sitemap.xml' || base.startsWith('llms')) {
    return 'public, max-age=300';
  }
  if (ext === '.html') return 'public, max-age=60, stale-while-revalidate=600';
  if (ext === '.woff2' || ext === '.png' || ext === '.webp' || ext === '.avif' || ext === '.svg') {
    return 'public, max-age=86400';
  }
  return 'public, max-age=3600';
}

const REWRITE_EXTS = new Set(['.html', '.txt', '.xml']);

function rewriteCanonical(buf, origin) {
  if (!origin) return buf;
  let text = buf.toString('utf8');
  if (!text.includes('{{CANONICAL}}') && !text.includes('{{CANONICAL_HOST}}')) return buf;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = origin.replace(/^https?:\/\//, '');
  }
  text = text.split('{{CANONICAL}}').join(origin);
  text = text.split('{{CANONICAL_HOST}}').join(host);
  return Buffer.from(text, 'utf8');
}

function sendFile(res, filePath, method, origin) {
  applyMarketingDocumentHeaders(res);
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Cache-Control': cacheControlFor(filePath),
    'X-Robots-Tag': 'index, follow',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': res.getHeader('Content-Security-Policy'),
  };
  if (method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  let content = fs.readFileSync(filePath);
  if (REWRITE_EXTS.has(ext)) content = rewriteCanonical(content, origin);
  res.writeHead(200, headers);
  res.end(content);
}

function redirectWww(req, res, canonical) {
  const host = normalizeHost(req.headers.host);
  if (!host.startsWith('www.')) return false;
  const apex = host.slice(4);
  const destBase = (canonical && String(canonical).replace(/\/$/, '')) || `https://${apex}`;
  const url = new URL(req.url, 'http://localhost');
  res.writeHead(301, { Location: destBase + url.pathname + url.search });
  res.end();
  return true;
}

/**
 * Handle a marketing page. Unknown paths return false so /login and
 * /dashboard stay the SPA on the same host.
 */
function tryHandleMarketing(req, res, pathname, config) {
  const hosts = config.MARKETING_HOST_SET;
  if (!isMarketingHost(req.headers.host, hosts)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (isReservedAppPath(pathname)) return false;

  if (redirectWww(req, res, config.MARKETING_CANONICAL)) return true;
  if (!isMarketingPath(pathname)) return false;

  const roots = marketingRoots();
  if (roots.length === 0) return false;

  let filePath = null;
  for (const root of roots) {
    filePath = mapPathnameToFile(root, pathname);
    if (filePath) break;
  }
  if (!filePath) return false;

  const origin =
    (config.MARKETING_CANONICAL && String(config.MARKETING_CANONICAL).replace(/\/$/, '')) ||
    `https://${normalizeHost(req.headers.host)}`;

  try {
    sendFile(res, filePath, req.method, origin);
    return true;
  } catch {
    return false;
  }
}

function appRobotsBody() {
  return 'User-agent: *\nDisallow: /\n';
}

function tryServeAppRobots(req, res, pathname, config) {
  if (pathname !== '/robots.txt') return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (isMarketingHost(req.headers.host, config.MARKETING_HOST_SET)) return false;
  const body = appRobotsBody();
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

module.exports = {
  normalizeHost,
  isMarketingHost,
  isMarketingPath,
  tryHandleMarketing,
  tryServeAppRobots,
  marketingRoot,
  mapPathnameToFile,
  rewriteCanonical,
};
