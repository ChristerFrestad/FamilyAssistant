// Product resolver (Iterasjon 3a — minimal variant)
//
// Ansvar: Gitt et "behov" (EAN, eller navn + hint), finn den stabile
// Kassal-SKU-en som matcher best. Persistér både SKU-en i kassal_products
// og resolution-koblingen i product_resolutions, slik at neste gang samme
// behov dukker opp kan vi svare uten API-kall.
//
// Designvalg:
//   - EAN-path er alltid raskest og har høyest confidence (1.0). Prøv
//     alltid først hvis EAN er oppgitt.
//   - Cache-first på productKey: hvis times_confirmed ≥ 1 for en
//     tidligere resolution, bruk den uten nytt Kassal-kall.
//   - Scoring for navn-søk er deterministisk og reproducerbar. Ingen LLM
//     i hot path i 3a. LLM-rerank kommer i 3c.
//   - Hele servicen er null-safe: manglende API-nøkkel eller nedetid
//     returnerer null, aldri kaster.
//
// Referanser:
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
 * Del navn i "betydningsfulle" ord (≥3 tegn, ikke stop-ord).
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
 * Overlap mellom to ordsett (Jaccard-lik uten normalisering på lengde).
 */
function wordOverlap(candidateTokens, queryTokens) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const cset = new Set(candidateTokens);
  let hits = 0;
  for (const w of queryTokens) if (cset.has(w)) hits++;
  return hits / queryTokens.length;
}

/**
 * Nærhet mellom to pakkestørrelser i gram-ekvivalenter.
 * Returnerer 0–1 der 1 = eksakt match.
 */
function packSizeProximity(candidateSize, candidateUnit, targetQty, targetUnit) {
  if (!candidateSize || !targetQty) return 0.5; // nøytral hvis vi ikke vet
  const candG = toGrams(candidateSize, candidateUnit);
  const targG = toGrams(targetQty, targetUnit);
  if (!candG || !targG) return 0.5;
  const ratio = Math.min(candG, targG) / Math.max(candG, targG);
  return ratio; // 1.0 eksakt, 0.5 halvparten, osv.
}

function toGrams(size, unit) {
  const u = (unit || '').toLowerCase();
  if (!Number.isFinite(size)) return null;
  if (u === 'kg') return size * 1000;
  if (u === 'g' || u === 'gram') return size;
  if (u === 'l' || u === 'liter') return size * 1000; // antar 1:1 for væske
  if (u === 'ml') return size;
  if (u === 'stk') return null; // ikke sammenlignbart
  return null;
}

// ============================================================
// Kjede-ekstraksjon (Migration 013)
// ============================================================

/**
 * Norske dagligvarekjeder, sortert lengste navn først for å unngå
 * at f.eks. "Extra" matcher før "Coop Extra".
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
 * Ekstraher kjedenavn fra et butikknavn.
 *   "Kiwi Vågsbygd" → "Kiwi"
 *   "Rema 1000 Lund" → "Rema 1000"
 *   "Coop Extra Sørdal" → "Coop Extra"
 *   null / ukjent → null
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
 * Additiv boost for kjede-preferanse. Brukes som tiebreaker i scoring.
 * Foretrukket kjede: +0.15, sekundærkjede: +0.07, annet: 0.
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
 * Beregn en samlet score 0–1+ for en Kassal-kandidat gitt et behov.
 * Vekter:
 *   - 0.50 ordoverlapp i navn
 *   - 0.25 merkehint treff
 *   - 0.20 pakkestørrelse-nærhet
 *   - 0.05 priskjennskap (har current_price)
 *   - +0.15 foretrukket kjede (additiv bonus)
 *   - +0.07 sekundærkjede (additiv bonus)
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
    brandMatch = 0.5; // ingen hint å sjekke mot
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
// Persistens-hjelp
// ============================================================

/**
 * Map et Kassal-produkt-objekt til vårt kassalProducts-skjema og upsert.
 * Returnerer { kassalProductRowId, kassalId }.
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
 * Normaliser Kassal-respons til en liste med produkt-kandidater.
 * Kassal sine varianter kan være et objekt eller en array, og kan ligge
 * i body.data eller body.products. Vi har allerede unpacket i klienten,
 * men håndterer begge her for sikkerhets skyld.
 */
function asProductArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.products)) return raw.products;
  if (raw.id || raw.kassal_id || raw.ean) return [raw]; // enkelt-produkt
  return [];
}

// ============================================================
// Public API
// ============================================================

/**
 * Resolve via EAN (strekkode). Alltid confidence 1.0 ved treff.
 *
 * @returns {Promise<object|null>} { kassalProductRowId, kassalId, confidence, resolvedVia, candidates }
 */
async function resolveByEan(repos, ean, { productKey = null, captureSource = 'lookup' } = {}) {
  if (!ean) return null;

  // 1. Sjekk vår egen katalog først — unngå API-kall hvis vi allerede har sett
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

  // 2. Hent fra Kassal
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
 * Resolve via navn + hint. Brukes for OCR-linjer og ingredienser.
 *
 * @param {Object} repos
 * @param {Object} need
 * @param {string} need.name         — ingrediensnavn eller kvitteringslinje
 * @param {number} [need.qty]        — mengde fra kvittering/ingrediens
 * @param {string} [need.unit]       — 'g','kg','l','ml','stk'
 * @param {string} [need.brandHint]  — f.eks. 'First Price', 'Tine'
 * @param {string} [need.productKey] — hvis vi kjenner vårt eget produkt-nøkkel
 * @param {string} [need.ean]        — hvis OCR fant strekkode
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

  // Fast path 2: Memo — tidligere confirmed resolution for denne productKey
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

  // Slow path: Kassal-søk
  const searchQuery = [need.brandHint, need.name].filter(Boolean).join(' ');
  const raw = await kassalClient.searchByName(repos, searchQuery);
  const products = asProductArray(raw);
  if (products.length === 0) return null;

  // Score og velg
  const scored = products
    .map((p) => ({ p, score: scoreCandidate(p, need, chainPrefs) }))
    .sort((a, b) => b.score - a.score);

  // Hvis beste treff er for svakt, returner kandidater men ingen autoritativ match
  const best = scored[0];
  const MIN_AUTO_CONFIDENCE = 0.3;

  if (best.score < MIN_AUTO_CONFIDENCE) {
    logger.debug(
      { name: need.name, bestScore: best.score, count: products.length },
      'resolver: for svakt treff, returnerer kandidater kun'
    );
    // Persistér topp-3 som candidates i resolution_candidates_json-format
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

  // Persistér beste match + topp-3 som kandidater for UI-valg
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
 * Persistér en kandidat i kassal_products og returnér et beskrivelse-objekt
 * (for å kunne lagres i receipt_items.resolution_candidates_json).
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
  // Eksponert for testing
  scoreCandidate,
  tokenize,
  wordOverlap,
  packSizeProximity,
  persistKassalProduct,
  asProductArray,
  // Kjede-preferanser (Migration 013)
  extractChain,
  chainBoost,
  KNOWN_CHAINS,
};
