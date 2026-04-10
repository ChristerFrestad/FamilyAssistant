// Kassal.app HTTP-klient (Iterasjon 3a)
//
// Ansvar:
//   1. HTTP mot Kassal.app API med Bearer auth
//   2. Token bucket rate limit (55/min, 5 margin under 60/min grensen)
//   3. Response-cache via kassal_cache-tabellen med variabel TTL
//   4. Circuit breaker: stopp midlertidig etter 3 påfølgende feil
//   5. Stale-if-error: returner utløpt cache hvis fetch feiler
//
// Designvalg:
//   - Null-fallback: hvis KASSAL_API_KEY mangler, returneres null umiddelbart
//     uten å logge feil. Hele systemet må fungere uten API-nøkkel.
//   - Klienten gjør ingen persisting til kassal_products — det er resolverens
//     oppgave. Klienten er ren transport + cache.
//   - Rate-limiter-state er in-memory. Ved restart mister vi token-telleren,
//     men 55-token-budsjettet fylles opp uansett igjen innen 60s. Persistens
//     via state_snapshots er overkill for iterasjon 3a.
//   - Fetch-timeout: 8s per request. Kassal er vanligvis <500ms.
//   - Circuit breaker: åpner etter 3 påfølgende feil, resetter etter 5 min.

const { logger } = require('../logger');

// ============================================================
// Konfig
// ============================================================

const KASSAL_BASE_URL = 'https://kassal.app/api/v1';
const KASSAL_TIMEOUT_MS = 8000;

// Rate limit: 55 tokens/min (margin 5 under Kassal sin 60/min).
const BUCKET_CAPACITY = 55;
const REFILL_TOKENS_PER_MS = 55 / 60000;

// Cache-TTL i timer (valgt så priser rekker å endres før ny hent):
//   - search: 24t — søkeresultater endres når butikker oppdaterer priser
//   - ean:     7 * 24 = 168t — EAN mapper endres ikke
//   - id:     30 * 24 = 720t — Kassal ID er stabil
const TTL_HOURS = {
  search: 24,
  ean: 168,
  id: 720,
};

// Circuit breaker
const CIRCUIT_ERROR_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;

// ============================================================
// State (modul-skop)
// ============================================================

let tokens = BUCKET_CAPACITY;
let lastRefillAt = Date.now();
let consecutiveErrors = 0;
let circuitOpenUntil = 0;

/**
 * Reset all client state — for tester.
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
      'kassal: circuit breaker åpnet'
    );
  }
}

// ============================================================
// Cache-hjelpere
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
 * Les cache hvis mulig. Returnerer { hit, row } der hit=true kun for fersk cache.
 * Returnerer row (kan være stale) uansett slik at kallere kan bruke
 * stale-if-error-fallback.
 */
function readCache(repos, cacheKey) {
  const row = repos.kassalCache.get(cacheKey);
  if (!row) return { hit: false, row: null };
  if (isFresh(row.expiresAt)) {
    repos.kassalCache.bumpHit(row.id);
    return { hit: true, row, parsed: JSON.parse(row.responseJson) };
  }
  // Stale rad beholdes som fallback
  return { hit: false, row, parsed: JSON.parse(row.responseJson) };
}

// ============================================================
// Lav-nivå fetch
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
        'User-Agent': 'Familieassistenten/1.0',
      },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kjernefunksjon: cache → rate-limit → fetch → cache write → stale-fallback.
 *
 * @param {Object} opts
 * @param {Object} opts.repos
 * @param {string} opts.cacheKey    — normalisert key (f.eks. 'search:kjottdeig')
 * @param {string} opts.endpoint    — 'search' | 'ean' | 'id'
 * @param {string} opts.url         — full Kassal URL å hente
 * @param {string} [opts.apiKey]    — auth; default KASSAL_API_KEY env
 * @returns {Promise<object|null>}  — parsed JSON eller null
 */
async function cachedFetch({ repos, cacheKey, endpoint, url, apiKey = process.env.KASSAL_API_KEY }) {
  // 1. Null-fallback: ingen API-nøkkel → hele integrasjonen er av
  if (!apiKey) return null;

  // 2. Cache hit?
  const cached = readCache(repos, cacheKey);
  if (cached.hit) return cached.parsed;

  // 3. Circuit breaker åpen → returner stale hvis mulig
  if (isCircuitOpen()) {
    if (cached.parsed) {
      logger.debug({ cacheKey }, 'kassal: circuit open, serverer stale');
      return cached.parsed;
    }
    return null;
  }

  // 4. Token bucket
  if (!takeToken()) {
    logger.warn({ cacheKey }, 'kassal: rate limit nådd');
    if (cached.parsed) return cached.parsed;  // stale-if-overrate
    return null;
  }

  // 5. Fetch
  try {
    const res = await fetchWithTimeout(url, { apiKey });
    if (!res.ok) {
      // 429 teller som failure og gir circuit breaker et dytt
      if (res.status === 429) {
        logger.warn({ cacheKey }, 'kassal: 429 fra server');
        recordFailure();
      } else if (res.status >= 500) {
        recordFailure();
      } else {
        // 4xx (ikke 429): klientfeil, ikke åpne circuit
        logger.warn({ status: res.status, cacheKey }, 'kassal: 4xx');
      }
      return cached.parsed || null;
    }
    const body = await res.json();
    recordSuccess();
    // Cache-write: lagres alltid, selv tomme svar, så vi ikke bomber igjen
    repos.kassalCache.put({
      cacheKey,
      endpoint,
      responseJson: JSON.stringify(body),
      ttlHours: TTL_HOURS[endpoint] || 24,
    });
    return body;
  } catch (err) {
    logger.warn({ err: err.message, cacheKey }, 'kassal: fetch feilet');
    recordFailure();
    return cached.parsed || null;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Søk etter produkter. Returnerer Kassal sin data-array eller null.
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
  // Kassal returnerer { data: [...], ... } — noen endpoints pakker i `products`
  return body.data || body.products || body || null;
}

/**
 * Oppslag på EAN/strekkode. Returnerer Kassal-objekt eller null.
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
 * Oppslag på Kassal produkt-id. Returnerer objektet eller null.
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
 * Diagnostikk: nåværende token-nivå og circuit state.
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
  // Eksponert for testing / intern bruk
  resetState,
  normalizeSearchKey,
  takeToken,
  cachedFetch,
  TTL_HOURS,
  BUCKET_CAPACITY,
  CIRCUIT_ERROR_THRESHOLD,
};
