'use strict';

// Enabled publishers are crawled. The rest are one `enabled: true` away.
// Sitemap URLs were read from each site's robots.txt or sitemap index.

const SOURCES = [
  {
    id: 'meny',
    sourceName: 'Meny',
    enabled: true,
    host: 'meny.no',
    sitemapUrl: 'https://meny.no/sitemap/recipes.xml',
    recipePath: /^https:\/\/meny\.no\/oppskrifter\/[^/]+\/.+/i,
  },
  {
    id: 'altasiatisk',
    sourceName: 'Alt Asiatisk',
    enabled: true,
    host: 'www.altasiatisk.no',
    sitemapUrl: 'https://www.altasiatisk.no/recipes/sitemap/0.xml',
    recipePath: /^https:\/\/www\.altasiatisk\.no\/oppskrifter\/[^/]+\/?$/i,
  },
  {
    id: 'coop',
    sourceName: 'Coop',
    enabled: true,
    host: 'www.coop.no',
    sitemapUrl: 'https://www.coop.no/api/sitemap/nb-NO/0/sitemap.xml',
    recipePath: /^https:\/\/www\.coop\.no\/oppskrifter\/.+/i,
  },
  {
    id: 'rema',
    sourceName: 'REMA 1000',
    enabled: true,
    host: 'www.rema.no',
    // REMA publishes one urlset. Only /oppskrifter/ locs are queued.
    // If that file becomes an index, follow recipe children only.
    sitemapUrl: 'https://www.rema.no/sitemap.xml',
    sitemapChild: /oppskrift/i,
    recipePath: /^https:\/\/www\.rema\.no\/oppskrifter\/.+/i,
  },
  {
    id: 'matprat',
    sourceName: 'Matprat',
    enabled: false,
    host: 'www.matprat.no',
    sitemapUrl: 'https://www.matprat.no/sitemap.xml',
    recipePath: /^https:\/\/www\.matprat\.no\/oppskrifter\/.+/i,
  },
  {
    id: 'aperitif',
    sourceName: 'Aperitif',
    enabled: false,
    host: 'www.aperitif.no',
    sitemapUrl: 'https://www.aperitif.no/sitemap.xml',
    recipePath: /^https:\/\/www\.aperitif\.no\/.+/i,
  },
  {
    id: 'godt',
    sourceName: 'Godt',
    enabled: false,
    host: 'www.godt.no',
    sitemapUrl: 'https://www.godt.no/sitemap.xml',
    recipePath: /^https:\/\/www\.godt\.no\/oppskrift/i,
  },
  {
    id: 'tine',
    sourceName: 'Tine',
    enabled: false,
    host: 'www.tine.no',
    sitemapUrl: 'https://www.tine.no/sitemap.xml',
    recipePath: /^https:\/\/www\.tine\.no\/oppskrifter\/.+/i,
  },
];

function enabledSources() {
  return SOURCES.filter((source) => source.enabled);
}

function sourceById(id) {
  return SOURCES.find((source) => source.id === id) || null;
}

module.exports = { SOURCES, enabledSources, sourceById };
