/**
 * Fase F7 — Recipe sources + connector-interface.
 *
 * Én connector per type (pinterest/godt/rss/html). Hver connector
 * eksponerer:
 *   - detect(url): boolean — om denne connectoren håndterer URL
 *   - sync(url): async → { recipes: [], error? }
 *
 * Stubber returnerer tom array i første iterasjon. Strukturen er
 * klar for framtidig utvidelse med ekte scrapers og API-kall.
 */

const { logger } = require('../logger');

const connectors = {
  pinterest: {
    type: 'pinterest',
    detect: (url) => /pinterest\.(com|no)/i.test(url),
    async sync(url) {
      logger.info({ url, connector: 'pinterest' }, 'recipe-sources: sync (stub)');
      // Fremtidig: Pinterest API eller oembed-scraping
      return { recipes: [], note: 'Pinterest-connector er en stub (Fase F7.1 planlagt)' };
    },
  },
  godt: {
    type: 'godt',
    detect: (url) => /godt\.no/i.test(url),
    async sync(url) {
      logger.info({ url, connector: 'godt' }, 'recipe-sources: sync (stub)');
      // Fremtidig: Godt.no RSS eller scraping
      return { recipes: [], note: 'Godt.no-connector er en stub (Fase F7.1 planlagt)' };
    },
  },
  rss: {
    type: 'rss',
    detect: (url) => /\.(rss|xml)(\?|$)|\/feed\/?(\?|$)/i.test(url),
    async sync(url) {
      logger.info({ url, connector: 'rss' }, 'recipe-sources: sync (stub)');
      // Fremtidig: enkel RSS-parser med feed-heuristikk for recipe-urler
      return { recipes: [], note: 'RSS-connector er en stub (Fase F7.1 planlagt)' };
    },
  },
  html: {
    type: 'html',
    detect: () => true, // Fallback
    async sync(url) {
      logger.info({ url, connector: 'html' }, 'recipe-sources: sync (stub)');
      // Fremtidig: generisk schema.org/Recipe-parser
      return { recipes: [], note: 'Generisk HTML-connector er en stub (Fase F7.1 planlagt)' };
    },
  },
};

/**
 * Detektér hvilken type connector en URL matcher. Pinterest/Godt/RSS
 * har prioritet over generisk html.
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
 * Synk én konkret kilde ved id. Kalles av cron-jobben og manuell trigger.
 */
async function syncSource(repos, sourceId) {
  if (!repos.recipeSources || typeof repos.recipeSources.getById !== 'function') {
    return { ok: false, error: 'recipe_sources-repo ikke tilgjengelig' };
  }
  const source = repos.recipeSources.getById(sourceId);
  if (!source) return { ok: false, error: 'Kilde ikke funnet' };
  if (!source.enabled) return { ok: false, error: 'Kilde er deaktivert' };

  const connector = connectors[source.type] || connectors.html;
  try {
    const result = await connector.sync(source.url);
    repos.recipeSources.updateSyncMeta(sourceId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncCount: (result.recipes || []).length,
    });
    // Fremtid: faktisk insert av result.recipes som source='imported'
    return { ok: true, count: (result.recipes || []).length, note: result.note };
  } catch (err) {
    logger.warn({ err: err.message, sourceId, url: source.url }, 'recipe-sources: sync feilet');
    return { ok: false, error: err.message };
  }
}

/**
 * Synk alle aktiverte kilder. Kalt av cron hver 6. time.
 */
async function syncAllEnabled(repos) {
  if (!repos.recipeSources || typeof repos.recipeSources.getEnabled !== 'function') {
    return { ok: false, error: 'repo ikke tilgjengelig', synced: 0 };
  }
  const sources = repos.recipeSources.getEnabled();
  let synced = 0;
  let failed = 0;
  for (const src of sources) {
    const r = await syncSource(repos, src.id);
    if (r.ok) synced++; else failed++;
  }
  logger.info({ total: sources.length, synced, failed }, 'recipe-sources: syncAllEnabled ferdig');
  return { ok: true, total: sources.length, synced, failed };
}

module.exports = {
  connectors,
  detectType,
  syncSource,
  syncAllEnabled,
};
