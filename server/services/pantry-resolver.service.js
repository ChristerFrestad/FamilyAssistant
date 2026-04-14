/**
 * Fase F – Pantry identity resolver.
 *
 * Tar en fritekst-forespørsel og returnerer opp til N forslag, hvor hvert
 * forslag har:
 *   { productKey, name, source, frequency, lastUsedAt, confidence }
 *
 * Kilder:
 *   "kassal" — matchet mot Kassal-produktkatalog (via repos.products som
 *              inneholder både seed-produkter og Kassal-synket data)
 *   "lokal"  — matchet mot pantry-historikk fra inventory_log (har vært
 *              i pantry før, men finnes ikke i products-katalog)
 *   "ny"     — intet treff; vi foreslår å opprette et nytt slug
 *
 * Kombinasjons-regler:
 *   1. Eksakte prefix-matches øverst, deretter substring-matches
 *   2. Kassal-matches vektes høyere enn lokal-historikk ved likhet
 *   3. Historikk-matches vektes etter antall ganger brukt
 *   4. Returnerer alltid en "ny"-rad nederst hvis det ikke allerede er en eksakt match
 */

const { slugifyProductKey } = require('./slugify');

const MAX_RESULTS = 8;

function resolvePantryInput(repos, query) {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 1) return [];

  const results = [];
  const seenKeys = new Set();

  // 1. Søk i products-katalog (kassal + seed)
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
  } catch (err) {
    // Robust mot repo-feil — fortsett med andre kilder
  }

  // 2. Søk i inventory-historikk (ting som finnes i pantry nå, uansett hvor de kom fra)
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
  } catch (err) {
    // Robust
  }

  // 3. Søk i inventory_log-historikk for å fange opp ting som er fjernet
  //    (qty_remaining = 0) men brukeren har hatt før
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
  } catch (err) {
    // Robust
  }

  // Sorter: confidence desc, deretter frequency desc
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.frequency || 0) - (a.frequency || 0);
  });

  const trimmed = results.slice(0, MAX_RESULTS);

  // 4. Alltid tilby "opprett ny"-rad hvis ingen eksakt match
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
 * Resolver en inn-kommende add-request mot katalogen. Returnerer canonical
 * productKey + klassifisering av kilde. Brukes av POST /api/pantry/add når
 * klienten ikke allerede har bestemt seg for en productKey.
 */
function resolveOrCreate(repos, query) {
  const suggestions = resolvePantryInput(repos, query);
  if (suggestions.length === 0) {
    // Fallback: slugify direkte
    const key = slugifyProductKey(query);
    return { productKey: key, name: query, source: 'ny' };
  }
  const best = suggestions[0];
  return {
    productKey: best.productKey,
    name: best.name,
    source: best.source,
    category: best.category,
    unit: best.unit,
    packSize: best.packSize,
  };
}

module.exports = {
  resolvePantryInput,
  resolveOrCreate,
  MAX_RESULTS,
};
