'use strict';

const { enabledSources, sourceById } = require('./sources');
const { extractLocs, isSitemapIndex } = require('./sitemap');
const { libraryRecordFromHtml } = require('./record');

const USER_AGENT = 'Hverdagsplanleggeren/1.0 (+https://hverdagsplanleggeren.com)';
const DELAY_MS = 2500;
const DEFAULT_MAX_PAGES = 300;

function hostOf(url) {
  return new URL(url).host;
}

async function politeFetch(deps, lastByHost, url, prior) {
  const host = hostOf(url);
  const now = deps.now();
  const last = lastByHost.get(host) || 0;
  const wait = Math.max(0, last + DELAY_MS - now);
  if (wait > 0) await deps.sleep(wait);
  lastByHost.set(host, deps.now());
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml',
  };
  if (prior?.etag) headers['If-None-Match'] = prior.etag;
  if (prior?.last_modified) headers['If-Modified-Since'] = prior.last_modified;
  const res = await deps.fetch(url, { method: 'GET', headers, redirect: 'follow' });
  const text = res.status === 304 ? '' : await res.text();
  return {
    status: res.status,
    text,
    etag: typeof res.headers?.get === 'function' ? res.headers.get('etag') : null,
    lastModified: typeof res.headers?.get === 'function' ? res.headers.get('last-modified') : null,
  };
}

async function collectRecipeUrls(deps, source, state) {
  const queue = [source.sitemapUrl];
  const seen = new Set();
  const recipes = [];
  while (queue.length > 0 && state.pages < state.maxPages) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const prior = deps.repos.recipeLibrary.getFetch(url);
    const response = await politeFetch(deps, state.lastByHost, url, prior);
    state.pages += 1;
    deps.repos.recipeLibrary.saveFetch({
      url,
      sourceName: source.sourceName,
      etag: response.etag,
      lastModified: response.lastModified,
      httpStatus: response.status,
      error: response.status >= 400 ? `HTTP ${response.status}` : null,
      fetchedAt: new Date(deps.now()).toISOString(),
    });
    if (response.status === 304 || response.status >= 400) continue;
    if (isSitemapIndex(response.text)) {
      for (const loc of extractLocs(response.text)) queue.push(loc);
      continue;
    }
    for (const loc of extractLocs(response.text)) {
      if (source.recipePath.test(loc)) recipes.push(loc);
    }
  }
  return recipes;
}

/**
 * Crawl enabled sources, or one source id. No network unless `fetch` is passed
 * or the caller is the cron/admin path with the env flag.
 */
async function ingestRecipeLibrary(repos, options = {}) {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const sources = options.sourceId
    ? [sourceById(options.sourceId)].filter(Boolean)
    : enabledSources();
  const deps = {
    repos,
    fetch: options.fetch || globalThis.fetch,
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: options.now || (() => Date.now()),
  };
  const productsMap =
    repos.products && typeof repos.products.getAllAsMap === 'function'
      ? repos.products.getAllAsMap()
      : {};
  const state = { pages: 0, maxPages, lastByHost: new Map() };
  let stored = 0;
  let fetched = 0;
  for (const source of sources) {
    if (state.pages >= state.maxPages) break;
    const urls = await collectRecipeUrls(deps, source, state);
    for (const url of urls) {
      if (state.pages >= state.maxPages) break;
      const prior = repos.recipeLibrary.getFetch(url);
      if (prior && prior.http_status === 200 && !prior.error && !options.refresh) continue;
      const response = await politeFetch(deps, state.lastByHost, url, prior);
      state.pages += 1;
      fetched += 1;
      if (response.status === 304) {
        repos.recipeLibrary.saveFetch({
          url,
          sourceName: source.sourceName,
          etag: prior?.etag ?? response.etag,
          lastModified: prior?.last_modified ?? response.lastModified,
          httpStatus: 304,
          error: null,
          fetchedAt: new Date(deps.now()).toISOString(),
        });
        continue;
      }
      if (response.status >= 400) {
        repos.recipeLibrary.saveFetch({
          url,
          sourceName: source.sourceName,
          etag: response.etag,
          lastModified: response.lastModified,
          httpStatus: response.status,
          error: `HTTP ${response.status}`,
          fetchedAt: new Date(deps.now()).toISOString(),
        });
        continue;
      }
      try {
        const record = libraryRecordFromHtml(response.text, url, source.sourceName, productsMap);
        if (!record) {
          repos.recipeLibrary.saveFetch({
            url,
            sourceName: source.sourceName,
            etag: response.etag,
            lastModified: response.lastModified,
            httpStatus: response.status,
            error: 'no Recipe JSON-LD',
            fetchedAt: new Date(deps.now()).toISOString(),
          });
          continue;
        }
        repos.recipeLibrary.upsert({
          ...record,
          fetchedAt: new Date(deps.now()).toISOString(),
        });
        stored += 1;
        repos.recipeLibrary.saveFetch({
          url,
          sourceName: source.sourceName,
          etag: response.etag,
          lastModified: response.lastModified,
          httpStatus: response.status,
          error: null,
          fetchedAt: new Date(deps.now()).toISOString(),
        });
      } catch (err) {
        repos.recipeLibrary.saveFetch({
          url,
          sourceName: source.sourceName,
          etag: response.etag,
          lastModified: response.lastModified,
          httpStatus: response.status,
          error: err.message,
          fetchedAt: new Date(deps.now()).toISOString(),
        });
      }
    }
  }
  return { pages: state.pages, fetched, stored, sources: sources.map((s) => s.id) };
}

module.exports = {
  ingestRecipeLibrary,
  politeFetch,
  USER_AGENT,
  DELAY_MS,
  DEFAULT_MAX_PAGES,
};
