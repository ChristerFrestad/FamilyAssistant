// Host-gated public marketing site (Hverdagsplanleggeren apex).
//
// Default off: MARKETING_HOSTS empty → every request falls through to
// the SPA. When the Host header is in MARKETING_HOSTS the server
// serves crawlable HTML from public/www/ (or marketing/ if the
// build output is missing) and never the React shell.
//
// www.* aliases 301 to MARKETING_CANONICAL (or https://<apex>).
// /health /ready /metrics /api/* stay on the app even on a marketing
// host so the same container remains operable.

'use strict';

const fs = require('fs');
const path = require('path');

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

function normalizeHost(hostHeader) {
  if (!hostHeader) return '';
  return String(hostHeader).split(':')[0].trim().toLowerCase();
}

function isMarketingHost(hostHeader, hostSet) {
  if (!hostSet || hostSet.size === 0) return false;
  return hostSet.has(normalizeHost(hostHeader));
}

function marketingRoot() {
  const builtIndex = path.join(PUBLIC_DIR, 'www', 'index.html');
  if (fs.existsSync(builtIndex)) return path.join(PUBLIC_DIR, 'www');
  const srcIndex = path.join(SRC_DIR, 'index.html');
  if (fs.existsSync(srcIndex)) return SRC_DIR;
  return path.join(PUBLIC_DIR, 'www');
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

function mapPathnameToFile(root, pathname) {
  const decoded = decodePathname(pathname);
  const raw = decoded === '/' ? '' : decoded.replace(/^\/+|\/+$/g, '');
  if (!raw) {
    return resolveSafe(root, 'index.html');
  }

  const asFile = resolveSafe(root, raw);
  if (asFile && fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
    return asFile;
  }

  const asIndex = resolveSafe(root, path.join(raw, 'index.html'));
  if (asIndex && fs.existsSync(asIndex) && fs.statSync(asIndex).isFile()) {
    return asIndex;
  }

  return null;
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

function sendFile(res, filePath, method) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Cache-Control': cacheControlFor(filePath),
    'X-Robots-Tag': 'index, follow',
  };
  if (method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  const content = fs.readFileSync(filePath);
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

function sendMarketingNotFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Robots-Tag': 'noindex',
    'Cache-Control': 'no-store',
  });
  res.end('Not found');
}

/**
 * Handle a request when (and only when) Host is a marketing host.
 * Returns true if the response was ended.
 */
function tryHandleMarketing(req, res, pathname, config) {
  const hosts = config.MARKETING_HOST_SET;
  if (!isMarketingHost(req.headers.host, hosts)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (OPS_PATHS.has(pathname) || pathname.startsWith('/api/')) return false;

  if (redirectWww(req, res, config.MARKETING_CANONICAL)) return true;

  const root = marketingRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    sendMarketingNotFound(res);
    return true;
  }

  const filePath = mapPathnameToFile(root, pathname);
  if (!filePath) {
    sendMarketingNotFound(res);
    return true;
  }

  try {
    sendFile(res, filePath, req.method);
  } catch {
    sendMarketingNotFound(res);
  }
  return true;
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
  tryHandleMarketing,
  tryServeAppRobots,
  marketingRoot,
  mapPathnameToFile,
};
