// Kassal.app HTTP client (Iteration 3a)
//
// Responsibilities:
//   1. HTTP against Kassal.app API with Bearer auth
//   2. Token bucket rate limit (55/min, 5 margin under the 60/min limit)
//   3. Response cache via the kassal_cache table with variable TTL
//   4. Circuit breaker: stop temporarily after 3 consecutive failures
//   5. Stale-if-error: return expired cache if fetch fails
//
// Design choices:
//   - Null fallback: if KASSAL_API_KEY is missing, null is returned
//     immediately without logging an error. The whole system must work
//     without an API key.
//   - The client does no persisting to kassal_products — that is the
//     resolver's job. The client is pure transport + cache.
//   - Rate-limiter state is in-memory. After a restart we lose the token
//     counter, but the 55-token budget fills up again within 60s anyway.
//     Persistence via state_snapshots is overkill for iteration 3a.
//   - Fetch timeout: 8s per request. Kassal is usually <500ms.
//   - Circuit breaker: opens after 3 consecutive failures, resets after
//     5 minutes.

const { logger } = require('../logger');

// ============================================================
// Config
// ============================================================

const KASSAL_BASE_URL = 'https://kassal.app/api/v1';
const KASSAL_TIMEOUT_MS = 8000;

// Rate limit: 55 tokens/min (margin 5 under Kassal's 60/min).
const BUCKET_CAPACITY = 55;
const REFILL_TOKENS_PER_MS = 55 / 60000;

// Cache TTL in hours (chosen so prices have time to change before refetch):
//   - search: 24h — search results change when stores update prices
//   - ean:    7 * 24 = 168h — EAN mappings do not change
//   - id:    30 * 24 = 720h — Kassal id is stable
const TTL_HOURS = {
  search: 24,
  ean: 168,
  id: 720,
};

// Circuit breaker
const CIRCUIT_ERROR_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;

// ============================================================
// State (module scope)
// ============================================================

let tokens = BUCKET_CAPACITY;
let lastRefillAt = Date.now();
let consecutiveErrors = 0;
let circuitOpenUntil = 0;

/**
 * Reset all client state — for tests.
 */
function resetState() {
  tokens = BUCKET_CAPACITY;
  lastRefillAt = Date.now();
  consecutiveErrors = 0;
  circuitOpenUntil = 0;
}

function refillTokens() {
  const now = Date.now();
  const delta = now - lastRefillAt;
  if (delta <= 0) return;
  tokens = Math.min(BUCKET_CAPACITY, tokens + delta * REFILL_TOKENS_PER_MS);
  lastRefillAt = now;
}

function takeToken() {
  refillTokens();
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

function isCircuitOpen() {
  return Date.now() < circuitOpenUntil;
}

function recordSuccess() {
  consecutiveErrors = 0;
}

function recordFailure() {
  consecutiveErrors++;
  if (consecutiveErrors >= CIRCUIT_ERROR_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    logger.warn(
      { consecutiveErrors, cooldownMinutes: CIRCUIT_COOLDOWN_MS / 60000 },
      'kassal: circuit breaker opened'
    );
  }
}

// ============================================================
// Cache helpers
// ============================================================

function normalizeSearchKey(query) {
  return (query || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .slice(0, 120);
}

function isFresh(expiresAtIso) {
  if (!expiresAtIso) return false;
  return new Date(expiresAtIso).getTime() > Date.now();
}

/**
 * Read cache if possible. Returns { hit, row } where hit=true only for a
 * fresh cache. Returns row (may be stale) regardless so callers can use
 * the stale-if-error fallback.
 */
function readCache(repos, cacheKey) {
  const row = repos.kassalCache.get(cacheKey);
  if (!row) return { hit: false, row: null };
  if (isFresh(row.expiresAt)) {
    repos.kassalCache.bumpHit(row.id);
    return { hit: true, row, parsed: JSON.parse(row.responseJson) };
  }
  // Stale row is kept as a fallback
  return { hit: false, row, parsed: JSON.parse(row.responseJson) };
}

// ============================================================
// Low-level fetch
// ============================================================

async function fetchWithTimeout(url, { apiKey, timeoutMs = KASSAL_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'FamilyAssistant/1.0',
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Core function: cache → rate-limit → fetch → cache write → stale fallback.
 *
 * @param {Object} opts
 * @param {Object} opts.repos
 * @param {string} opts.cacheKey    — normalised key (e.g. 'search:kjottdeig')
 * @param {string} opts.endpoint    — 'search' | 'ean' | 'id'
 * @param {string} opts.url         — full Kassal URL to fetch
 * @param {string} [opts.apiKey]    — auth; defaults to KASSAL_API_KEY env
 * @returns {Promise<object|null>}  — parsed JSON or null
 */
async function cachedFetch({
  repos,
  cacheKey,
  endpoint,
  url,
  apiKey = process.env.KASSAL_API_KEY,
}) {
  // 1. Null fallback: no API key → the whole integration is off
  if (!apiKey) return null;

  // 2. Cache hit?
  const cached = readCache(repos, cacheKey);
  if (cached.hit) return cached.parsed;

  // 3. Circuit breaker open → return stale if possible
  if (isCircuitOpen()) {
    if (cached.parsed) {
      logger.debug({ cacheKey }, 'kassal: circuit open, serving stale');
      return cached.parsed;
    }
    return null;
  }

  // 4. Token bucket
  if (!takeToken()) {
    logger.warn({ cacheKey }, 'kassal: rate limit reached');
    if (cached.parsed) return cached.parsed; // stale-if-overrate
    return null;
  }

  // 5. Fetch
  try {
    const res = await fetchWithTimeout(url, { apiKey });
    if (!res.ok) {
      // 429 counts as a failure and pushes the circuit breaker
      if (res.status === 429) {
        logger.warn({ cacheKey }, 'kassal: 429 from server');
        recordFailure();
      } else if (res.status >= 500) {
        recordFailure();
      } else {
        // 4xx (not 429): client error, do not open circuit
        logger.warn({ status: res.status, cacheKey }, 'kassal: 4xx');
      }
      return cached.parsed || null;
    }
    const body = await res.json();
    recordSuccess();
    // Cache write: always stored, even empty responses, so we don't hit
    // again
    repos.kassalCache.put({
      cacheKey,
      endpoint,
      responseJson: JSON.stringify(body),
      ttlHours: TTL_HOURS[endpoint] || 24,
    });
    return body;
  } catch (err) {
    logger.warn({ err: err.message, cacheKey }, 'kassal: fetch failed');
    recordFailure();
    return cached.parsed || null;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Search for products. Returns Kassal's data array or null.
 */
async function searchByName(repos, query, { size = 10 } = {}) {
  const norm = normalizeSearchKey(query);
  if (!norm) return null;
  const url = `${KASSAL_BASE_URL}/products?search=${encodeURIComponent(query)}&size=${size}`;
  const body = await cachedFetch({
    repos,
    cacheKey: `search:${norm}`,
    endpoint: 'search',
    url,
  });
  if (!body) return null;
  // Kassal returns { data: [...], ... } — some endpoints wrap in `products`
  return body.data || body.products || body || null;
}

/**
 * Look up by EAN/barcode. Returns the Kassal object or null.
 */
async function getByEan(repos, ean) {
  if (!ean) return null;
  const cleanEan = String(ean).trim();
  if (!/^\d{6,20}$/.test(cleanEan)) return null;
  const url = `${KASSAL_BASE_URL}/products/ean/${cleanEan}`;
  const body = await cachedFetch({
    repos,
    cacheKey: `ean:${cleanEan}`,
    endpoint: 'ean',
    url,
  });
  if (!body) return null;
  return body.data || body || null;
}

/**
 * Look up by Kassal product id. Returns the object or null.
 */
async function getById(repos, kassalId) {
  if (!kassalId) return null;
  const cleanId = String(kassalId).trim();
  const url = `${KASSAL_BASE_URL}/products/id/${encodeURIComponent(cleanId)}`;
  const body = await cachedFetch({
    repos,
    cacheKey: `id:${cleanId}`,
    endpoint: 'id',
    url,
  });
  if (!body) return null;
  return body.data || body || null;
}

/**
 * Diagnostics: current token level and circuit state.
 */
function getStatus() {
  refillTokens();
  return {
    tokensAvailable: Math.floor(tokens),
    bucketCapacity: BUCKET_CAPACITY,
    circuitOpen: isCircuitOpen(),
    circuitOpenUntil: circuitOpenUntil > 0 ? new Date(circuitOpenUntil).toISOString() : null,
    consecutiveErrors,
    apiKeyConfigured: !!process.env.KASSAL_API_KEY,
  };
}

module.exports = {
  searchByName,
  getByEan,
  getById,
  getStatus,
  // Exposed for testing / internal use
  resetState,
  normalizeSearchKey,
  takeToken,
  cachedFetch,
  TTL_HOURS,
  BUCKET_CAPACITY,
  CIRCUIT_ERROR_THRESHOLD,
};
