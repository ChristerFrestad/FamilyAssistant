'use strict';

// Minimal CalDAV client for iCloud (discover + REPORT + PUT + DELETE).
// HTTP is injectable so tests never talk to Apple.

const { parseVEvents } = require('./ics');

const DEFAULT_DISCOVERY_URL = 'https://caldav.icloud.com/';

const PRINCIPAL_PROPFIND = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:current-user-principal/>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>`;

const CALENDAR_PROPFIND = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`;

const CALENDAR_QUERY = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

async function defaultHttp(url, options = {}) {
  const res = await fetch(url, options);
  const headers = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const body = await res.text().catch(() => '');
  return { status: res.status, headers, body, url: res.url || url };
}

function xmlUnescape(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function firstXmlTag(xml, localName) {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${localName}>`, 'i');
  const m = re.exec(xml || '');
  return m ? xmlUnescape(m[1].trim()) : null;
}

function allHref(xml) {
  const re = /<(?:[A-Za-z0-9]+:)?href[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?href>/gi;
  const out = [];
  let m;
  while ((m = re.exec(xml || ''))) {
    out.push(xmlUnescape(m[1].trim()));
  }
  return out;
}

function resolveUrl(base, href) {
  if (!href) return base;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function parseReportResponses(xml, baseUrl) {
  const chunks = String(xml || '').split(/<(?:[A-Za-z0-9]+:)?response[\s>]/i).slice(1);
  const items = [];
  for (const chunk of chunks) {
    const href = firstXmlTag(`<x>${chunk}`, 'href');
    const etag = firstXmlTag(chunk, 'getetag');
    const ics = firstXmlTag(chunk, 'calendar-data');
    if (!ics) continue;
    items.push({
      href: resolveUrl(baseUrl, href),
      etag: etag || null,
      ics,
      events: parseVEvents(ics),
    });
  }
  return items;
}

function createCalDavClient({ http, email, password, discoveryUrl } = {}) {
  const request = http || defaultHttp;
  const authHeader =
    email && password ? `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` : null;

  async function call(method, url, { headers = {}, body } = {}) {
    return request(url, {
      method,
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        ...headers,
      },
      body,
    });
  }

  async function discover() {
    const start = discoveryUrl || DEFAULT_DISCOVERY_URL;
    const wellKnown = start.endsWith('/')
      ? `${start}.well-known/caldav`
      : `${start}/.well-known/caldav`;
    const first = await call('PROPFIND', wellKnown, {
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PRINCIPAL_PROPFIND,
    });
    const base = first.url || start;
    const home =
      firstXmlTag(first.body, 'calendar-home-set') ||
      firstXmlTag(first.body, 'href') ||
      firstXmlTag(first.body, 'current-user-principal');
    const homeUrl = resolveUrl(base, allHref(home || first.body)[0] || home || base);
    const listing = await call('PROPFIND', homeUrl, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: CALENDAR_PROPFIND,
    });
    const hrefs = allHref(listing.body);
    const calendarHref = hrefs.find((h) => h && h !== homeUrl) || homeUrl;
    return {
      href: resolveUrl(homeUrl, calendarHref),
      displayName: firstXmlTag(listing.body, 'displayname'),
    };
  }

  async function report(calendarUrl) {
    const res = await call('REPORT', calendarUrl, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: CALENDAR_QUERY,
    });
    if (res.status >= 400) {
      throw new Error(`CalDAV REPORT failed (${res.status})`);
    }
    return parseReportResponses(res.body, calendarUrl);
  }

  async function put(href, ics, etag) {
    const headers = {
      'Content-Type': 'text/calendar; charset=utf-8',
    };
    if (etag) headers['If-Match'] = etag;
    const res = await call('PUT', href, { headers, body: ics });
    if (res.status >= 400) {
      throw new Error(`CalDAV PUT failed (${res.status})`);
    }
    return { status: res.status, etag: res.headers.etag || res.headers['etag'] || null };
  }

  async function deleteEvent(href, etag) {
    const headers = {};
    if (etag) headers['If-Match'] = etag;
    const res = await call('DELETE', href, { headers });
    if (res.status >= 400 && res.status !== 404) {
      throw new Error(`CalDAV DELETE failed (${res.status})`);
    }
    return { status: res.status };
  }

  return { discover, report, put, delete: deleteEvent };
}

module.exports = {
  createCalDavClient,
  parseReportResponses,
  DEFAULT_DISCOVERY_URL,
};
