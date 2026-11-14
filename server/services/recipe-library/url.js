'use strict';

// One stored form: https, lowercase host, no hash, no query, no trailing slash.
function canonicalRecipeUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.port !== '') return null;
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

module.exports = { canonicalRecipeUrl };
