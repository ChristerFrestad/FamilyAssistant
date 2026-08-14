import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import enforceDevIsolation from './vite-plugins/enforce-isolation';
import { VitePWA } from 'vite-plugin-pwa';

// Frontend — built into <repo>/public/v2 (internal folder). The HTTP
// server maps that folder onto the site root so URLs are /login, /dashboard.
//
// Dev: `npm run dev:client` — Vite dev-server on :7778 with /api proxied
//      to the backend (:7777). WebSocket upgrades proxied too (ws:true)
//      so future real-time endpoints work without config change.
//      Ports 7778 (dev-server) and 7779 (preview) sit next to the
//      backend on 7777 to keep our project's port family contiguous.
//      Vite's default 5173 is reserved for an unrelated tool on the
//      developer machine — see CLAUDE.md DEL 7.8 for the full port
//      matrix.
//
// Build: `npm run build:client` — writes public/v2/. That folder is
//        gitignored; CI rebuilds it before serving.
//
// PWA (Phase 1+2): vite-plugin-pwa adds installable offline-capable app
// with auto-updating service worker and Workbox caching. Phase 2 adds
// production icons (SVG) + NetworkFirst/StaleWhileRevalidate for
// shopping + pantry + meals APIs so the core lists remain usable
// offline after first visit.

export default defineConfig({
  // enforceDevIsolation() MUST run in every Vite invocation (dev + build
  // alike). Its `enforce: 'pre'` makes it fire before react()'s resolver
  // so an illegal app -> dev import fails fast with a clear error.
  plugins: [
    enforceDevIsolation(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/icon.svg', 'icons/icon-maskable.svg'],
      manifest: {
        name: 'FamilyAssistant',
        short_name: 'FamilyAssistant',
        description: 'Din personlige familieassistent - måltider, handleliste og pantry',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Static assets from the Vite build (incl. icons under /icons/)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        runtimeCaching: [
          // Images (external or same-origin)
          {
            urlPattern: /^https?:\/\/.*\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          // Shopping list API — keep last successful response offline
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/shopping'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-shopping',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Pantry / inventory API
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/pantry') || url.pathname.startsWith('/api/inventory'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-pantry',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Meals plan (read-mostly) — StaleWhileRevalidate for snappy UI
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/meals'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-meals',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 3,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],

  // Site root. Backend serves public/v2/ at / so asset URLs are /assets/*.
  base: '/',

  root: path.resolve(__dirname),

  build: {
    // Relative to `root` (this file's dir). Resolves to <repo>/public/v2.
    outDir: path.resolve(__dirname, '..', 'public', 'v2'),
    emptyOutDir: true,
    sourcemap: true,
    // Explicit input list for prod-build. Only index.html ships to
    // production; dev.html (the dev-only design-system preview) is
    // intentionally excluded so no preview code can leak into the
    // public bundle. Vite's dev-server still serves dev.html by
    // default — `rollupOptions.input` only constrains the build.
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },

  server: {
    port: 7778,
    // strictPort: fail loudly if 7778 is occupied instead of silently
    // walking up to 7779, 7780, ... — keeps port behavior predictable
    // and surfaces accidental double-starts immediately.
    strictPort: true,
    proxy: {
      // Backend API lives on 7777 (configured via PORT). All /api calls
      // proxy there during dev. ws:true future-proofs for WebSocket
      // upgrades (SSE / real-time) — cheap insurance.
      '/api': {
        target: 'http://localhost:7777',
        changeOrigin: true,
        ws: true,
      },
      '/health': 'http://localhost:7777',
      '/metrics': 'http://localhost:7777',
    },
  },

  preview: {
    port: 7779,
    strictPort: true,
  },
});
