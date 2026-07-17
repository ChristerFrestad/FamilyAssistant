import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import enforceDevIsolation from './vite-plugins/enforce-isolation';
import { VitePWA } from 'vite-plugin-pwa';

// Frontend v2 — built into <repo>/public/v2 so the existing Express
// static handler can serve it via the /v2/* route prefix.

export default defineConfig({
  plugins: [
    enforceDevIsolation(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'FamilyAssistant',
        short_name: 'FamilyAssistant',
        description: 'Din personlige familieassistent - måltider, handleliste og pantry',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/v2/',
        scope: '/v2/',
        icons: [
          {
            src: '/v2/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/v2/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      }
    })
  ],

  base: '/v2/',
  root: path.resolve(__dirname),

  build: {
    outDir: path.resolve(__dirname, '..', 'public', 'v2'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },

  server: {
    port: 7778,
    strictPort: true,
    proxy: {
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