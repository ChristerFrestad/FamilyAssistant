// Product resolver (Iteration 3a — minimal variant)
//
// Responsibility: given a "need" (EAN, or name + hint), find the stable
// Kassal SKU that matches best. Persist both the SKU in kassal_products
// and the resolution link in product_resolutions so that next time the
// same need shows up we can answer without an API call.
//
// Design choices:
//   - EAN path is always fastest and has highest confidence (1.0). Try
//     it first whenever EAN is provided.
//   - Cache-first on productKey: if times_confirmed ≥ 1 for a previous
//     resolution, use it without another Kassal call.
//   - Scoring for name search is deterministic and reproducible. No LLM
//     in the hot path in 3a. LLM-rerank comes in 3c.
//   - The whole service is null-safe: a missing API key or downtime
//     returns null, never throws.
//
// References:
//   - server/services/kassal-client.service.js (HTTP + cache)
//   - server/repositories.js (kassalProducts, productResolutions)

const { logger } = require('../logger');
const kassalClient = require('./kassal-client.service');

// ============================================================
// Utility
// ============================================================

function normalize(text) {
  return (text || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Split name into "significant" words (≥3 chars, not stop-words).
 */
const STOP_WORDS = new Set([
  'og',
  'med',
  'fra',
  'til',
  'som',
  'for',
  'uten',
  'med',
  'ny',
  'nye',
  'ekstra',
  'premium',
  'original',
]);

function tokenize(text) {
  return normalize(text)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Overlap between two word sets (Jaccard-like without length normalisation).
 */
function wordOverlap(candidateTokens, queryTokens) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const cset = new Set(candidateTokens);
  let hits = 0;
  for (const w of queryTokens) if (cset.has(w)) hits++;
  return hits / queryTokens.length;
}

/**
 * Proximity between two pack sizes in gram equivalents.
 * Returns 0–1 where 1 = exact match.
 */
function packSizeProximity(candidateSize, candidateUnit, targetQty, targetUnit) {
  if (!candidateSize || !targetQty) return 0.5; // neutral when unknown
  const candG = toGrams(candidateSize, candidateUnit);
  const targG = toGrams(targetQty, targetUnit);
  if (!candG || !targG) return 0.5;
  const ratio = Math.min(candG, targG) / Math.max(candG, targG);
  return ratio; // 1.0 exact, 0.5 half, etc.
}

function toGrams(size, unit) {
  const u = (unit || '').toLowerCase();
  if (!Number.isFinite(size)) return null;
  if (u === 'kg') return size * 1000;
  if (u === 'g' || u === 'gram') return size;
  if (u === 'l' || u === 'liter') return size * 1000; // assume 1:1 for liquids
  if (u === 'ml') return size;
  if (u === 'stk') return null; // not comparable
  return null;
}

// ============================================================
// Chain extraction (Migration 013)
// ============================================================

/**
 * Norwegian grocery chains, sorted longest name first to avoid e.g.
 * "Extra" matching before "Coop Extra".
 */
const KNOWN_CHAINS = [
  'Coop Extra',
  'Coop Prix',
  'Coop Mega',
  'Coop Obs',
  'Coop Marked',
  'Rema 1000',
  'Nærbutikken',
  'Bunnpris',
  'Europris',
  'Joker',
  'Kiwi',
  'Meny',
  'Spar',
  'Extra',
];

/**
 * Extract the chain name from a store name.
 *   "Kiwi Vagsbygd" -> "Kiwi"  (example with Norwegian-place name)
 *   "Rema 1000 Lund" → "Rema 1000"
 *   "Coop Extra Sordal" -> "Coop Extra"  (example with Norwegian-place name)
 *   null / unknown → null
 */
function extractChain(storeName) {
  if (!storeName) return null;
  const s = storeName.trim().toLowerCase();
  for (const chain of KNOWN_CHAINS) {
    if (s.startsWith(chain.toLowerCase())) return chain;
  }
  return null;
}

/**
 * Additive boost for chain preference. Used as a tiebreaker in scoring.
 * Preferred chain: +0.15, secondary chain: +0.07, other: 0.
 */
function chainBoost(candidate, preferredChain, secondaryChain) {
  if (!preferredChain && !secondaryChain) return 0;
  const store = candidate.store?.name || candidate.store || candidate.last_seen_store || null;
  const chain = extractChain(store);
  if (!chain) return 0;
  const cl = chain.toLowerCase();
  if (preferredChain && cl === preferredChain.toLowerCase()) return 0.15;
  if (secondaryChain && cl === secondaryChain.toLowerCase()) return 0.07;
  return 0;
}

/**
 * Compute a combined score 0–1+ for a Kassal candidate given a need.
 * Weights:
 *   - 0.50 word overlap in name
 *   - 0.25 brand-hint match
 *   - 0.20 pack-size proximity
 *   - 0.05 price knowledge (has current_price)
 *   - +0.15 preferred chain (additive bonus)
 *   - +0.07 secondary chain (additive bonus)
 */
function scoreCandidate(candidate, { name, brandHint, qty, unit }, chainPrefs = {}) {
  const queryTokens = tokenize(name);
  const candTokens = tokenize(
    `${candidate.name || ''} ${candidate.brand || ''} ${candidate.vendor || ''}`
  );
  const overlap = wordOverlap(candTokens, queryTokens);

  let brandMatch = 0;
  if (brandHint && candidate.brand) {
    const bh = normalize(brandHint);
    const cb = normalize(candidate.brand);
    if (cb === bh || cb.includes(bh) || bh.includes(cb)) brandMatch = 1;
  } else if (!brandHint) {
    brandMatch = 0.5; // no hint to check against
  }

  const prox = packSizeProximity(
    candidate.pack_size ?? candidate.packSize,
    candidate.pack_unit ?? candidate.packUnit ?? candidate.weight_unit,
    qty,
    unit
  );

  const priceKnown = Number.isFinite(candidate.current_price) ? 1 : 0;

  const base = overlap * 0.5 + brandMatch * 0.25 + prox * 0.2 + priceKnown * 0.05;
  return base + chainBoost(candidate, chainPrefs.preferredChain, chainPrefs.secondaryChain);
}

// ============================================================
// Persistence helpers
// ============================================================

/**
 * Map a Kassal product object to our kassalProducts schema and upsert.
 * Returns { kassalProductRowId, kassalId }.
 */
function persistKassalProduct(repos, rawProduct, { captureSource = 'lookup' } = {}) {
  if (!rawProduct || (!rawProduct.id && !rawProduct.kassal_id)) return null;
  const kassalId = String(rawProduct.id ?? rawProduct.kassal_id);

  const rowId = repos.kassalProducts.upsert({
    kassalId,
    ean: rawProduct.ean || null,
    name: rawProduct.name || '',
    brand: rawProduct.brand || null,
    vendor: rawProduct.vendor || null,
    category: rawProduct.category?.name || rawProduct.category || null,
    packSize: rawProduct.weight ?? rawProduct.pack_size ?? null,
    packUnit: rawProduct.weight_unit ?? rawProduct.pack_unit ?? null,
    imageUrl: rawProduct.image || rawProduct.image_url || null,
    lastSeenPrice: Number.isFinite(rawProduct.current_price) ? rawProduct.current_price : null,
    lastSeenStore: rawProduct.store?.name || rawProduct.store || null,
    rawJson: JSON.stringify(rawProduct),
    captureSource,
  });
  return { kassalProductRowId: rowId, kassalId };
}

/**
 * Normalise the Kassal response to a list of product candidates.
 * Kassal's variants can be an object or an array, and can live in
 * body.data or body.products. We already unpack in the client, but we
 * handle both here for safety.
 */
function asProductArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.products)) return raw.products;
  if (raw.id || raw.kassal_id || raw.ean) return [raw]; // single product
  return [];
}

// ============================================================
// Public API
// ============================================================

/**
 * Resolve via EAN (barcode). Always confidence 1.0 on a hit.
 *
 * @returns {Promise<object|null>} { kassalProductRowId, kassalId, confidence, resolvedVia, candidates }
 */
async function resolveByEan(repos, ean, { productKey = null, captureSource = 'lookup' } = {}) {
  if (!ean) return null;

  // 1. Check our own catalog first — avoid the API call if we have seen it before
  const existing = repos.kassalProducts.getByEan(ean);
  if (existing) {
    const resolutionId = repos.productResolutions.upsertSeen({
      productKey,
      kassalProductId: existing.id,
      resolvedVia: 'ean',
      confidence: 1.0,
    });
    return {
      kassalProductRowId: existing.id,
      kassalId: existing.kassal_id,
      confidence: 1.0,
      resolvedVia: 'ean',
      resolutionId,
      candidates: [existing],
      fromCatalog: true,
    };
  }

  // 2. Fetch from Kassal
  const raw = await kassalClient.getByEan(repos, ean);
  if (!raw) return null;

  const products = asProductArray(raw);
  if (products.length === 0) return null;

  const persisted = persistKassalProduct(repos, products[0], { captureSource });
  if (!persisted) return null;

  const resolutionId = repos.productResolutions.upsertSeen({
    productKey,
    kassalProductId: persisted.kassalProductRowId,
    resolvedVia: 'ean',
    confidence: 1.0,
  });

  return {
    kassalProductRowId: persisted.kassalProductRowId,
    kassalId: persisted.kassalId,
    confidence: 1.0,
    resolvedVia: 'ean',
    resolutionId,
    candidates: [products[0]],
    fromCatalog: false,
  };
}

/**
 * Resolve via name + hint. Used for OCR lines and ingredients.
 *
 * @param {Object} repos
 * @param {Object} need
 * @param {string} need.name         — ingredient name or receipt line
 * @param {number} [need.qty]        — quantity from receipt/ingredient
 * @param {string} [need.unit]       — 'g','kg','l','ml','stk'
 * @param {string} [need.brandHint]  — e.g. 'First Price', 'Tine'
 * @param {string} [need.productKey] — if we know our own product key
 * @param {string} [need.ean]        — if OCR found a barcode
 * @param {string} [captureSource]
 * @returns {Promise<object|null>}
 */
async function resolveByLine(repos, need, { captureSource = 'lookup', chainPrefs = {} } = {}) {
  if (!need || !need.name) return null;

  // Fast path 1: EAN
  if (need.ean) {
    const viaEan = await resolveByEan(repos, need.ean, {
      productKey: need.productKey,
      captureSource,
    });
    if (viaEan) return viaEan;
  }

  // Fast path 2: Memo — previously confirmed resolution for this productKey
  if (need.productKey) {
    const memo = repos.productResolutions.bestForProductKey(need.productKey);
    if (memo && (memo.times_confirmed >= 1 || memo.user_locked)) {
      return {
        kassalProductRowId: memo.kassal_product_id,
        kassalId: null,
        confidence: Math.max(memo.confidence, 0.8),
        resolvedVia: 'brand_learn',
        resolutionId: memo.id,
        candidates: null,
        fromCatalog: true,
      };
    }
  }

  // Slow path: Kassal search
  const searchQuery = [need.brandHint, need.name].filter(Boolean).join(' ');
  const raw = await kassalClient.searchByName(repos, searchQuery);
  const products = asProductArray(raw);
  if (products.length === 0) return null;

  // Score and pick
  const scored = products
    .map((p) => ({ p, score: scoreCandidate(p, need, chainPrefs) }))
    .sort((a, b) => b.score - a.score);

  // If the best hit is too weak, return candidates but no authoritative match
  const best = scored[0];
  const MIN_AUTO_CONFIDENCE = 0.3;

  if (best.score < MIN_AUTO_CONFIDENCE) {
    logger.debug(
      { name: need.name, bestScore: best.score, count: products.length },
      'resolver: hit too weak, returning candidates only'
    );
    // Persist top-3 as candidates in resolution_candidates_json format
    const candidates = scored
      .slice(0, 3)
      .map((s) => persistAndDescribe(repos, s.p, s.score, captureSource));
    return {
      kassalProductRowId: null,
      kassalId: null,
      confidence: best.score,
      resolvedVia: 'llm_name',
      resolutionId: null,
      candidates: candidates.filter(Boolean),
      fromCatalog: false,
    };
  }

  // Persist best match + top-3 as candidates for UI selection
  const bestPersisted = persistKassalProduct(repos, best.p, { captureSource });
  if (!bestPersisted) return null;

  const resolutionId = repos.productResolutions.upsertSeen({
    productKey: need.productKey || null,
    kassalProductId: bestPersisted.kassalProductRowId,
    resolvedVia: 'llm_name',
    confidence: best.score,
  });

  const candidates = scored
    .slice(0, 3)
    .map((s) => persistAndDescribe(repos, s.p, s.score, captureSource));

  return {
    kassalProductRowId: bestPersisted.kassalProductRowId,
    kassalId: bestPersisted.kassalId,
    confidence: best.score,
    resolvedVia: 'llm_name',
    resolutionId,
    candidates: candidates.filter(Boolean),
    fromCatalog: false,
  };
}

/**
 * Persist a candidate in kassal_products and return a description object
 * (so it can be stored in receipt_items.resolution_candidates_json).
 */
function persistAndDescribe(repos, rawProduct, score, captureSource) {
  const persisted = persistKassalProduct(repos, rawProduct, { captureSource });
  if (!persisted) return null;
  return {
    kassalProductRowId: persisted.kassalProductRowId,
    kassalId: persisted.kassalId,
    name: rawProduct.name || '',
    brand: rawProduct.brand || null,
    store: rawProduct.store?.name || rawProduct.store || null,
    packSize: rawProduct.weight ?? rawProduct.pack_size ?? null,
    packUnit: rawProduct.weight_unit ?? rawProduct.pack_unit ?? null,
    price: Number.isFinite(rawProduct.current_price) ? rawProduct.current_price : null,
    imageUrl: rawProduct.image || rawProduct.image_url || null,
    score: Math.round(score * 100) / 100,
  };
}

module.exports = {
  resolveByEan,
  resolveByLine,
  // Exposed for testing
  scoreCandidate,
  tokenize,
  wordOverlap,
  packSizeProximity,
  persistKassalProduct,
  asProductArray,
  // Chain preferences (Migration 013)
  extractChain,
  chainBoost,
  KNOWN_CHAINS,
};
