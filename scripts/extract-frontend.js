#!/usr/bin/env node
/*
 * scripts/extract-frontend.js — week 3 frontend modularization
 *
 * Mechanically extracts contiguous line ranges from public/index.html into
 * separate CSS and JS files. Preserves byte-exact content so CSS cascade
 * order and JS load order are unchanged when files are loaded in sequence.
 *
 * Ranges are 1-indexed, inclusive. The tool prints a verification diff:
 * total extracted bytes must equal the size of the original <style>...</style>
 * and <script>...</script> blocks.
 *
 * Run once: node scripts/extract-frontend.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'index.html');
const CSS_DIR = path.join(ROOT, 'public', 'css');
const JS_DIR = path.join(ROOT, 'public', 'js');

const lines = fs.readFileSync(HTML, 'utf8').split('\n');
// Line N in editor == lines[N-1]. We use inclusive 1-based ranges below.

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

// ---------- CSS splits (inclusive line ranges, 1-based) ----------
// Style block: 12-1777 (<style> on 12, </style> on 1777). Inner content: 13-1776.
const cssSplits = [
  // Base reset, variables, themes, body/header, toast, skeleton, tabs,
  // content, card, buttons, meal, ingredients, shopping, chores, modal,
  // input, warning, consumable, chat/voice (pre-glass)
  { file: 'base.css', start: 13, end: 455 },
  // Fase E — 2026 Liquid Glass overstyringer av eksisterende klasser
  { file: 'glass.css', start: 457, end: 773 },
  // Fase E CSS-tillegg: segmented, enrich-banner, kassal-chip, modal-tabs,
  // image-dropzone, pantry-item, FAB
  { file: 'components-extended.css', start: 775, end: 1081 },
  // Fase F — settings-view, etched-panel, pantry-combobox, pantry-progress,
  // similar-recipe, view visibility
  { file: 'settings.css', start: 1083, end: 1776 },
];

// ---------- JS splits (inclusive line ranges, 1-based) ----------
// Script block: 1962-3937 (<script> on 1962, </script> on 3937). Inner: 1963-3936.
const jsSplits = [
  // core: XSS-safe templating, state, toast, fetch helpers, offline flag
  { file: 'core.js', start: 1963, end: 2133 },
  // tabs: switchTab
  { file: 'tabs.js', start: 2134, end: 2155 },
  // today: loadToday, sundayPush
  { file: 'today.js', start: 2156, end: 2290 },
  // meals: loadMeals, renderMeals, similar, swap, reorder, closeModal
  { file: 'meals.js', start: 2291, end: 2479 },
  // shopping + pantry + recipe-import + FAB visibility (all in Fase E block)
  { file: 'shopping.js', start: 2480, end: 2728 },
  { file: 'pantry.js', start: 2729, end: 2981 },
  { file: 'recipe-import.js', start: 2982, end: 3119 },
  // chores
  { file: 'chores.js', start: 3120, end: 3177 },
  // chat + voice
  { file: 'chat.js', start: 3178, end: 3257 },
  { file: 'voice.js', start: 3258, end: 3372 },
  // theme toggle
  { file: 'theme.js', start: 3373, end: 3398 },
  // notifications
  { file: 'notifications.js', start: 3399, end: 3414 },
  // settings (large)
  { file: 'settings.js', start: 3415, end: 3906 },
  // init + sw registration (MUST be last)
  { file: 'init.js', start: 3907, end: 3936 },
];

// ---------- Write CSS files ----------
fs.mkdirSync(CSS_DIR, { recursive: true });
let cssTotal = 0;
for (const { file, start, end } of cssSplits) {
  const content = slice(start, end) + '\n';
  const out = path.join(CSS_DIR, file);
  fs.writeFileSync(out, content);
  cssTotal += content.length;
  console.log(`wrote ${out}  (${end - start + 1} lines, ${content.length} bytes)`);
}

// ---------- Write JS files ----------
fs.mkdirSync(JS_DIR, { recursive: true });
let jsTotal = 0;
for (const { file, start, end } of jsSplits) {
  const content = slice(start, end) + '\n';
  const out = path.join(JS_DIR, file);
  fs.writeFileSync(out, content);
  jsTotal += content.length;
  console.log(`wrote ${out}  (${end - start + 1} lines, ${content.length} bytes)`);
}

// ---------- Sanity: verify coverage of the inner style/script blocks ----------
const styleInner = slice(13, 1776);
const scriptInner = slice(1963, 3936);
console.log('---');
console.log(`style inner bytes:  ${styleInner.length}`);
console.log(`css written bytes:  ${cssTotal}`);
console.log(`script inner bytes: ${scriptInner.length}`);
console.log(`js written bytes:   ${jsTotal}`);
