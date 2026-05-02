/**
 * Phase F — Pantry identity resolver.
 *
 * Takes a free-text query and returns up to N suggestions where each
 * suggestion has:
 *   { productKey, name, source, frequency, lastUsedAt, confidence }
 *
 * Sources:
 *   "kassal" — matched against Kassal product catalog (via repos.products
 *              which contains both seed products and Kassal-synced data)
 *   "lokal"  — matched against pantry history from inventory_log (has
 *              been in pantry before but is not in the products catalog)
 *   "ny"     — no match; we suggest creating a new slug
 *
 * Combination rules:
 *   1. Exact prefix matches first, then substring matches
 *   2. Kassal matches weighted higher than local history when equal
 *   3. History matches weighted by usage count
 *   4. Always return a "ny" row at the bottom unless there is already
 *      an exact match
 */

const { slugifyProductKey } = require('./slugify');

const MAX_RESULTS = 8;

function resolvePantryInput(repos, query) {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 1) return [];

  const results = [];
  const seenKeys = new Set();

  // 1. Search products catalog (kassal + seed)
  try {
    const products = repos.products.search(q) || [];
    for (const p of products) {
      if (seenKeys.has(p.key)) continue;
      seenKeys.add(p.key);
      const isExact = p.key === q || (p.product_name || '').toLowerCase() === q;
      const isPrefix = (p.product_name || '').toLowerCase().startsWith(q);
      results.push({
        productKey: p.key,
        name: p.product_name || p.key,
        source: 'kassal',
        category: p.category || null,
        unit: p.unit || null,
        packSize: p.pack_size || null,
        frequency: 0,
        lastUsedAt: null,
        confidence: isExact ? 1.0 : isPrefix ? 0.85 : 0.6,
      });
    }
  } catch {
    // Robust against repo errors — continue with other sources
  }

  // 2. Search inventory history (items currently in pantry, regardless
  //    of where they came from)
  try {
    const inventoryMap = repos.inventory.getAll();
    for (const [productKey, inv] of Object.entries(inventoryMap)) {
      if (seenKeys.has(productKey)) continue;
      const lk = productKey.toLowerCase();
      if (!lk.includes(q)) continue;
      seenKeys.add(productKey);
      results.push({
        productKey,
        name: productKey,
        source: 'lokal',
        category: null,
        unit: inv.unit || null,
        packSize: inv.lastPackSize || null,
        frequency: inv.purchaseCount || 0,
        lastUsedAt: inv.lastPurchased || null,
        confidence: lk.startsWith(q) ? 0.7 : 0.5,
      });
    }
  } catch {
    // Robust
  }

  // 3. Search inventory_log history to catch items that have been
  //    removed (qty_remaining = 0) but the user has had before
  try {
    if (repos._db && typeof repos._db.prepare === 'function') {
      const escapedQ = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const rows = repos._db
        .prepare(
          `
          SELECT product_key, COUNT(*) as cnt, MAX(created_at) as last_used
          FROM inventory_log
          WHERE lower(product_key) LIKE ? ESCAPE '\\'
          GROUP BY product_key
          ORDER BY cnt DESC
          LIMIT 20
        `
        )
        .all(`%${escapedQ}%`);
      for (const r of rows) {
        if (seenKeys.has(r.product_key)) continue;
        seenKeys.add(r.product_key);
        results.push({
          productKey: r.product_key,
          name: r.product_key,
          source: 'lokal',
          category: null,
          unit: null,
          packSize: null,
          frequency: r.cnt,
          lastUsedAt: r.last_used,
          confidence: 0.4,
        });
      }
    }
  } catch {
    // Robust
  }

  // Sort: confidence desc, then frequency desc
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.frequency || 0) - (a.frequency || 0);
  });

  const trimmed = results.slice(0, MAX_RESULTS);

  // 4. Always offer a "create new" row when there is no exact match
  const hasExact = trimmed.some((r) => r.confidence >= 1.0);
  if (!hasExact && q.length >= 2) {
    const newKey = slugifyProductKey(query);
    if (newKey && !seenKeys.has(newKey)) {
      trimmed.push({
        productKey: newKey,
        name: query,
        source: 'ny',
        category: null,
        unit: null,
        packSize: null,
        frequency: 0,
        lastUsedAt: null,
        confidence: 0.0,
      });
    }
  }

  return trimmed;
}

/**
 * Resolve an incoming add request against the catalog. Returns canonical
 * productKey + source classification. Used by POST /api/pantry/add when
 * the client has not already chosen a productKey.
 */
function resolveOrCreate(repos, query) {
  const suggestions = resolvePantryInput(repos, query);
  let result;
  if (suggestions.length === 0) {
    // Fallback: slugify directly
    const key = slugifyProductKey(query);
    result = { productKey: key, name: query, source: 'ny' };
  } else {
    const best = suggestions[0];
    result = {
      productKey: best.productKey,
      name: best.name,
      source: best.source,
      category: best.category,
      unit: best.unit,
      packSize: best.packSize,
    };
  }

  // Make sure a products row exists for the resolved key so downstream
  // pantry display falls back to the user's original text instead of the
  // slug. Without this, GET /api/pantry shows e.g. "okologisk-romme"
  // because the pantry view reads product_name from the catalog, and
  // manual items never produced a catalog entry.
  ensureProductRow(repos, result.productKey, query);

  return result;
}

/**
 * Insert a minimal products row for `productKey` using `originalName`
 * as product_name when the catalog does not already know the key. No-op
 * when the row already exists, so seed/Kassal-imported names are never
 * overwritten by slug-collision.
 */
function ensureProductRow(repos, productKey, originalName) {
  if (!productKey) return;
  if (typeof originalName !== 'string') return;
  const trimmed = originalName.trim();
  if (!trimmed) return;
  if (!repos?.products || typeof repos.products.upsert !== 'function') return;
  if (typeof repos.products.getByKey !== 'function') return;
  try {
    const existing = repos.products.getByKey(productKey);
    if (existing) return;
    repos.products.upsert({
      key: productKey,
      productName: trimmed,
      // Long-shelf default — the resolver does not know the actual
      // category. Pantry display only reads product_name + key from
      // this row; category is used by other features (filters,
      // shopping list grouping) where 'Tørrvarer & annet' is the
      // safe catch-all bucket.
      category: 'Tørrvarer & annet',
      packSize: 1,
      unit: 'stk',
      estPrice: null,
      shelfDays: null,
      store: null,
      ean: null,
      dairyRule: null,
    });
  } catch {
    // Robust against repo/DB errors — pantry display will fall back
    // to the slug, which is the pre-fix behaviour.
  }
}

module.exports = {
  resolvePantryInput,
  resolveOrCreate,
  ensureProductRow,
  MAX_RESULTS,
};
