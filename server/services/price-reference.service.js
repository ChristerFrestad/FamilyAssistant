// Price-reference service (Iteration 1)
//
// Responsibilities:
//   1. Look up the price reference for a given product (product_key or EAN)
//   2. Index old prices with SSB CPI (KPI / table 14700) when Kassal does
//      not have a fresh observation
//   3. Fetch fresh prices from Kassal.app (optional — disables itself if
//      no API key is configured)
//   4. Estimate the total value of the pantry based on existing references
//
// Design choices:
//   - Kassal client is "best effort" — errors are logged but not thrown.
//   - The CPI number is configurable in seed format so we can update it
//     yearly without hitting SSB's API in production. A yearly cron job
//     can update the value.
//   - The service never throws as long as repos methods are intact;
//     the return is always a structured object so callers don't need a
//     try/catch around every lookup.
//
// See also: server/repositories.js (priceReferences, priceHistory)

const { logger } = require('../logger');

// ============================================================
// Constants
// ============================================================

// Freshness (days) controlling which strategy is used at lookup.
const FRESH_DAYS = 30; // <30 days: use directly, confidence = original
const INDEX_DAYS = 90; // 30–90: CPI-index to a new price
const STALE_DAYS = 90; // >90: marked stale (search UI can hide)

// Default SSB CPI YoY growth in percent (updated manually at year-end).
// If a more recent value exists in price_references.indexed_from it is
// used instead; this is only a fallback.
const DEFAULT_CPI_ANNUAL_PCT = 3.5; // 2025 level, reassessed yearly

// Kassal.app API — requires an API key to be enabled.
const KASSAL_BASE_URL = 'https://kassal.app/api/v1';
const KASSAL_TIMEOUT_MS = 8000;

// ============================================================
// Utility
// ============================================================

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/**
 * Compute the CPI multiplier based on the number of days since last
 * verified.
 * e.g. 200 days with 3.5% annual growth → 1.0 * (1.035)^(200/365) ≈ 1.0191
 */
function cpiMultiplier(daysOld, annualPct = DEFAULT_CPI_ANNUAL_PCT) {
  if (!Number.isFinite(daysOld) || daysOld <= 0) return 1;
  const years = daysOld / 365;
  return Math.pow(1 + annualPct / 100, years);
}

// ============================================================
// Lookup
// ============================================================

/**
 * Find the best available price for a product.
 * Returns:
 *   { price, confidence, source, store, daysOld, priceRefId, productName }
 * or null if no reference exists.
 *
 * If the row is 30–90 days old, the price is CPI-indexed in memory
 * (without writing to DB — the indexing is written by a cron job).
 */
function lookupPrice(repos, productKey, { ean = null } = {}) {
  let row = null;
  if (ean) row = repos.priceReferences.getByEan(ean);
  if (!row) row = repos.priceReferences.getBest(productKey);
  if (!row) return null;

  const age = daysSince(row.lastVerified);
  const fresh = age < FRESH_DAYS;
  const stale = age >= STALE_DAYS;
  // "indexed" = CPI was used to adjust the price in memory.
  // Anything older than FRESH_DAYS gets CPI indexing; stale rows also
  // get a lower confidence so the UI can show a warning.
  const indexed = !fresh;

  let price = row.currentPrice;
  let confidence = row.confidence ?? 1.0;
  if (indexed) {
    const mult = cpiMultiplier(age);
    price = Math.round(price * mult * 100) / 100;
    confidence = Math.min(confidence, 0.7);
  }
  if (stale) {
    confidence = Math.min(confidence, 0.5);
  }

  return {
    price,
    confidence,
    source: row.source,
    store: row.store,
    daysOld: Math.round(age),
    priceRefId: row.id,
    productName: row.productName,
    stale,
    indexed,
  };
}

/**
 * Return an estimate of the total value of the current pantry.
 * Unknown items get 0 so the sum is a "lower bound".
 */
function estimatePantryValue(repos) {
  const inventoryMap = repos.inventory.getAll();
  let total = 0;
  let knownCount = 0;
  let unknownCount = 0;
  for (const [key, inv] of Object.entries(inventoryMap)) {
    if (!inv.qtyRemaining || inv.qtyRemaining <= 0) continue;
    const ref = lookupPrice(repos, key);
    if (!ref) {
      unknownCount++;
      continue;
    }
    knownCount++;
    // Scale the price by remaining stock: qtyRemaining / pack_size gives
    // the number of "packs". If pack_size is unknown, use 1 pack as fallback.
    const packSize = ref.packSize || 1;
    const packs = Math.max(1, Math.ceil(inv.qtyRemaining / packSize));
    total += ref.price * packs;
  }
  return {
    totalEstimated: Math.round(total * 100) / 100,
    itemsKnown: knownCount,
    itemsUnknown: unknownCount,
    fieldConfidence:
      knownCount + unknownCount > 0
        ? Math.round((knownCount / (knownCount + unknownCount)) * 100) / 100
        : 0,
  };
}

// ============================================================
// CPI indexing (daily/weekly cron)
// ============================================================

/**
 * Find all prices older than INDEX_DAYS and update them via CPI.
 * Writes a new row to price_history with source='cpi_index'.
 * Returns the number of updated rows.
 */
function applyCpiIndexing(
  repos,
  { annualPct = DEFAULT_CPI_ANNUAL_PCT, olderThanDays = INDEX_DAYS } = {}
) {
  const stale = repos.priceReferences.getStale(olderThanDays);
  if (stale.length === 0) return 0;

  // Compute average age so the multiplier is reasonable.
  // Each row can be a different age, but since the value is only an
  // estimate we use per-row calculation.
  let count = 0;
  for (const row of stale) {
    const age = daysSince(row.lastVerified);
    if (age < olderThanDays) continue;
    const mult = cpiMultiplier(age, annualPct);
    const newPrice = Math.round(row.currentPrice * mult * 100) / 100;
    if (newPrice === row.currentPrice) continue;
    // Use existing repo method for atomic update + history
    // (applyCpiMultiplier updates all stale — we can't use it per-row
    //  without introducing N*N work, so we do it manually here.)
    repos._db
      .prepare(
        `
      UPDATE price_references
         SET current_price = ?, confidence = 0.7,
             indexed_from = date('now'), updated_at = datetime('now')
       WHERE id = ?
    `
      )
      .run(newPrice, row.id);
    repos.priceHistory.insert({
      priceRefId: row.id,
      price: newPrice,
      source: 'cpi_index',
    });
    count++;
  }
  if (count > 0) {
    logger.info({ count, olderThanDays, annualPct }, 'price-reference: CPI indexing completed');
  }
  return count;
}

// ============================================================
// Kassal.app client (best effort, optional)
// ============================================================

/**
 * Fetch a single product lookup from Kassal (requires KASSAL_API_KEY).
 * Returns parsed response or null.
 */
async function fetchFromKassal(query, { apiKey = process.env.KASSAL_API_KEY } = {}) {
  if (!apiKey) return null;
  const url = `${KASSAL_BASE_URL}/products?search=${encodeURIComponent(query)}&size=5`;
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), KASSAL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status, query }, 'price-reference: Kassal error');
      return null;
    }
    const body = await res.json();
    return body?.data || null;
  } catch (err) {
    logger.warn({ err: err.message, query }, 'price-reference: Kassal lookup failed');
    return null;
  } finally {
    clearTimeout(tm);
  }
}

/**
 * Sync a single product_key from Kassal and write to price_references.
 * Returns the updated row or null.
 */
async function syncProductFromKassal(repos, productKey, searchQuery) {
  const data = await fetchFromKassal(searchQuery || productKey);
  if (!data || data.length === 0) return null;
  // Pick the cheapest observation
  const best = data
    .filter((p) => p && Number.isFinite(p.current_price))
    .sort((a, b) => a.current_price - b.current_price)[0];
  if (!best) return null;

  return repos.priceReferences.upsert({
    productKey,
    productName: best.name || productKey,
    brand: best.brand || null,
    category: best.category?.name || null,
    packSize: best.weight || null,
    packUnit: best.weight_unit || null,
    ean: best.ean || null,
    currentPrice: best.current_price,
    pricePerUnit: best.price_per_unit || null,
    store: best.store || 'kassal',
    source: 'kassal',
    sourceUrl: best.url || null,
    confidence: 1.0,
  });
}

// ============================================================
// Export
// ============================================================

module.exports = {
  lookupPrice,
  estimatePantryValue,
  applyCpiIndexing,
  fetchFromKassal,
  syncProductFromKassal,
  cpiMultiplier, // exported for testing
  daysSince, // exported for testing
  FRESH_DAYS,
  INDEX_DAYS,
  STALE_DAYS,
  DEFAULT_CPI_ANNUAL_PCT,
};
