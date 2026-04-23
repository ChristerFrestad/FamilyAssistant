import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import enforceDevIsolation from './vite-plugins/enforce-isolation';

// Frontend v2 — built into <repo>/public/v2 so the existing Express
// static handler can serve it via the /v2/* route prefix. See
// docs/frontend/v2-strategy.md for the full story.
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

export default defineConfig({
  // enforceDevIsolation() MUST run in every Vite invocation (dev + build
  // alike). Its `enforce: 'pre'` makes it fire before react()'s resolver
  // so an illegal app -> dev import fails fast with a clear error.
  plugins: [enforceDevIsolation(), react()],

  // Base URL for all emitted asset paths. Must match the route prefix
  // the backend serves on, otherwise <script src="/assets/..."> breaks.
  base: '/v2/',

  root: path.resolve(__dirname),

  build: {
    // Relative to `root` (this file's dir). Resolves to <repo>/public/v2.
    outDir: path.resolve(__dirname, '..', 'public', 'v2'),
    emptyOutDir: true,
    sourcemap: true,
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
