// Normalize the incoming request-target so sloppy clients still hit `/`.
//
// Conformant browsers turn https://example.com into GET /. Some
// Messenger / Facebook in-app browsers send the bare host, an
// absolute-form URL without a path, or `/example.com` instead.
// Those must not 404 or fall through to the SPA.

'use strict';

function hostName(hostHeader) {
  if (!hostHeader) return '';
  return String(hostHeader).split(':')[0].trim().toLowerCase();
}

function looksLikeThisHost(value, host) {
  if (!host || !value) return false;
  const v = String(value).replace(/\/+$/, '').toLowerCase();
  return v === host || v === `www.${host}` || host === `www.${v}`;
}

function normalizeIncomingUrl(reqUrl, hostHeader) {
  const host = hostName(hostHeader);
  const fallbackOrigin = `http://${hostHeader || 'localhost'}`;
  let raw = reqUrl == null || reqUrl === '' ? '/' : String(reqUrl);

  try {
    if (/^https?:\/\//i.test(raw)) {
      const abs = new URL(raw);
      if (looksLikeThisHost(abs.hostname, host) && (abs.pathname === '/' || abs.pathname === '')) {
        return new URL(`/${abs.search}${abs.hash}`, fallbackOrigin);
      }
      if (looksLikeThisHost(abs.hostname, host)) {
        return new URL(`${abs.pathname || '/'}${abs.search}${abs.hash}`, fallbackOrigin);
      }
    }
  } catch {
    /* fall through */
  }

  const [pathPart, ...queryParts] = raw.split('?');
  const search = queryParts.length ? `?${queryParts.join('?')}` : '';
  const pathOnly = pathPart.split('#')[0];

  if (looksLikeThisHost(pathOnly, host) || looksLikeThisHost(pathOnly.replace(/^\//, ''), host)) {
    return new URL(`/${search}`, fallbackOrigin);
  }

  if (!raw.startsWith('/')) raw = `/${raw}`;
  return new URL(raw, fallbackOrigin);
}

module.exports = { normalizeIncomingUrl, hostName };
