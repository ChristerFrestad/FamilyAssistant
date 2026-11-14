'use strict';

// Catalog keys keep Norwegian letters (kjøttpølser, rømme). Older pantry
// rows and recipe lines may use the slug (kjottpolser, romme) or a
// capitalised spelling. A lookup from either side has to see the whole
// group, and the catalog spelling wins when one exists.

const { slugifyProductKey } = require('./slugify');

/**
 * @param {string} productKey
 * @param {Object|string[]|null} [context] repos, or extra keys to scan
 * @returns {string[]}
 */
function aliasKeys(productKey, context) {
  const raw = typeof productKey === 'string' ? productKey.trim() : '';
  if (!raw) return [];
  const { repos, extraKeys } = normalizeContext(context);
  const lower = raw.toLowerCase();
  const slug = slugifyProductKey(lower) || lower;
  const catalog = catalogSpelling(repos, slug, lower);
  const ordered = [];
  const push = (key) => {
    if (typeof key !== 'string') return;
    const trimmed = key.trim();
    if (!trimmed || ordered.includes(trimmed)) return;
    ordered.push(trimmed);
  };
  if (catalog) push(catalog);
  push(lower);
  if (raw !== lower) push(raw);
  if (slug !== lower) push(slug);
  for (const key of extraKeys) {
    const text = String(key || '').trim();
    if (!text) continue;
    const keyLower = text.toLowerCase();
    const keySlug = slugifyProductKey(keyLower) || keyLower;
    if (keySlug === slug || keyLower === lower) push(text);
  }
  return ordered;
}

/** Stable group id. rømme and romme share the slug. */
function aliasGroup(productKey, _context) {
  const raw = typeof productKey === 'string' ? productKey.trim() : '';
  if (!raw) return '';
  return slugifyProductKey(raw.toLowerCase()) || raw.toLowerCase();
}

/**
 * Catalog spelling when the catalog has one, otherwise the first alias.
 * @param {string} productKey
 * @param {Object|string[]|null} [context]
 * @returns {string}
 */
function preferredKey(productKey, context) {
  return aliasKeys(productKey, context)[0] || '';
}

/**
 * Keep a catalog key, matching case-insensitively (Kjøttpølser → kjøttpølser).
 * Unknown free text is slugified.
 * @param {Object} repos
 * @param {string} productKey
 * @returns {string}
 */
function catalogKey(repos, productKey) {
  const preferred = preferredKey(productKey, repos);
  if (preferred && repos?.products?.getByKey?.(preferred)) return preferred;
  const raw = typeof productKey === 'string' ? productKey.trim() : '';
  if (!raw) return '';
  return slugifyProductKey(raw.toLowerCase()) || raw.toLowerCase();
}

/**
 * Quantity at home across every spelling in the group.
 * @param {Object} inventoryMap
 * @param {string} productKey
 * @param {Object|null} [repos]
 * @returns {number}
 */
function pantryOnHand(inventoryMap, productKey, repos) {
  let total = 0;
  const seen = new Set();
  const extraKeys = inventoryMap ? Object.keys(inventoryMap) : [];
  for (const key of aliasKeys(productKey, { repos, extraKeys })) {
    if (seen.has(key)) continue;
    seen.add(key);
    total += Number(inventoryMap?.[key]?.qtyRemaining) || 0;
  }
  return total;
}

/**
 * Collapse rømme/romme in a suggestion list. The catalog spelling stays.
 * @param {Array} suggestions
 * @param {Object} repos
 * @returns {Array}
 */
function dedupeSearchSuggestions(suggestions, repos) {
  if (!Array.isArray(suggestions)) return [];
  const products = repos?.products?.getAllAsMap?.() || {};
  const seen = new Set();
  const out = [];
  for (const row of suggestions) {
    if (!row || !row.productKey) {
      out.push(row);
      continue;
    }
    const group = aliasGroup(row.productKey, repos);
    if (seen.has(group)) continue;
    seen.add(group);
    const canonical = preferredKey(row.productKey, repos) || row.productKey;
    if (canonical === row.productKey) {
      out.push(row);
      continue;
    }
    const product = products[canonical];
    out.push({
      ...row,
      productKey: canonical,
      name: product?.productName || row.name,
    });
  }
  return out;
}

function normalizeContext(context) {
  if (Array.isArray(context)) return { repos: null, extraKeys: context };
  if (!context || typeof context !== 'object') return { repos: null, extraKeys: [] };
  if (Array.isArray(context.extraKeys) || context.repos) {
    return { repos: context.repos || null, extraKeys: context.extraKeys || [] };
  }
  if (context.products || context.inventory) return { repos: context, extraKeys: [] };
  return { repos: null, extraKeys: [] };
}

function catalogSpelling(repos, slug, lower) {
  if (!repos?.products || typeof repos.products.getAllAsMap !== 'function') return null;
  const products = repos.products.getAllAsMap();
  let fromSlug = null;
  let fromLower = null;
  for (const key of Object.keys(products)) {
    const keyLower = key.toLowerCase();
    const keySlug = slugifyProductKey(keyLower) || keyLower;
    if (keySlug === slug) fromSlug = preferCatalog(fromSlug, key);
    if (keyLower === lower) fromLower = preferCatalog(fromLower, key);
  }
  return fromLower || fromSlug;
}

function preferCatalog(current, next) {
  if (!current) return next;
  const currentSlug = slugifyProductKey(current.toLowerCase()) === current.toLowerCase();
  const nextSlug = slugifyProductKey(next.toLowerCase()) === next.toLowerCase();
  if (currentSlug && !nextSlug) return next;
  return current;
}

module.exports = {
  aliasKeys,
  aliasGroup,
  preferredKey,
  catalogKey,
  pantryOnHand,
  dedupeSearchSuggestions,
};
