'use strict';

const { slugifyProductKey } = require('../slugify');

// Words that describe how an ingredient is prepared. They are removed
// only when a name remains. Colour words stay, so "hvitløk" is one
// word and "gul løk" is handled by the synonym table, not by stripping.
const SAFE_ADJECTIVES = new Set([
  'stor',
  'store',
  'liten',
  'lille',
  'små',
  'liten',
  'fersk',
  'ferske',
  'fin',
  'finhakket',
  'grov',
  'grovt',
  'hakket',
  'skivet',
  'skiver',
  'revet',
  'kokt',
  'kokte',
  'stekt',
  'stekte',
  'rå',
  'økologisk',
  'fryst',
  'frossen',
  'frosne',
  'tørket',
  'tørkede',
  'renset',
  'skylt',
]);

// Common Norwegian forms that are not the catalog key. A shorter name
// is never mapped onto a longer different food (løk is not hvitløk).
const SYNONYMS = {
  potet: 'poteter',
  'gul løk': 'løk',
  'gule løk': 'løk',
  'hvit løk': 'løk',
  løker: 'løk',
  hvitløksfedd: 'hvitløk',
  'fedd hvitløk': 'hvitløk',
  tomater: 'tomat',
  paprikaer: 'paprika',
  sitroner: 'sitron',
  kyllingfileter: 'kyllingfilet',
  laksefileter: 'laksefilet',
  'oliven olje': 'olivenolje',
  smor: 'smør',
  lok: 'løk',
  hvitlok: 'hvitløk',
};

const LEADING_QTY =
  /^(?:ca\.?\s+)?(?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[½⅓¼¾⅔⅛])(?:\s*[-–]\s*(?:\d+(?:[.,]\d+)?))?\s*(?:g|kg|ml|dl|l|ss|ts|stk|fedd|gram)?\s+/i;

/**
 * Lowercase, drop a leading amount, and drop a leading safe adjective.
 * @param {unknown} name
 * @returns {string}
 */
function normalizeIngredientName(name) {
  let text = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  text = text.replace(LEADING_QTY, '').trim();
  const parts = text.split(' ').filter(Boolean);
  while (parts.length > 1 && SAFE_ADJECTIVES.has(parts[0])) parts.shift();
  return parts.join(' ');
}

/**
 * @param {string} name
 * @returns {string[]}
 */
function nameVariants(name) {
  const out = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (text && !out.includes(text)) out.push(text);
  };
  push(name);
  if (SYNONYMS[name]) push(SYNONYMS[name]);
  if (name.endsWith('er') && name.length > 4) push(name.slice(0, -2));
  if (name.endsWith('e') && name.length > 3 && !name.endsWith('er')) push(name.slice(0, -1));
  if (!name.endsWith('er') && !name.endsWith('s')) push(`${name}er`);
  for (const variant of [...out]) {
    if (SYNONYMS[variant]) push(SYNONYMS[variant]);
  }
  return out;
}

/**
 * @param {string} candidate
 * @param {string[]} keys
 * @returns {string|null}
 */
function matchOne(candidate, keys) {
  const cleaned = candidate.trim().toLowerCase();
  if (!cleaned) return null;
  for (const key of keys) {
    if (key.toLowerCase() === cleaned) return key;
  }
  const slug = slugifyProductKey(cleaned);
  if (!slug) return null;
  const hits = keys.filter((key) => slugifyProductKey(key.toLowerCase()) === slug);
  if (hits.length === 1) return hits[0];
  return null;
}

/**
 * Exact catalog key, a normalised form, a known synonym, or the single
 * catalog key whose slug equals the whole name. A shorter name must not
 * attach to a longer key (løk must not become hvitløk).
 * @param {string} name
 * @param {Record<string, unknown>} productsMap
 * @returns {string|null}
 */
function matchCatalogKey(name, productsMap) {
  const cleaned = normalizeIngredientName(name);
  if (!cleaned || !productsMap) return null;
  const keys = Object.keys(productsMap);
  const hits = new Set();
  for (const variant of nameVariants(cleaned)) {
    const hit = matchOne(variant, keys);
    if (hit) hits.add(hit);
  }
  if (hits.size === 1) return [...hits][0];
  return null;
}

module.exports = { matchCatalogKey, normalizeIngredientName };
