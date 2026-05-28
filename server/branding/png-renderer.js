'use strict';

// PNG rasteriser for the white-label brand endpoints. Wraps `sharp`
// with a small in-memory cache keyed on the env-snapshot hash so each
// (endpoint, brand-config) pair is rendered once per process lifetime.
//
// Sharp is loaded lazily so that a deploy without the native bindings
// (extremely unlikely on our Debian base image, but possible on a
// future arch where prebuilts are missing) does NOT prevent the
// server from starting — the PNG handlers degrade to a 503 and the
// frontend falls back to the SVG endpoints, which always work.

const crypto = require('crypto');

let _sharp = null;
let _sharpLoadError = null;

function getSharp() {
  if (_sharp) return _sharp;
  if (_sharpLoadError) return null;
  try {
    _sharp = require('sharp');
    return _sharp;
  } catch (err) {
    _sharpLoadError = err;
    return null;
  }
}

function sharpUnavailableReason() {
  return _sharpLoadError ? _sharpLoadError.message : 'sharp not loaded';
}

// Brand-fields that affect the rendered output. If any of these
// changes the cache must invalidate. Restart-only in practice — we
// hash them once at endpoint-call time and use the digest as the
// cache key.
const BRAND_FIELDS = [
  'APP_NAME',
  'APP_NAME_PRIMARY',
  'APP_NAME_ACCENT',
  'APP_FAVICON_LETTER',
  'APP_TAGLINE',
  'APP_PRIMARY_COLOR',
  'APP_ACCENT_COLOR',
  'APP_DOT_COLOR',
];

function brandSnapshotHash(config) {
  const snapshot = BRAND_FIELDS.map((k) => `${k}=${String(config[k] ?? '')}`).join('|');
  return crypto.createHash('sha256').update(snapshot, 'utf8').digest('hex');
}

// LRU-ish: insertion-order Map, evict-oldest-first when full.
const MAX_CACHE_ENTRIES = 32;
const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  // Touch — move to end so it stays "fresh".
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function cacheClear() {
  cache.clear();
}

/**
 * Rasterise the given SVG string to a PNG buffer at the requested
 * dimensions. Result is cached by (endpoint, brand-snapshot-hash).
 *
 * @param {string} endpoint     Logical name (e.g. 'favicon-32') used in the cache key
 * @param {object} config       Brand-config object (server/config.js)
 * @param {string} svg          Rendered SVG string with placeholders substituted
 * @param {number} width        Output width in pixels
 * @param {number} height       Output height in pixels
 * @returns {Promise<{buffer: Buffer, etag: string}>}
 */
async function renderPng({ endpoint, config, svg, width, height }) {
  const sharp = getSharp();
  if (!sharp) {
    const err = new Error(`PNG renderer unavailable: ${sharpUnavailableReason()}`);
    err.code = 'SHARP_UNAVAILABLE';
    throw err;
  }

  const snapshotHash = brandSnapshotHash(config);
  const key = `${endpoint}:${snapshotHash}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // PNG output. `density: 384` (DPI) makes sharp render the SVG at
  // higher detail before downscaling — visibly sharper text edges
  // than the default 72 DPI for the small 32-px favicon.
  const buffer = await sharp(Buffer.from(svg, 'utf8'), { density: 384 })
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  // ETag = first 16 hex chars of the snapshot-hash. Lets crawlers
  // skip the body if the brand-config has not changed since their
  // last fetch.
  const etag = `"${snapshotHash.slice(0, 16)}"`;
  const result = { buffer, etag };
  cacheSet(key, result);
  return result;
}

module.exports = {
  renderPng,
  brandSnapshotHash,
  // Test-only — drains the cache so each test runs with a cold start.
  __cacheClear: cacheClear,
  __sharpAvailable: () => Boolean(getSharp()),
};
