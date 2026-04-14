// Price-reference service (Iterasjon 1)
//
// Ansvar:
//   1. Slå opp prisreferanse for et gitt produkt (product_key eller EAN)
//   2. Indeksere gamle priser med SSB konsumprisindeks (KPI / tabell 14700)
//      når Kassal ikke har en fersk observasjon
//   3. Hente friske priser fra Kassal.app (valgfritt — slår seg av hvis ingen
//      API-nøkkel er konfigurert)
//   4. Estimere total verdi av pantry basert på eksisterende referanser
//
// Designvalg:
//   - Kassal-klient er "best effort" — feil logges men kaster ikke.
//   - CPI-tallet er konfigurerbart i seed-format slik at vi kan endre det
//     årlig uten å treffe SSBs API i produksjon. En årlig cron-jobb kan
//     oppdatere verdien.
//   - Service kaster aldri hvis repos-metoder er intakte; retur er alltid
//     et strukturert objekt så kallere slipper try/catch rundt hver lookup.
//
// Se også: server/repositories.js (priceReferences, priceHistory)

const { logger } = require('../logger');

// ============================================================
// Konstanter
// ============================================================

// Ferskhet (dager) som styrer hvilken strategi som brukes ved lookup.
const FRESH_DAYS = 30; // <30 dager: bruk direkte, confidence = originalen
const INDEX_DAYS = 90; // 30–90: CPI-indekser til ny pris
const STALE_DAYS = 90; // >90: markeres stale (search-UI kan skjule)

// Default SSB KPI YoY-vekst i prosent (oppdateres manuelt ved årsskifte).
// Hvis en mer oppdatert verdi eksisterer i price_references.indexed_from
// brukes den i stedet; dette er bare fallback.
const DEFAULT_CPI_ANNUAL_PCT = 3.5; // 2025-nivå, revurderes årlig

// Kassal.app API — krever API-nøkkel for å være aktivert.
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
 * Beregn CPI-multiplier basert på antall dager siden sist verifisert.
 * f.eks. 200 dager med 3.5% årlig vekst → 1.0 * (1.035)^(200/365) ≈ 1.0191
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
 * Finn beste tilgjengelige pris for et produkt.
 * Returnerer:
 *   { price, confidence, source, store, daysOld, priceRefId, productName }
 * eller null hvis ingen referanse finnes.
 *
 * Hvis raden er 30–90 dager gammel, CPI-indekseres prisen i minnet
 * (uten å skrive til DB — indekseringen skrives ved cron-jobb).
 */
function lookupPrice(repos, productKey, { ean = null } = {}) {
  let row = null;
  if (ean) row = repos.priceReferences.getByEan(ean);
  if (!row) row = repos.priceReferences.getBest(productKey);
  if (!row) return null;

  const age = daysSince(row.lastVerified);
  const fresh = age < FRESH_DAYS;
  const stale = age >= STALE_DAYS;
  // "indexed" = CPI ble brukt til å justere prisen i minnet.
  // Alt over FRESH_DAYS får CPI-indeksering; stale får i tillegg lavere
  // confidence slik at UI kan vise advarsel.
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
 * Returner et estimat for total verdi av gjeldende pantry.
 * Ukjente varer gis 0 slik at summen er et "lower bound".
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
    // Skaler prisen med beholdning: qtyRemaining / pack_size gir antall "pakker".
    // Hvis pack_size er ukjent, bruk 1 pakke som fallback.
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
// CPI-indeksering (daglig/ukentlig cron)
// ============================================================

/**
 * Finn alle priser eldre enn INDEX_DAYS og oppdater dem via CPI.
 * Skriver ny rad til price_history med source='cpi_index'.
 * Returnerer antall oppdaterte rader.
 */
function applyCpiIndexing(
  repos,
  { annualPct = DEFAULT_CPI_ANNUAL_PCT, olderThanDays = INDEX_DAYS } = {}
) {
  const stale = repos.priceReferences.getStale(olderThanDays);
  if (stale.length === 0) return 0;

  // Beregn gjennomsnittlig alder så multiplier blir rimelig.
  // Hver rad kan være ulik alder, men siden verdien bare er et estimat
  // bruker vi per-row-beregning.
  let count = 0;
  for (const row of stale) {
    const age = daysSince(row.lastVerified);
    if (age <= olderThanDays) continue;
    const mult = cpiMultiplier(age, annualPct);
    const newPrice = Math.round(row.currentPrice * mult * 100) / 100;
    if (newPrice === row.currentPrice) continue;
    // Bruk eksisterende repo-metode for atomisk update + history
    // (applyCpiMultiplier oppdaterer alle stale — vi kan ikke bruke den per-rad
    //  uten å introdusere N*N-arbeid, så vi gjør det manuelt her.)
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
    logger.info({ count, olderThanDays, annualPct }, 'price-reference: CPI-indeksering fullført');
  }
  return count;
}

// ============================================================
// Kassal.app-klient (best effort, valgfri)
// ============================================================

/**
 * Hent én produkt-oppslag fra Kassal (krever KASSAL_API_KEY).
 * Returnerer parsed response eller null.
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
      logger.warn({ status: res.status, query }, 'price-reference: Kassal-feil');
      return null;
    }
    const body = await res.json();
    return body?.data || null;
  } catch (err) {
    logger.warn({ err: err.message, query }, 'price-reference: Kassal-oppslag feilet');
    return null;
  } finally {
    clearTimeout(tm);
  }
}

/**
 * Synk én enkelt product_key fra Kassal og skriv til price_references.
 * Returnerer oppdatert rad eller null.
 */
async function syncProductFromKassal(repos, productKey, searchQuery) {
  const data = await fetchFromKassal(searchQuery || productKey);
  if (!data || data.length === 0) return null;
  // Velg billigste observasjon
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
  cpiMultiplier, // eksportert for testing
  daysSince, // eksportert for testing
  FRESH_DAYS,
  INDEX_DAYS,
  STALE_DAYS,
  DEFAULT_CPI_ANNUAL_PCT,
};
