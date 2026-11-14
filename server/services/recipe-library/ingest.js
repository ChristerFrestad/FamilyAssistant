'use strict';

const { enabledSources, sourceById } = require('./sources');
const { extractLocs, isSitemapIndex } = require('./sitemap');
const { libraryRecordFromHtml } = require('./record');
const { canonicalRecipeUrl } = require('./url');

const USER_AGENT = 'Hverdagsplanleggeren/1.0 (+https://hverdagsplanleggeren.com)';
const DELAY_MS = 2500;
const DEFAULT_MAX_PAGES = 300;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

let ingestRunning = false;

function libraryUserAgent() {
  const { config } = require('../../config');
  return config.RECIPE_LIBRARY_USER_AGENT || USER_AGENT;
}

function isIngestRunning() {
  return ingestRunning;
}

function holdIngestLock() {
  if (ingestRunning) return false;
  ingestRunning = true;
  return true;
}

function releaseIngestLock() {
  ingestRunning = false;
}

function allowedHosts(source) {
  const hosts = source.hosts && source.hosts.length ? source.hosts : [source.host];
  return new Set(hosts.map((host) => String(host).toLowerCase()));
}

function assertAllowed(source, urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    const err = new Error('invalid url');
    err.code = 'URL_BLOCKED';
    throw err;
  }
  if (url.protocol !== 'https:') {
    const err = new Error('only https URLs are fetched');
    err.code = 'URL_BLOCKED';
    throw err;
  }
  if (!allowedHosts(source).has(url.hostname.toLowerCase())) {
    const err = new Error('host is not allowed for this source');
    err.code = 'URL_BLOCKED';
    throw err;
  }
  return url;
}

function headerGet(res, name) {
  if (!res || !res.headers) return null;
  if (typeof res.headers.get === 'function') return res.headers.get(name);
  const value = res.headers[name] || res.headers[name.toLowerCase()];
  return value == null ? null : String(value);
}

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = typeof res.text === 'function' ? await res.text() : '';
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('response too large');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* the cap already failed the response */
      }
      const err = new Error('response too large');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(Buffer.from(step.value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseCrawlDelaySeconds(text, userAgent) {
  const groups = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (!current || current.sealed) {
        current = { agents: [], delay: null, sealed: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    current.sealed = true;
    if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.delay = seconds;
    }
  }
  const ua = String(userAgent || '').toLowerCase();
  const specific = groups.find(
    (group) =>
      group.delay != null && group.agents.some((agent) => agent !== '*' && ua.includes(agent))
  );
  if (specific) return specific.delay;
  const star = groups.find((group) => group.agents.includes('*') && group.delay != null);
  return star ? star.delay : null;
}

async function waitTurn(deps, host, delayMs) {
  const now = deps.now();
  const last = deps.lastByHost.get(host) || 0;
  const wait = Math.max(0, last + delayMs - now);
  if (wait > 0) await deps.sleep(wait);
  deps.lastByHost.set(host, deps.now());
}

async function fetchAllowed(deps, source, url, prior) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertAllowed(source, current);
    const host = new URL(current).hostname.toLowerCase();
    const delayMs = deps.delayByHost.get(host) || DELAY_MS;
    await waitTurn(deps, host, delayMs);
    const headers = {
      'User-Agent': libraryUserAgent(),
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain',
    };
    if (prior?.etag) headers['If-None-Match'] = prior.etag;
    if (prior?.last_modified) headers['If-Modified-Since'] = prior.last_modified;
    const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await deps.fetch(current, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal,
    });
    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = headerGet(res, 'location');
      if (!location) {
        const err = new Error('redirect without location');
        err.code = 'URL_BLOCKED';
        throw err;
      }
      current = new URL(location, current).toString();
      prior = null;
      continue;
    }
    const text = status === 304 ? '' : await readLimited(res, deps.maxBytes || MAX_BYTES);
    return {
      status,
      text,
      finalUrl: current,
      etag: headerGet(res, 'etag'),
      lastModified: headerGet(res, 'last-modified'),
    };
  }
  const err = new Error('too many redirects');
  err.code = 'URL_BLOCKED';
  throw err;
}

function remember(deps, source, url, response, error) {
  deps.repos.recipeLibrary.saveFetch({
    url,
    sourceName: source.sourceName,
    etag: response?.etag ?? null,
    lastModified: response?.lastModified ?? null,
    httpStatus: response?.status ?? null,
    error: error ? String(error).slice(0, 500) : null,
    fetchedAt: new Date(deps.now()).toISOString(),
  });
}

async function hostDelay(deps, source) {
  const host = String(source.host).toLowerCase();
  if (deps.delayByHost.has(host)) return;
  deps.delayByHost.set(host, DELAY_MS);
  const robotsUrl = `https://${host}/robots.txt`;
  try {
    const response = await fetchAllowed(deps, source, robotsUrl, null);
    const seconds = parseCrawlDelaySeconds(response.text, libraryUserAgent());
    if (seconds != null && seconds * 1000 > DELAY_MS) {
      deps.delayByHost.set(host, seconds * 1000);
    }
  } catch (err) {
    remember(deps, source, robotsUrl, null, err.message || 'robots.txt failed');
  }
}

function childAllowed(source, loc) {
  if (!source.sitemapChild) return true;
  return source.sitemapChild.test(loc);
}

async function collectRecipeUrls(deps, source, state) {
  const queue = [source.sitemapUrl];
  const seen = new Set();
  const recipes = [];
  while (queue.length > 0 && state.pages < state.maxPages) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let response;
    try {
      assertAllowed(source, url);
      const prior = deps.repos.recipeLibrary.getFetch(url);
      response = await fetchAllowed(deps, source, url, prior);
    } catch (err) {
      remember(deps, source, url, null, err.message);
      continue;
    }
    state.pages += 1;
    remember(
      deps,
      source,
      url,
      response,
      response.status >= 400 ? `HTTP ${response.status}` : null
    );
    if (response.status === 304 || response.status >= 400) continue;
    const locs = extractLocs(response.text);
    if (isSitemapIndex(response.text)) {
      for (const loc of locs) {
        if (!childAllowed(source, loc)) continue;
        try {
          assertAllowed(source, loc);
          queue.push(loc);
        } catch (err) {
          remember(deps, source, loc, null, err.message);
        }
      }
      continue;
    }
    for (const loc of locs) {
      const canonical = canonicalRecipeUrl(loc);
      if (!canonical) continue;
      if (source.recipePath.test(canonical)) recipes.push(canonical);
    }
  }
  return recipes;
}

/**
 * Crawl enabled sources, or one enabled source id. A disabled source id
 * fetches nothing. One URL failure is stored and the run continues.
 * Concurrent calls return alreadyRunning instead of overlapping.
 */
async function ingestRecipeLibrary(repos, options = {}) {
  if (ingestRunning && !options.lockHeld) {
    return { alreadyRunning: true, pages: 0, fetched: 0, stored: 0, sources: [] };
  }
  const heldHere = !options.lockHeld;
  if (heldHere) ingestRunning = true;
  try {
    const picked = options.sourceId ? sourceById(options.sourceId) : null;
    if (options.sourceId && (!picked || !picked.enabled)) {
      return { pages: 0, fetched: 0, stored: 0, sources: [] };
    }
    const sources = options.sourceId ? [picked] : enabledSources();
    const deps = {
      repos,
      fetch: options.fetch || globalThis.fetch,
      sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: options.now || (() => Date.now()),
      lastByHost: new Map(),
      delayByHost: new Map(),
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
    };
    const productsMap =
      repos.products && typeof repos.products.getAllAsMap === 'function'
        ? repos.products.getAllAsMap()
        : {};
    const state = { pages: 0, maxPages: options.maxPages ?? DEFAULT_MAX_PAGES };
    let stored = 0;
    let fetched = 0;
    for (const source of sources) {
      if (state.pages >= state.maxPages) break;
      await hostDelay(deps, source);
      let urls = [];
      try {
        urls = await collectRecipeUrls(deps, source, state);
      } catch (err) {
        remember(deps, source, source.sitemapUrl, null, err.message);
        continue;
      }
      for (const url of urls) {
        if (state.pages >= state.maxPages) break;
        const prior = repos.recipeLibrary.getFetch(url);
        if (prior && prior.http_status === 200 && !prior.error && !options.refresh) continue;
        let response;
        try {
          response = await fetchAllowed(deps, source, url, prior);
        } catch (err) {
          remember(deps, source, url, null, err.message);
          fetched += 1;
          continue;
        }
        state.pages += 1;
        fetched += 1;
        if (response.status === 304) {
          remember(
            deps,
            source,
            url,
            {
              status: 304,
              etag: prior?.etag ?? response.etag,
              lastModified: prior?.last_modified ?? response.lastModified,
            },
            null
          );
          continue;
        }
        if (response.status >= 400) {
          remember(deps, source, url, response, `HTTP ${response.status}`);
          continue;
        }
        try {
          const record = libraryRecordFromHtml(
            response.text,
            response.finalUrl || url,
            source.sourceName,
            productsMap
          );
          if (!record) {
            remember(deps, source, url, response, 'no Recipe JSON-LD');
            continue;
          }
          repos.recipeLibrary.upsert({
            ...record,
            fetchedAt: new Date(deps.now()).toISOString(),
          });
          stored += 1;
          remember(deps, source, record.canonicalUrl, response, null);
        } catch (err) {
          remember(deps, source, url, response, err.message);
        }
      }
    }
    return { pages: state.pages, fetched, stored, sources: sources.map((source) => source.id) };
  } finally {
    if (heldHere || options.lockHeld) ingestRunning = false;
  }
}

module.exports = {
  ingestRecipeLibrary,
  holdIngestLock,
  releaseIngestLock,
  isIngestRunning,
  parseCrawlDelaySeconds,
  canonicalRecipeUrl,
  assertAllowed,
  USER_AGENT,
  libraryUserAgent,
  DELAY_MS,
  DEFAULT_MAX_PAGES,
  TIMEOUT_MS,
  MAX_BYTES,
};
