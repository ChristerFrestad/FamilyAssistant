#!/usr/bin/env node
// ============================================================================
// FASE E — apply-patch.js
// Injiserer glass-upgrade.css, css-additions.css, html-additions.html og
// js-additions.js inn i public/index.html på riktige markerings-steder.
//
// Idempotent: kan kjøres flere ganger uten å duplisere innhold.
// Bruker FASE_E_BEGIN/FASE_E_END kommentar-markører.
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const INDEX_HTML = path.join(ROOT, 'public', 'index.html');
const GLASS_CSS = path.join(__dirname, 'glass-upgrade.css');
const ADDITIONS_CSS = path.join(__dirname, 'css-additions.css');
const HTML_ADDITIONS = path.join(__dirname, 'html-additions.html');
const JS_ADDITIONS = path.join(__dirname, 'js-additions.js');

function read(p) { return fs.readFileSync(p, 'utf8'); }

function stripExistingPatch(src) {
  // Fjern alle tidligere Fase E-blokker så vi kan re-injisere rent
  return src.replace(
    /\n?\s*\/\* ===== FASE_E_BEGIN [^*]+ \*\/[\s\S]*?\/\* ===== FASE_E_END [^*]+ \*\/\n?/g,
    '\n'
  ).replace(
    /\n?\s*<!-- ===== FASE_E_BEGIN [^>]+ ===== -->[\s\S]*?<!-- ===== FASE_E_END [^>]+ ===== -->\n?/g,
    '\n'
  ).replace(
    /\n?\s*\/\/ ===== FASE_E_BEGIN [^\n]+[\s\S]*?\/\/ ===== FASE_E_END [^\n]+\n?/g,
    '\n'
  );
}

function wrapCss(label, content) {
  return `\n/* ===== FASE_E_BEGIN ${label} ===== */\n${content.trim()}\n/* ===== FASE_E_END ${label} ===== */\n`;
}
function wrapHtml(label, content) {
  return `\n<!-- ===== FASE_E_BEGIN ${label} ===== -->\n${content.trim()}\n<!-- ===== FASE_E_END ${label} ===== -->\n`;
}
function wrapJs(label, content) {
  return `\n// ===== FASE_E_BEGIN ${label} =====\n${content.trim()}\n// ===== FASE_E_END ${label} =====\n`;
}

let src = read(INDEX_HTML);
src = stripExistingPatch(src);

// ============================================================================
// 1. CSS: injiser glass-upgrade + css-additions rett FØR /* Hide views */
// ============================================================================
const cssBlock =
  wrapCss('glass-upgrade', read(GLASS_CSS)) +
  wrapCss('css-additions', read(ADDITIONS_CSS));

const cssMarker = '/* Hide views */';
if (!src.includes(cssMarker)) {
  throw new Error(`Kunne ikke finne CSS-markør '${cssMarker}' i index.html`);
}
src = src.replace(cssMarker, cssBlock + '\n    ' + cssMarker);

// ============================================================================
// 2. HTML: injiser FAB rett FØR <!-- TABS -->
// ============================================================================
const htmlBlock = wrapHtml('fab', read(HTML_ADDITIONS));
const htmlMarker = '<!-- TABS -->';
if (!src.includes(htmlMarker)) {
  throw new Error(`Kunne ikke finne HTML-markør '${htmlMarker}' i index.html`);
}
src = src.replace(htmlMarker, htmlBlock + '\n' + htmlMarker);

// ============================================================================
// 3. JS: erstatt eksisterende loadShopping/renderShopping + legg til nye
// ============================================================================
// Fjern eksisterende loadShopping + renderShopping + handlers i one-shot.
// Gjøres ved å finne "// === HANDLETUR ===" ned til og med neste "// ===" seksjon.
const shoppingStart = src.indexOf('// === HANDLETUR ===');
if (shoppingStart === -1) {
  throw new Error('Kunne ikke finne "// === HANDLETUR ===" markør i JS');
}
// Finn neste "// === XXX ===" etter shoppingStart
const afterShopping = src.indexOf('// === HUSARBEID ===', shoppingStart);
if (afterShopping === -1) {
  throw new Error('Kunne ikke finne "// === HUSARBEID ===" markør');
}
const removedShoppingJs = src.slice(shoppingStart, afterShopping);

// Les js-additions.js og lag én stor JS-blokk som erstatter hele HANDLETUR-seksjonen
const jsAdditions = read(JS_ADDITIONS);

// Marker state-variabler (må plasseres øverst hos de andre state-variablene)
const stateVarsBlock = `
let shoppingSubView = 'buy';
let pantryData = null;
let currentShoppingListId = null;
let enrichmentPollTimer = null;
let recipeImportTab = 'text';
let recipeImportImageB64 = null;
`.trim();

// Strip KUN den innledende STATE-blokka fra js-additions.js (ikke lenger ned!).
// Regex må stoppe på første tomme linje etter `let enrichmentPollTimer = null;`
// ellers spiser den opp alle handlerne som kommer etter.
const jsWithoutState = jsAdditions
  .replace(/\/\/ --- STATE[\s\S]*?let enrichmentPollTimer = null;\n/, '')
  // Og også fjern de to recipe-import state-linjene (de dupliseres ellers med
  // state-vars-blokka som injiseres separat)
  .replace(/^let recipeImportTab = 'text';.*\n/m, '')
  .replace(/^let recipeImportImageB64 = null;\n/m, '')
  .trim();

// Bygg komplett ny HANDLETUR + nye seksjoner
const newShoppingJs = wrapJs('shopping-pantry-recipe-import', `
// === HANDLETUR (Fase E) ===
${jsWithoutState}
`);

// Erstatt HANDLETUR-seksjonen med ny versjon (+ legg tilbake nye handlere)
src = src.slice(0, shoppingStart) + newShoppingJs + '\n' + src.slice(afterShopping);

// ============================================================================
// 4. Legg til state-variabler ved eksisterende state-blokk
// ============================================================================
const stateMarker = 'let expandedRecipes = new Set();';
if (!src.includes(stateMarker)) {
  throw new Error(`Kunne ikke finne state-markør '${stateMarker}'`);
}
src = src.replace(
  stateMarker,
  stateMarker + '\n' +
  wrapJs('state-vars', stateVarsBlock).trim()
);

// ============================================================================
// 5. Patch switchTab for å kalle updateFabVisibility + stoppe enrichment-poll
// ============================================================================
const switchTabMarker = `function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(el.dataset.view).classList.add('active');

  // Load data for the tab
  const view = el.dataset.view;
  if (view === 'viewToday') loadToday();
  if (view === 'viewMeals') loadMeals();
  if (view === 'viewShopping') loadShopping();
  if (view === 'viewChores') loadChores();
}`;

const switchTabNew = `function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(el.dataset.view).classList.add('active');

  // Load data for the tab
  const view = el.dataset.view;
  // FASE_E: stopp enrichment-polling hvis vi forlater shopping
  if (view !== 'viewShopping' && enrichmentPollTimer) {
    clearTimeout(enrichmentPollTimer);
    enrichmentPollTimer = null;
  }
  if (view === 'viewToday') loadToday();
  if (view === 'viewMeals') loadMeals();
  if (view === 'viewShopping') loadShopping();
  if (view === 'viewChores') loadChores();
  // FASE_E: oppdater FAB synlighet
  if (typeof updateFabVisibility === 'function') updateFabVisibility();
}`;

if (!src.includes(switchTabMarker)) {
  throw new Error('Kunne ikke finne switchTab-funksjonen å patche');
}
src = src.replace(switchTabMarker, switchTabNew);

// ============================================================================
// Skriv ut
// ============================================================================
fs.writeFileSync(INDEX_HTML, src, 'utf8');
const lines = src.split('\n').length;
console.log(`✅ Fase E patch applied. index.html is now ${lines} lines.`);
