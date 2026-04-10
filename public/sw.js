// Familieassistenten Service Worker (M5.2)
//
// Strategi:
//   - Statiske assets (HTML, manifest, icon) → cache-first, network-fallback
//   - API GET (/api/*) → network-first, cache-fallback for offline lesing
//   - API POST/PUT/DELETE → network-only, ingen cache (mutasjoner skal ikke
//     bufres og repeteres ved retry — serveren ville doble dem)
//   - /metrics, /health, /ready → network-only (monitoring trenger ferske tall)
//
// Cache-versjon bumpes ved hver deploy så gamle caches ryddes automatisk.

const VERSION = 'v1.2-m5';
const STATIC_CACHE = `fam-static-${VERSION}`;
const API_CACHE = `fam-api-${VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
];

// ============================================================
// Install — pre-cache statiske assets
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[sw] install cache feilet:', err))
  );
});

// ============================================================
// Activate — rydd gamle caches, ta kontroll over åpne tabs
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k.startsWith('fam-') && k !== STATIC_CACHE && k !== API_CACHE)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ============================================================
// Fetch
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Kun GET caches — POST/PUT/DELETE går rett gjennom
  if (request.method !== 'GET') return;

  // Eksterne origins — bypass SW helt
  if (url.origin !== self.location.origin) return;

  // Monitoring / health — network-only
  if (url.pathname === '/metrics' || url.pathname === '/health' || url.pathname === '/ready') {
    return;
  }

  // API GET — network-first, cache-fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiNetworkFirst(request));
    return;
  }

  // Statiske assets — cache-first
  event.respondWith(staticCacheFirst(request));
});

async function apiNetworkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const fresh = await fetch(request);
    // Kun cache suksessfulle 200-responser
    if (fresh.ok) {
      // Klone før cache.put — response-body kan kun leses én gang
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    // Offline: prøv cache
    const cached = await cache.match(request);
    if (cached) {
      // Legg til en header så klienten vet responsen er stale
      const headers = new Headers(cached.headers);
      headers.set('X-SW-Cache', 'STALE');
      return new Response(await cached.blob(), {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    // Ingen cache, ingen nettverk → returner JSON-feil som matcher server
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Offline',
        status: 503,
        detail: 'Ingen forbindelse og ingen bufret data tilgjengelig',
      }),
      { status: 503, headers: { 'Content-Type': 'application/problem+json' } }
    );
  }
}

async function staticCacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    // Oppdater i bakgrunnen så neste request får fersk kopi
    fetch(request)
      .then(fresh => { if (fresh.ok) cache.put(request, fresh).catch(() => {}); })
      .catch(() => {});
    return cached;
  }
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    // Fallback til root index for SPA-navigasjon offline
    if (request.mode === 'navigate') {
      const root = await cache.match('/');
      if (root) return root;
    }
    throw err;
  }
}

// ============================================================
// Message handler — klient kan trigge cleanup / manual cache-purge
// ============================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
