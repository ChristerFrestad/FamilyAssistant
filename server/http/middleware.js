// HTTP middleware: body parsing, CORS, request logging, ETag, gzip
// Alt er rammeverksuavhengig og fungerer med vanlig node:http.

const crypto = require('crypto');
const zlib = require('zlib');
const { config } = require('../config');
const { childWithRequestId } = require('../logger');
const { HttpError, errors } = require('./errors');

// Minimum response size (bytes) before gzip kicks in.
// Below that the overhead is larger than the gain.
const COMPRESSION_THRESHOLD = 1024;

// ============================================================
// CORS
// ============================================================

function applyCorsHeaders(res, origin) {
  if (config.ALLOWED_ORIGINS_LIST === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (
    origin &&
    origin !== 'null' &&
    !origin.includes('\n') &&
    !origin.includes('\r') &&
    config.ALLOWED_ORIGINS_LIST.includes(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function handleCorsPreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  applyCorsHeaders(res, req.headers.origin);
  res.writeHead(204);
  res.end();
  return true;
}

// ============================================================
// Body parsing
// ============================================================

function parseBody(req, { maxBytes = config.MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (contentType && !contentType.includes('application/json')) {
      return reject(errors.badRequest('Content-Type must be application/json'));
    }
    const chunks = [];
    let bytes = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        aborted = true;
        req.destroy();
        return reject(errors.payloadTooLarge(`Request body exceeds ${maxBytes} bytes`));
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(errors.badRequest('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================
// Request context + logging
// ============================================================

function acceptsGzip(req) {
  const ae = req.headers['accept-encoding'];
  return typeof ae === 'string' && /\bgzip\b/.test(ae);
}

function writeJsonWithETag(req, res, data, status) {
  if (res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(data), 'utf8');

  // Weak ETag based on sha1 of the body (before gzip).
  // Weak fordi gzip endrer bytes men ikke semantikken.
  const etag =
    'W/"' + crypto.createHash('sha1').update(payload).digest('base64').slice(0, 22) + '"';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    Vary: 'Accept-Encoding, Origin',
    'Cache-Control': 'private, max-age=0, must-revalidate',
  };

  // If-None-Match → 304 Not Modified (saves bandwidth + client render)
  const inm = req.headers['if-none-match'];
  if (status === 200 && inm && inm === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  // gzip kun for GET-lignende responser over terskel
  if (status === 200 && payload.length >= COMPRESSION_THRESHOLD && acceptsGzip(req)) {
    try {
      const gz = zlib.gzipSync(payload);
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = String(gz.length);
      res.writeHead(status, headers);
      res.end(gz);
      return;
    } catch (gzErr) {
      // Fall tilbake til ukomprimert ved minne-press
      const log = childWithRequestId(req);
      log.debug({ err: gzErr.message }, 'gzip feilet, sender ukomprimert');
    }
  }

  headers['Content-Length'] = String(payload.length);
  res.writeHead(status, headers);
  res.end(payload);
}

function createContext(req, res, pathname, query) {
  const requestId = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  // Uke 6 (OBS-3): session_corr lar oss spore en "bruker-intensjon"
  // through logs across multiple requests. The client can send the same
  // X-Session-Correlation-Id over e.g. the entire "add item + buy" flow
  // so log analysis can find all requests that belonged to the operation.
  // Fallback: samme verdi som requestId (= én operasjon == én request).
  const sessionCorr = req.headers['x-session-correlation-id'] || requestId;
  // user_hint er en valgfri label (ikke identitet!) som klienten kan sette
  // to mark which family member performed the action. Validated
  // against ^[a-zA-Z0-9_-]{1,32}$ to avoid log injection.
  const userHintRaw = req.headers['x-user-hint'] || '';
  const userHint = /^[a-zA-Z0-9_-]{1,32}$/.test(userHintRaw) ? userHintRaw : null;

  const log = childWithRequestId(requestId).child({
    sessionCorr,
    ...(userHint ? { userHint } : {}),
  });
  res.setHeader('X-Request-ID', requestId);
  // Ekko session_corr slik at klienten kan bekrefte sporing
  if (req.headers['x-session-correlation-id']) {
    res.setHeader('X-Session-Correlation-Id', sessionCorr);
  }

  return {
    req,
    res,
    params: {},
    query,
    body: null,
    pathname,
    log,
    requestId,
    sessionCorr,
    userHint,
    state: {},
    json(data, status = 200) {
      writeJsonWithETag(req, res, data, status);
    },
    problem(err) {
      if (res.writableEnded) return;
      const problem =
        err instanceof HttpError
          ? err.toProblem(pathname)
          : {
              type: 'about:blank',
              title: 'Internal Server Error',
              status: 500,
              detail: 'Uventet feil',
              instance: pathname,
            };
      // M4.1: always include request-id in the problem body so the client can
      // vise den som feilkode, og operator kan grep'e journald direkte.
      problem.requestId = requestId;
      const payload = Buffer.from(JSON.stringify(problem), 'utf8');
      res.writeHead(problem.status, {
        'Content-Type': 'application/problem+json; charset=utf-8',
        'Content-Length': String(payload.length),
        Vary: 'Accept-Encoding, Origin',
      });
      res.end(payload);
    },
  };
}

// ============================================================
// Query parser
// ============================================================

function parseQuery(url) {
  const obj = {};
  for (const [k, v] of url.searchParams.entries()) {
    obj[k] = v;
  }
  return obj;
}

module.exports = {
  applyCorsHeaders,
  handleCorsPreflight,
  parseBody,
  createContext,
  parseQuery,
};
