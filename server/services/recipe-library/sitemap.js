'use strict';

function decodeXml(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractLocs(xml) {
  const locs = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    locs.push(decodeXml(match[1].trim()));
  }
  return locs;
}

function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml);
}

module.exports = { extractLocs, isSitemapIndex, decodeXml };
