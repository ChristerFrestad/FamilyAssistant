'use strict';

const { slugifyProductKey } = require('../slugify');

/**
 * Exact catalog key, or the single catalog key whose slug equals the
 * whole ingredient name. A shorter name must not attach to a longer
 * key (løk must not become hvitløk).
 * @param {string} name
 * @param {Record<string, unknown>} productsMap
 * @returns {string|null}
 */
function matchCatalogKey(name, productsMap) {
  const cleaned = String(name || '')
    .trim()
    .toLowerCase();
  if (!cleaned || !productsMap) return null;
  const keys = Object.keys(productsMap);
  for (const key of keys) {
    if (key.toLowerCase() === cleaned) return key;
  }
  const slug = slugifyProductKey(cleaned);
  if (!slug) return null;
  const hits = keys.filter((key) => slugifyProductKey(key.toLowerCase()) === slug);
  if (hits.length === 1) return hits[0];
  return null;
}

module.exports = { matchCatalogKey };
