// Shopping list enricher (Iteration 3b phase B)
//
// Responsibilities:
//   1. Iterate items on a persistent shopping list and resolve them
//      against the Kassal.app SKU catalog via product-resolver.
//   2. Respect the rate limit (55 RPM in kassal-client) + circuit breaker.
//   3. Stop early and set enrichment_status='partial' when we hit the
//      limit — the cron job picks up later.
//   4. Write the resolution (kassal_product_id, confidence, candidates,
//      updated est_price) via shoppingLists.attachResolution.
//
// Design choices:
//   - No API key → enrichment_status='done' (noop, the list is "done"
//     in the sense that there is nothing more to enrich without the API).
//   - 'running'/'done' → skipped (idempotency + protection against two
//     enrichers working on the same list).
//   - INTER_REQUEST_DELAY_MS (default 1100) = just over one second
//     between each resolver call. 55 RPM means one request per 1.09s;
//     1.1s gives extra margin and avoids draining the bucket in bursts.
//     Tests can set delayMs=0 for speed.
//   - Pre-check of kassal-client.getStatus() before each call lets us
//     bail cleanly before burning a request. The resolver returns null
//     on internal rate-limit (stale-if-error), but we want to distinguish
//     'no match' from 'rate limited' so we don't mark the list as 'done'
//     when we just didn't get through all items.
//   - The cron picks up 'partial' and 'pending' with the same logic —
//     after a crash restart, 'running' may look stuck;
//     listPendingEnrichment() does not include 'running' → stuck
//     'running' must be handled separately (the cron checks for old
//     generated_at > 30min in the future; not critical in 3b phase B).

const { logger } = require('../logger');
const productResolver = require('./product-resolver.service');
const kassalClient = require('./kassal-client.service');

const DEFAULT_INTER_REQUEST_DELAY_MS = 1100;
const MAX_ITEMS_PER_RUN = 200;

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enrich a shopping list with Kassal data. Iterates items with
 * needs_buy=1 and kassal_product_id IS NULL. Stops early on circuit-open
 * or empty token bucket and marks 'partial'.
 *
 * @param {Object} repos
 * @param {number} listId
 * @param {Object} [opts]
 * @param {number} [opts.delayMs]       — delay between calls (default 1100)
 * @param {number} [opts.maxItems]      — upper bound per run
 * @param {string} [opts.apiKey]        — override env key (tests)
 * @returns {Promise<{listId, enriched, skipped, bailed, finalStatus, reason?}>}
 */
async function enrichList(
  repos,
  listId,
  {
    delayMs = DEFAULT_INTER_REQUEST_DELAY_MS,
    maxItems = MAX_ITEMS_PER_RUN,
    apiKey = process.env.KASSAL_API_KEY,
  } = {}
) {
  const list = repos.shoppingLists.getById(listId);
  if (!list) {
    return {
      listId,
      enriched: 0,
      skipped: 0,
      bailed: false,
      finalStatus: 'missing',
      reason: 'not_found',
    };
  }

  // Fast-exit: already done or running (idempotency)
  if (list.enrichmentStatus === 'done') {
    return {
      listId,
      enriched: 0,
      skipped: 0,
      bailed: false,
      finalStatus: 'done',
      reason: 'already_done',
    };
  }
  if (list.enrichmentStatus === 'running') {
    return {
      listId,
      enriched: 0,
      skipped: 0,
      bailed: false,
      finalStatus: 'running',
      reason: 'already_running',
    };
  }

  // No API key → mark done, nothing to do
  if (!apiKey) {
    repos.shoppingLists.setEnrichmentStatus(listId, 'done', { startedAt: true, finishedAt: true });
    return {
      listId,
      enriched: 0,
      skipped: 0,
      bailed: false,
      finalStatus: 'done',
      reason: 'no_api_key',
    };
  }

  const toEnrich = (list.items || [])
    .filter((it) => it.needsBuy && !it.kassalProductId && it.ingredientName)
    .slice(0, maxItems);

  // Load chain preferences from family profile (Migration 013)
  const profile = repos.familyProfile ? repos.familyProfile.get() : {};
  const chainPrefs = {
    preferredChain: profile.preferredChain || null,
    secondaryChain: profile.secondaryChain || null,
  };

  // Nothing to enrich → done
  if (toEnrich.length === 0) {
    repos.shoppingLists.setEnrichmentStatus(listId, 'done', { startedAt: true, finishedAt: true });
    return {
      listId,
      enriched: 0,
      skipped: 0,
      bailed: false,
      finalStatus: 'done',
      reason: 'nothing_to_enrich',
    };
  }

  repos.shoppingLists.setEnrichmentStatus(listId, 'running', { startedAt: true });
  logger.info({ listId, itemCount: toEnrich.length }, 'enricher: start');

  let enriched = 0;
  let skipped = 0;
  let bailed = false;
  let bailReason = null;

  for (let i = 0; i < toEnrich.length; i++) {
    const item = toEnrich[i];

    // Pre-check: rate limit / circuit breaker before calling resolver
    const status = kassalClient.getStatus();
    if (status.circuitOpen) {
      bailed = true;
      bailReason = 'circuit_open';
      logger.warn({ listId, remaining: toEnrich.length - i }, 'enricher: circuit open, bailing');
      break;
    }
    if (status.tokensAvailable < 1) {
      bailed = true;
      bailReason = 'rate_limit';
      logger.warn(
        { listId, remaining: toEnrich.length - i },
        'enricher: empty token bucket, bailing'
      );
      break;
    }

    // Resolve
    // Phase C: prefer the Norwegian name if the normalizer set one
    const searchName = item.ingredientNameNo || item.ingredientName;
    let resolution = null;
    let resolverThrew = false;
    try {
      resolution = await productResolver.resolveByLine(
        repos,
        {
          name: searchName,
          productKey: item.productKey || null,
          qty: item.qty,
          unit: item.unit,
          brandHint: item.brandHint || null,
        },
        { captureSource: 'lookup', chainPrefs }
      );
    } catch (err) {
      logger.warn({ err: err.message, itemId: item.id }, 'enricher: resolver threw');
      resolverThrew = true;
      skipped++;
    }

    if (resolverThrew) {
      // Don't double-count; move on to the next item
      if (i + 1 < toEnrich.length) await sleep(delayMs);
      continue;
    }

    if (resolution && resolution.kassalProductRowId) {
      // Get optional price from the best candidate for estimated_price update
      const bestCand =
        Array.isArray(resolution.candidates) && resolution.candidates.length > 0
          ? resolution.candidates[0]
          : null;
      const estPrice =
        bestCand && Number.isFinite(bestCand.price) ? bestCand.price * (item.packCount || 1) : null;

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
      // Weak match (confidence below threshold) — save candidates for UI selection
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

    // Spacing between calls to spread load evenly under 55 RPM
    if (i + 1 < toEnrich.length) await sleep(delayMs);
  }

  const finalStatus = bailed ? 'partial' : 'done';
  repos.shoppingLists.setEnrichmentStatus(listId, finalStatus, { finishedAt: !bailed });

  logger.info({ listId, enriched, skipped, bailed, bailReason, finalStatus }, 'enricher: done');

  return { listId, enriched, skipped, bailed, finalStatus, reason: bailReason };
}

/**
 * Scan for active lists with enrichment_status IN ('pending','partial')
 * and run enrichList on each. Used by the cron job.
 *
 * Runs sequentially — we don't want to burn through the rate limit in
 * parallel.
 */
async function enrichPendingLists(repos, opts = {}) {
  const ids = repos.shoppingLists.listPendingEnrichment(opts.maxLists || 5);
  const results = [];
  for (const id of ids) {
    const r = await enrichList(repos, id, opts);
    results.push(r);
    if (r.bailed) break; // Rate limit hit — wait until next cron slot
  }
  return results;
}

/**
 * Fire-and-forget wrapper: schedules enrichList in the background
 * without blocking the caller. Used by the generateForWeek route and
 * the auto-generate hook.
 */
function enrichInBackground(repos, listId, opts = {}) {
  setImmediate(() => {
    enrichList(repos, listId, opts).catch((err) => {
      logger.error({ err: err.message, listId }, 'enricher: background error');
    });
  });
}

module.exports = {
  enrichList,
  enrichPendingLists,
  enrichInBackground,
  DEFAULT_INTER_REQUEST_DELAY_MS,
};
