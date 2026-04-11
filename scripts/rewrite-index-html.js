#!/usr/bin/env node
/*
 * scripts/rewrite-index-html.js — week 3 frontend modularization
 *
 * Rewrites public/index.html so that the inline <style>...</style> block
 * (lines 12-1777) is replaced with <link> tags pointing to public/css/*.css,
 * and the inline <script>...</script> block (lines 1962-3937) is replaced
 * with <script src> tags pointing to public/js/*.js.
 *
 * Body markup (lines 1778-1961) and <head> meta (lines 1-11) are preserved
 * byte-exact. The tool writes back to public/index.html.
 *
 * Scripts are loaded as plain classic scripts (NOT type="module") so the
 * 62 existing inline onclick/onchange/onkeydown handlers continue to resolve
 * global function names without any rewrite.
 *
 * Run after scripts/extract-frontend.js.
 */

const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'public', 'index.html');
const lines = fs.readFileSync(HTML, 'utf8').split('\n');

// Preserved regions (1-based, inclusive)
const HEAD_START_END = [1, 11]; // <!DOCTYPE html> through <title>…</title>
const BODY_REGION = [1778, 1961]; // </head>…<body> markup up to but not including <script>

const head = lines.slice(HEAD_START_END[0] - 1, HEAD_START_END[1]).join('\n');
const body = lines.slice(BODY_REGION[0] - 1, BODY_REGION[1]).join('\n');

const cssLinks = ['base.css', 'glass.css', 'components-extended.css', 'settings.css']
  .map((f) => `  <link rel="stylesheet" href="/css/${f}">`)
  .join('\n');

// Load order matters: core first (defines API, state, escapeHtml, api, toast,
// isOffline). Every downstream module may call core helpers. tabs.js references
// loadToday/loadMeals/loadShopping/etc. defined later — fine because switchTab
// is not called until after DOMContentLoaded. init.js MUST be last: it invokes
// loadTheme(), loadToday(), checkLlmStatus(), initVoice() — all from earlier
// files — and registers the service worker.
const jsScripts = [
  'core.js',
  'tabs.js',
  'today.js',
  'meals.js',
  'shopping.js',
  'pantry.js',
  'recipe-import.js',
  'chores.js',
  'chat.js',
  'voice.js',
  'theme.js',
  'notifications.js',
  'settings.js',
  'init.js',
]
  .map((f) => `<script src="/js/${f}"></script>`)
  .join('\n');

const rewritten = [head, cssLinks, body, jsScripts, '</body>', '</html>', ''].join('\n');

fs.writeFileSync(HTML, rewritten);
console.log(`rewrote ${HTML}  (${rewritten.length} bytes, ${rewritten.split('\n').length} lines)`);
