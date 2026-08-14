// @ts-check
// In-memory LRU response cache med tag-basert invalidering (Fase 3.1)
//
// Designvalg:
//   - Map() preserves insertion order → LRU by re-inserting on hit
//   - Tags: en route kan legge data i cache med en eller flere tags,
//     og writes inviderer alle entries med gitt tag. Dette holder
//     invalidering eksplisitt og forutsigbar.
//   - TTL: absolutt expiry i ms. Lazy cleanup: sjekker ved lookup.
//
// API:
//   const cache = createCache({ max: 200, ttlMs: 60_000 });
//   cache.get(key)                  → data | undefined
//   cache.set(key, data, { tags })  → void
//   cache.invalidateTag(tag)        → antall fjernet
//   cache.clear()                   → void
//   cache.stats()                   → { size, hits, misses }
//
// withCache(ttlMs, tags, handler):
//   Returnerer en rute-handler som cacher JSON-responsen.
//   Uses familyId + pathname + query string as the cache key.

function createCache({ max = 200, ttlMs = 60_000 } = {}) {
  const store = new Map(); // key → { data, expiresAt, tags }
  const tagIndex = new Map(); // tag → Set<key>
  let hits = 0;
  let misses = 0;

  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      _delete(key);
      misses++;
      return undefined;
    }
    // LRU touch
    store.delete(key);
    store.set(key, entry);
    hits++;
    return entry.data;
  }

  function set(key, data, { tags = [] } = {}) {
    // Evict if at max (oldest first — iteration order)
    if (!store.has(key) && store.size >= max) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) _delete(oldestKey);
    }
    if (store.has(key)) _delete(key); // remove old tag links
    store.set(key, { data, expiresAt: Date.now() + ttlMs, tags });
    for (const tag of tags) {
      let set = tagIndex.get(tag);
      if (!set) {
        set = new Set();
        tagIndex.set(tag, set);
      }
      set.add(key);
    }
  }

  function _delete(key) {
    const entry = store.get(key);
    if (!entry) return;
    for (const tag of entry.tags) {
      const set = tagIndex.get(tag);
      if (set) {
        set.delete(key);
        if (set.size === 0) tagIndex.delete(tag);
      }
    }
    store.delete(key);
  }

  function invalidateTag(tag) {
    const set = tagIndex.get(tag);
    if (!set) return 0;
    const keys = [...set];
    for (const k of keys) _delete(k);
    return keys.length;
  }

  function clear() {
    store.clear();
    tagIndex.clear();
  }

  function stats() {
    return { size: store.size, hits, misses, tags: tagIndex.size };
  }

  return { get, set, invalidateTag, clear, stats };
}

// ============================================================
// Shared instance + helpers
// ============================================================

const responseCache = createCache({ max: 200, ttlMs: 60_000 });

function cacheKey(ctx) {
  // Family-scope the key so two tenants never share a cached GET.
  // Path + query alone leaked calendar (and other) lists across families.
  const familyPart =
    Number.isInteger(ctx.familyId) && ctx.familyId > 0 ? `f${ctx.familyId}` : 'anon';
  const qs = Object.keys(ctx.query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(ctx.query[k])}`)
    .join('&');
  return `${familyPart}:${ctx.pathname}?${qs}`;
}

/**
 * Wrapper som cacher JSON-responsen fra en GET-handler.
 * Uses familyId + pathname + sorted query as the key, and tags the entry with
 * de gitte tags slik at writes kan invalidere dem.
 *
 *   router.get('/api/today', withCache(['meals','chores'], handler));
 *
 * TTL er lik den globale cachens ttlMs (60s). Cache-missen signaliseres
 * via X-Cache response-header.
 */
function withCache(tags, handler) {
  const tagList = Array.isArray(tags) ? tags : [tags];
  return async (ctx) => {
    const key = cacheKey(ctx);
    const hit = responseCache.get(key);
    if (hit !== undefined) {
      ctx.res.setHeader('X-Cache', 'HIT');
      ctx.json(hit);
      return;
    }
    ctx.res.setHeader('X-Cache', 'MISS');
    const origJson = ctx.json.bind(ctx);
    ctx.json = (data, status = 200) => {
      if (status === 200) responseCache.set(key, data, { tags: tagList });
      return origJson(data, status);
    };
    await handler(ctx);
  };
}

function invalidate(...tags) {
  let total = 0;
  for (const t of tags) total += responseCache.invalidateTag(t);
  return total;
}

module.exports = {
  createCache,
  responseCache,
  withCache,
  invalidate,
};
