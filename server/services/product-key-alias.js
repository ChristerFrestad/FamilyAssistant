'use strict';

// Catalog keys keep Norwegian letters (kjøttpølser). Older pantry rows
// may be stored under the slug (kjottpolser). Callers that read or
// deduct must treat the pair as one ingredient.

const { slugifyProductKey } = require('./slugify');

/**
 * Raw key first, then the slug when it differs.
 * @param {string} productKey
 * @returns {string[]}
 */
function aliasKeys(productKey) {
  const raw = typeof productKey === 'string' ? productKey.trim() : '';
  if (!raw) return [];
  const slug = slugifyProductKey(raw);
  if (slug && slug !== raw) return [raw, slug];
  return [raw];
}

/** Stable group id for rømme and romme. */
function aliasGroup(productKey) {
  const keys = aliasKeys(productKey);
  return keys.length > 1 ? keys[1] : keys[0] || '';
}

/**
 * Keep a catalog key, matching case-insensitively (Kjøttpølser → kjøttpølser).
 * Unknown free text is slugified.
 * @param {Object} repos
 * @param {string} productKey
 * @returns {string}
 */
function catalogKey(repos, productKey) {
  const raw = typeof productKey === 'string' ? productKey.trim() : '';
  if (!raw) return '';
  if (
    repos.products &&
    typeof repos.products.getByKey === 'function' &&
    repos.products.getByKey(raw)
  ) {
    return raw;
  }
  if (repos.products && typeof repos.products.getAllAsMap === 'function') {
    const lower = raw.toLowerCase();
    const map = repos.products.getAllAsMap();
    for (const key of Object.keys(map)) {
      if (key.toLowerCase() === lower) return key;
    }
  }
  return slugifyProductKey(raw) || raw;
}

/**
 * Quantity at home across the raw key and its slug.
 * @param {Object} inventoryMap
 * @param {string} productKey
 * @returns {number}
 */
function pantryOnHand(inventoryMap, productKey) {
  let total = 0;
  const seen = new Set();
  for (const key of aliasKeys(productKey)) {
    if (seen.has(key)) continue;
    seen.add(key);
    total += Number(inventoryMap?.[key]?.qtyRemaining) || 0;
  }
  return total;
}

module.exports = {
  aliasKeys,
  aliasGroup,
  catalogKey,
  pantryOnHand,
};
