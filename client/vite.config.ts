import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Frontend v2 — built into <repo>/public/v2 so the existing Express
// static handler can serve it via the /v2/* route prefix. See
// docs/frontend/v2-strategy.md for the full story.
//
// Dev: `npm run dev:client` — Vite dev-server on :5173 with /api proxied
//      to the backend (:7777). WebSocket upgrades proxied too (ws:true)
//      so future real-time endpoints work without config change.
//
// Build: `npm run build:client` — writes public/v2/. That folder is
//        gitignored; CI rebuilds it before serving.

export default defineConfig({
  plugins: [react()],

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
    port: 5173,
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
    port: 5174,
    strictPort: true,
  },
});
