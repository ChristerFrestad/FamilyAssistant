'use strict';

// The marketing landing and the PWA share one origin. Workbox must
// not treat GET / as the precached SPA index.html, or AuthGuard
// sends every returning visitor to /login.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const VITE_CONFIG = path.join(__dirname, '..', 'client', 'vite.config.ts');

test('Vite PWA config disables directoryIndex so / is not SPA index.html', () => {
  const src = fs.readFileSync(VITE_CONFIG, 'utf8');
  assert.match(src, /directoryIndex:\s*null/);
  assert.doesNotMatch(src, /cleanURLs\s*:/);
  assert.match(src, /navigateFallbackDenylist/);
  assert.match(src, /\/\^\\\/\$\//);
});

test('directoryIndex: null is valid GenerateSW config', () => {
  const { validateGenerateSWOptions } = require('workbox-build/build/lib/validate-options');
  assert.doesNotThrow(() => {
    validateGenerateSWOptions({
      swDest: 'sw.js',
      globDirectory: '.',
      skipWaiting: true,
      clientsClaim: true,
      directoryIndex: null,
    });
  });
});

test('Workbox default would map / to /index.html; our options do not', async () => {
  if (typeof globalThis.location === 'undefined') {
    globalThis.location = { href: 'https://marketing.example/' };
  }
  const modPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'workbox-precaching',
    'utils',
    'generateURLVariations.js'
  );
  const { generateURLVariations } = await import(pathToFileURL(modPath).href);

  const defaults = [...generateURLVariations('https://marketing.example/')];
  assert.ok(
    defaults.some((u) => u.endsWith('/index.html')),
    `default variations should include /index.html, got ${defaults.join(', ')}`
  );

  const fixed = [
    ...generateURLVariations('https://marketing.example/', {
      directoryIndex: null,
      cleanURLs: false,
    }),
  ];
  assert.ok(
    !fixed.some((u) => /index\.html$/.test(new URL(u).pathname)),
    `fixed variations must not include index.html, got ${fixed.join(', ')}`
  );
  assert.ok(fixed.some((u) => new URL(u).pathname === '/'));
});
