// Cookie parsing and serialization for node:http. No external dependencies.
//
// Used by the auth middleware to read session cookies from incoming requests
// and by the auth routes to set Set-Cookie headers on login/logout.

function parseCookies(header) {
  if (!header || typeof header !== 'string') return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const value = part.slice(eq + 1).trim();
    if (!(key in out)) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function serializeCookie(name, value, options = {}) {
  const pairs = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) pairs.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires instanceof Date) pairs.push(`Expires=${options.expires.toUTCString()}`);
  if (options.domain) pairs.push(`Domain=${options.domain}`);
  pairs.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) pairs.push('HttpOnly');
  if (options.secure) pairs.push('Secure');
  if (options.sameSite) {
    const s = String(options.sameSite).toLowerCase();
    const cased = s.charAt(0).toUpperCase() + s.slice(1);
    pairs.push(`SameSite=${cased}`);
  }
  return pairs.join('; ');
}

function appendSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, cookie]);
  } else {
    res.setHeader('Set-Cookie', [prev, cookie]);
  }
}

function clearCookie(res, name, options = {}) {
  appendSetCookie(
    res,
    serializeCookie(name, '', {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    })
  );
}

module.exports = { parseCookies, serializeCookie, appendSetCookie, clearCookie };
