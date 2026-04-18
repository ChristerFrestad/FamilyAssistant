// Familieassistenten Service Worker (M5.2 + phase 14)
//
// Strategi:
//   - Statiske assets (HTML, manifest, icon, css, js) → cache-first, network-fallback
//   - API GET (/api/*) → network-first, cache-fallback for offline lesing
//   - Tenant-sensitive API (/api/auth/*, /api/family/*, /api/llm-config/*,
//     /api/invitations/*, /api/onboarding/*, /api/gdpr/*) → network-only, aldri
//     cache. En bufret respons ville lekke mellom familier/brukere når samme
//     enhet byttes til en annen konto.
//   - API POST/PUT/DELETE → network-only (mutasjoner skal ikke repeteres)
//   - /metrics, /health, /ready → network-only (monitoring trenger ferske tall)
//   - 401/403-respons evicter API-cache så neste bruker ikke ser forrige kontos data
//
// Cache-versjon bumpes ved hver deploy så gamle caches ryddes automatisk.

const VERSION = 'v1.4-phase14';
const STATIC_CACHE = `fam-static-${VERSION}`;
const API_CACHE = `fam-api-${VERSION}`;

// Phase 14: auth/family-skjermene og tilhørende moduler pre-caches så offline-
// brukere kan nå login/onboarding-flyten (selv om selve auth-kallet trenger
// nettverk — skjermen skal likevel være synlig).
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/onboarding.html',
  '/invite.html',
  '/manifest.json',
  '/icon-192.png',
  '/css/base.css',
  '/css/glass.css',
  '/css/components-extended.css',
  '/css/settings.css',
  '/js/core.js',
  '/js/auth.js',
  '/js/tabs.js',
  '/js/today.js',
  '/js/meals.js',
  '/js/shopping.js',
  '/js/pantry.js',
  '/js/recipe-import.js',
  '/js/chores.js',
  '/js/chat.js',
  '/js/voice.js',
  '/js/theme.js',
  '/js/notifications.js',
  '/js/settings.js',
  '/js/family-ui.js',
  '/js/family-onboarding.js',
  '/js/init.js',
];

// Phase 14: prefikser som ALDRI skal caches. Inneholder per-bruker/per-familie
// data — bufring ville bryte tenant-isolasjon ved kontobytte på delt enhet.
const NO_CACHE_API_PREFIXES = [
  '/api/auth/',
  '/api/family',
  '/api/llm-config',
  '/api/invitations',
  '/api/onboarding',
  '/api/gdpr',
];

function isNoCacheApi(pathname) {
  return NO_CACHE_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

// ============================================================
// Install — pre-cache statiske assets
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] install cache feilet:', err))
  );
});

// ============================================================
// Activate — rydd gamle caches, ta kontroll over åpne tabs
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('fam-') && k !== STATIC_CACHE && k !== API_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
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

  // Phase 14: tenant-sensitive API — network-only, aldri cache
  if (url.pathname.startsWith('/api/') && isNoCacheApi(url.pathname)) {
    event.respondWith(apiNetworkOnly(request));
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

async function apiNetworkOnly(request) {
  try {
    const fresh = await fetch(request);
    // Phase 14: 401/403 på tenant-sensitive endpoints betyr at sesjonen
    // er død eller byttet. Tøm API-cache så forrige kontos data ikke
    // vises for neste bruker på samme enhet.
    if (fresh.status === 401 || fresh.status === 403) {
      caches.delete(API_CACHE).catch(() => {});
    }
    return fresh;
  } catch {
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Offline',
        status: 503,
        detail: 'Ingen forbindelse — denne forespørselen krever nettverk',
      }),
      { status: 503, headers: { 'Content-Type': 'application/problem+json' } }
    );
  }
}

async function apiNetworkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const fresh = await fetch(request);
    // Phase 14: 401/403 på hvilken som helst API — invalider cache slik at
    // neste bruker ikke får forrige brukers data servert offline.
    if (fresh.status === 401 || fresh.status === 403) {
      caches.delete(API_CACHE).catch(() => {});
      return fresh;
    }
    // Kun cache suksessfulle 200-responser
    if (fresh.ok) {
      // Klone før cache.put — response-body kan kun leses én gang
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
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
      .then((fresh) => {
        if (fresh.ok) cache.put(request, fresh).catch(() => {});
      })
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
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
  // Phase 14: kun API-cachen — trigges fra klient ved logout
  if (event.data.type === 'CLEAR_API_CACHE') {
    caches.delete(API_CACHE).catch(() => {});
  }
});
