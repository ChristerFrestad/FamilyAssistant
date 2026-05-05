// Tombstone service worker — Sprint 8 V1 frontend cleanup (2026-05-05).
//
// Background:
// The legacy v1 frontend shipped a service worker that pre-cached HTML/JS/CSS
// from public/index.html, public/js/*, public/css/*. Browsers that visited
// the app while v1 was live still have that SW installed and would keep
// serving stale cached content even after we deleted the source files.
//
// This tombstone replaces the v1 sw.js with a minimal worker whose only job
// is to unregister itself and force the controlled clients to reload. After
// reload, the page boots without any service worker — the new v2 React app
// loads from the network, no caching layer in the way.
//
// Lifecycle:
//   1. Browser fetches /sw.js (existing SW update-check or fresh visit)
//   2. install: skipWaiting() so this version takes over immediately,
//      bypassing the normal "wait until all tabs close" gate
//   3. activate: drop all caches the v1 SW had, unregister this worker,
//      then navigate every controlled client to its current URL so the
//      page reloads without a SW intercept
//   4. The next request from each client goes to the network — v2 loads
//
// Removal plan:
// After 3-6 months when all pilot users have visited the app and had their
// v1 SW unregistered, this file can be deleted entirely along with the
// /sw.js route. Tracked in docs/workflow/post-pilot-code-debt-cleanup.md.

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for all tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache the v1 SW (or this tombstone) created. Listing
      // explicit cache names would be brittle — clear all caches owned by
      // this origin to guarantee no stale v1 content survives.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        /* best-effort; never block unregister on cache cleanup failure */
      }

      // Unregister this worker so future requests go to the network.
      try {
        await self.registration.unregister();
      } catch {
        /* if unregister fails, the next visit will retry — still safe */
      }

      // Force every currently-controlled tab to reload, which detaches them
      // from this (now-unregistered) worker and runs without any SW.
      try {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
          if ('navigate' in client) {
            client.navigate(client.url);
          }
        }
      } catch {
        /* best-effort */
      }
    })()
  );
});

// Pass-through fetch handler — any request that does hit this SW before it
// finishes activating goes straight to the network, no cache lookup. This
// is a safety net; in practice the activate-handler unregisters the worker
// before any meaningful number of fetches go through.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
