// Shopping list enricher (Iterasjon 3b fase B)
//
// Ansvar:
//   1. Gå gjennom items på en persistent handleliste og resolve dem mot
//      Kassal.app SKU-katalogen via product-resolver.
//   2. Respektere rate limit (55 RPM i kassal-client) + circuit breaker.
//   3. Stoppe tidlig og sette enrichment_status='partial' hvis vi treffer
//      sperren — cron-jobben plukker opp igjen senere.
//   4. Skrive resolusjonen (kassal_product_id, confidence, candidates,
//      est_price oppdatert) via shoppingLists.attachResolution.
//
// Designvalg:
//   - Ingen API-nøkkel → enrichment_status='done' (noop, lista er "ferdig"
//     i den forstand at det ikke finnes mer å berike uten API).
//   - 'running'/'done' → hopper over (idempotens + beskyttelse mot at
//     to enrichers jobber på samme liste).
//   - INTER_REQUEST_DELAY_MS (default 1100) = litt over ett sekund mellom
//     hvert resolver-kall. 55 RPM betyr én request per 1.09s; 1.1s gir
//     ekstra margin og unngår at vi tømmer bucket i bursts.
//     Tester kan sette delayMs=0 for fart.
//   - Pre-check av kassal-client.getStatus() før hvert kall gjør at vi
//     bailer rent før vi brenner en request. Resolver-returner null ved
//     rate-limit internt (stale-if-error), men vi vil distinguere 'no match'
//     fra 'rate limited' slik at vi ikke markerer lista som 'done' når
//     vi egentlig bare ikke kom oss gjennom alle items.
//   - Cron plukker opp 'partial' og 'pending' med samme logikk — ved
//     restart etter crash er 'running' tilsynelatende stuck, men
//     listPendingEnrichment() inkluderer ikke 'running' → vi må håndtere
//     stuck 'running' separat (cron ser etter gamle generated_at > 30min
//     i fremtiden; ikke kritisk i 3b-fase B).

const { logger } = require('../logger');
const productResolver = require('./product-resolver.service');
const kassalClient = require('./kassal-client.service');

const DEFAULT_INTER_REQUEST_DELAY_MS = 1100;
const MAX_ITEMS_PER_RUN = 200;

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Berik en handleliste med Kassal-data. Itererer items med
 * needs_buy=1 og kassal_product_id IS NULL. Stopper tidlig ved
 * circuit-open eller tom token bucket og markerer 'partial'.
 *
 * @param {Object} repos
 * @param {number} listId
 * @param {Object} [opts]
 * @param {number} [opts.delayMs]       — delay mellom kall (default 1100)
 * @param {number} [opts.maxItems]      — øvre grense per kjøring
 * @param {string} [opts.apiKey]        — override env-nøkkel (tester)
 * @returns {Promise<{listId, enriched, skipped, bailed, finalStatus, reason?}>}
 */
async function enrichList(repos, listId, {
  delayMs = DEFAULT_INTER_REQUEST_DELAY_MS,
  maxItems = MAX_ITEMS_PER_RUN,
  apiKey = process.env.KASSAL_API_KEY,
} = {}) {
  const list = repos.shoppingLists.getById(listId);
  if (!list) {
    return { listId, enriched: 0, skipped: 0, bailed: false, finalStatus: 'missing', reason: 'not_found' };
  }

  // Fast-exit: allerede ferdig eller kjører (idempotens)
  if (list.enrichmentStatus === 'done') {
    return { listId, enriched: 0, skipped: 0, bailed: false, finalStatus: 'done', reason: 'already_done' };
  }
  if (list.enrichmentStatus === 'running') {
    return { listId, enriched: 0, skipped: 0, bailed: false, finalStatus: 'running', reason: 'already_running' };
  }

  // Ingen API-nøkkel → marker done, ingenting å gjøre
  if (!apiKey) {
    repos.shoppingLists.setEnrichmentStatus(listId, 'done', { startedAt: true, finishedAt: true });
    return { listId, enriched: 0, skipped: 0, bailed: false, finalStatus: 'done', reason: 'no_api_key' };
  }

  const toEnrich = (list.items || []).filter(it =>
    it.needsBuy && !it.kassalProductId && it.ingredientName
  ).slice(0, maxItems);

  // Ingenting å berike → done
  if (toEnrich.length === 0) {
    repos.shoppingLists.setEnrichmentStatus(listId, 'done', { startedAt: true, finishedAt: true });
    return { listId, enriched: 0, skipped: 0, bailed: false, finalStatus: 'done', reason: 'nothing_to_enrich' };
  }

  repos.shoppingLists.setEnrichmentStatus(listId, 'running', { startedAt: true });
  logger.info({ listId, itemCount: toEnrich.length }, 'enricher: start');

  let enriched = 0;
  let skipped = 0;
  let bailed = false;
  let bailReason = null;

  for (let i = 0; i < toEnrich.length; i++) {
    const item = toEnrich[i];

    // Pre-check: rate limit / circuit breaker før vi kaller resolver
    const status = kassalClient.getStatus();
    if (status.circuitOpen) {
      bailed = true;
      bailReason = 'circuit_open';
      logger.warn({ listId, remaining: toEnrich.length - i }, 'enricher: circuit open, bailer');
      break;
    }
    if (status.tokensAvailable < 1) {
      bailed = true;
      bailReason = 'rate_limit';
      logger.warn({ listId, remaining: toEnrich.length - i }, 'enricher: tom token bucket, bailer');
      break;
    }

    // Resolve
    // Fase C: preferer norsk navn hvis normalizer har satt det
    const searchName = item.ingredientNameNo || item.ingredientName;
    let resolution = null;
    let resolverThrew = false;
    try {
      resolution = await productResolver.resolveByLine(repos, {
        name: searchName,
        productKey: item.productKey || null,
        qty: item.qty,
        unit: item.unit,
        brandHint: item.brandHint || null,
      }, { captureSource: 'lookup' });
    } catch (err) {
      logger.warn({ err: err.message, itemId: item.id }, 'enricher: resolver kastet');
      resolverThrew = true;
      skipped++;
    }

    if (resolverThrew) {
      // Ikke dobbel-tell; gå videre til neste item
      if (i + 1 < toEnrich.length) await sleep(delayMs);
      continue;
    }

    if (resolution && resolution.kassalProductRowId) {
      // Hent ev. pris fra beste kandidat for estimated_price oppdatering
      const bestCand = Array.isArray(resolution.candidates) && resolution.candidates.length > 0
        ? resolution.candidates[0] : null;
      const estPrice = bestCand && Number.isFinite(bestCand.price)
        ? bestCand.price * (item.packCount || 1) : null;

      repos.shoppingLists.attachResolution(item.id, {
        kassalProductId: resolution.kassalProductRowId,
        resolutionId: resolution.resolutionId || null,
        confidence: resolution.confidence,
        resolvedVia: resolution.resolvedVia,
        candidatesJson: resolution.candidates || null,
        estimatedPrice: estPrice,
      });
      enriched++;
    } else if (resolution) {
      // Svakt treff (confidence under threshold) — lagre kandidater for UI-valg
      if (Array.isArray(resolution.candidates) && resolution.candidates.length > 0) {
        repos.shoppingLists.attachResolution(item.id, {
          kassalProductId: null,
          resolutionId: null,
          confidence: resolution.confidence || 0,
          resolvedVia: resolution.resolvedVia || 'llm_name',
          candidatesJson: resolution.candidates,
          estimatedPrice: null,
        });
      }
      skipped++;
    } else {
      skipped++;
    }

    // Spacing mellom kall for å spre belastningen jevnt under 55 RPM
    if (i + 1 < toEnrich.length) await sleep(delayMs);
  }

  const finalStatus = bailed ? 'partial' : 'done';
  repos.shoppingLists.setEnrichmentStatus(listId, finalStatus, { finishedAt: !bailed });

  logger.info(
    { listId, enriched, skipped, bailed, bailReason, finalStatus },
    'enricher: ferdig'
  );

  return { listId, enriched, skipped, bailed, finalStatus, reason: bailReason };
}

/**
 * Skann etter aktive lister med enrichment_status IN ('pending','partial')
 * og kjør enrichList på hver. Brukes av cron-jobben.
 *
 * Kjører sekvensielt — vi vil ikke brenne gjennom rate limit parallelt.
 */
async function enrichPendingLists(repos, opts = {}) {
  const ids = repos.shoppingLists.listPendingEnrichment(opts.maxLists || 5);
  const results = [];
  for (const id of ids) {
    const r = await enrichList(repos, id, opts);
    results.push(r);
    if (r.bailed) break; // Rate limit truffet — vent til neste cron-slot
  }
  return results;
}

/**
 * Fire-and-forget wrapper: schedulerer enrichList i bakgrunnen uten å
 * blokkere kalleren. Brukt av generateForWeek-ruten og autogenerer-hook.
 */
function enrichInBackground(repos, listId, opts = {}) {
  setImmediate(() => {
    enrichList(repos, listId, opts).catch(err => {
      logger.error({ err: err.message, listId }, 'enricher: bakgrunnsfeil');
    });
  });
}

module.exports = {
  enrichList,
  enrichPendingLists,
  enrichInBackground,
  DEFAULT_INTER_REQUEST_DELAY_MS,
};
