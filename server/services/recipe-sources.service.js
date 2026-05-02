/**
 * Phase F7 — Recipe sources + connector interface.
 *
 * One connector per type (pinterest/godt/rss/html). Each connector
 * exposes:
 *   - detect(url): boolean — whether this connector handles the URL
 *   - sync(url): async → { recipes: [], error? }
 *
 * Stubs return an empty array in the first iteration. The structure is
 * ready for future expansion with real scrapers and API calls.
 */

const { logger } = require('../logger');

const connectors = {
  pinterest: {
    type: 'pinterest',
    detect: (url) => /pinterest\.(com|no)/i.test(url),
    async sync(url) {
      logger.info({ url, connector: 'pinterest' }, 'recipe-sources: sync (stub)');
      // Future: Pinterest API or oembed scraping
      return { recipes: [], note: 'Pinterest connector is a stub (Phase F7.1 planned)' };
    },
  },
  godt: {
    type: 'godt',
    detect: (url) => /godt\.no/i.test(url),
    async sync(url) {
      logger.info({ url, connector: 'godt' }, 'recipe-sources: sync (stub)');
      // Future: Godt.no RSS or scraping
      return { recipes: [], note: 'Godt.no connector is a stub (Phase F7.1 planned)' };
    },
  },
  rss: {
    type: 'rss',
    detect: (url) => /\.(rss|xml)(\?|$)|\/feed\/?(\?|$)/i.test(url),
    async sync(url) {
      logger.info({ url, connector: 'rss' }, 'recipe-sources: sync (stub)');
      // Future: simple RSS parser with feed heuristics for recipe URLs
      return { recipes: [], note: 'RSS connector is a stub (Phase F7.1 planned)' };
    },
  },
  html: {
    type: 'html',
    detect: () => true, // Fallback
    async sync(url) {
      logger.info({ url, connector: 'html' }, 'recipe-sources: sync (stub)');
      // Future: generic schema.org/Recipe parser
      return { recipes: [], note: 'Generic HTML connector is a stub (Phase F7.1 planned)' };
    },
  },
};

/**
 * Detect which connector type a URL matches. Pinterest/Godt/RSS have
 * priority over generic html.
 */
function detectType(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  if (connectors.pinterest.detect(url)) return 'pinterest';
  if (connectors.godt.detect(url)) return 'godt';
  if (connectors.rss.detect(url)) return 'rss';
  if (/^https?:\/\//i.test(url)) return 'html';
  return 'unknown';
}

/**
 * Sync a single source by id. Called by the cron job and manual trigger.
 */
async function syncSource(repos, sourceId) {
  if (!repos.recipeSources || typeof repos.recipeSources.getById !== 'function') {
    return { ok: false, error: 'recipe_sources repo not available' };
  }
  const source = repos.recipeSources.getById(sourceId);
  if (!source) return { ok: false, error: 'Source not found' };
  if (!source.enabled) return { ok: false, error: 'Source is disabled' };

  const connector = connectors[source.type] || connectors.html;
  try {
    const result = await connector.sync(source.url);
    repos.recipeSources.updateSyncMeta(sourceId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncCount: (result.recipes || []).length,
    });
    // Future: actual insert of result.recipes as source='imported'
    return { ok: true, count: (result.recipes || []).length, note: result.note };
  } catch (err) {
    logger.warn({ err: err.message, sourceId, url: source.url }, 'recipe-sources: sync failed');
    return { ok: false, error: err.message };
  }
}

/**
 * Sync all enabled sources. Called by cron every 6 hours.
 */
async function syncAllEnabled(repos) {
  if (!repos.recipeSources || typeof repos.recipeSources.getEnabled !== 'function') {
    return { ok: false, error: 'repo not available', synced: 0 };
  }
  const sources = repos.recipeSources.getEnabled();
  let synced = 0;
  let failed = 0;
  for (const src of sources) {
    const r = await syncSource(repos, src.id);
    if (r.ok) synced++;
    else failed++;
  }
  logger.info({ total: sources.length, synced, failed }, 'recipe-sources: syncAllEnabled done');
  return { ok: true, total: sources.length, synced, failed };
}

module.exports = {
  connectors,
  detectType,
  syncSource,
  syncAllEnabled,
};
