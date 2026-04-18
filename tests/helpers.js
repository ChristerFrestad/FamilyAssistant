// Test-helper: starter en minimal Familieassistenten-server mot en isolert DB.
// Brukes av integrasjonstester for å unngå å importere server/index.js
// (som har cron/backup side effects ved require).
//
// Hver test får sin egen DB i OS-tempmappen. Teardown sletter filen.

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

function freshDbPath() {
  const name = `fam-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`;
  return path.join(os.tmpdir(), name);
}

/**
 * Starter en test-server på tilfeldig ledig port og returnerer
 * { baseUrl, close, repos, serverState }.
 *
 * Må kalles etter at DB_PATH er satt i process.env (eller den settes her).
 */
async function startTestServer({ dbPath, authToken } = {}) {
  // Isolert DB
  process.env.DB_PATH = dbPath || freshDbPath();
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.LOG_PRETTY = 'false';
  if (authToken) process.env.AUTH_TOKEN = authToken;
  else delete process.env.AUTH_TOKEN;

  // VIKTIG: require moduler ETTER at env er satt, slik at config.js og db.js
  // plukker opp riktig konfig. Og clear modul-cache slik at neste test får ny DB.
  for (const key of Object.keys(require.cache)) {
    // Keep the family-context module so that test code calling runWithFamily
    // shares the AsyncLocalStorage instance with the repos loaded here.
    if (key.includes(path.join('server', 'auth', 'family-context'))) continue;
    if (key.includes('server/auth/family-context')) continue;
    if (key.includes(path.join('server', '')) || key.includes('server/')) {
      delete require.cache[key];
    }
  }

  const { initDB, closeDB } = require('../server/db');
  const { createRepositories } = require('../server/repositories');
  const { seedIfEmpty, ensureCurrentWeek } = require('../server/services/seed.service');
  const { createRouter } = require('../server/http/router');
  const { createServer } = require('../server/http/server');
  const { registerRoutes } = require('../server/routes');
  const { createAuthenticate } = require('../server/auth/middleware');
  const metrics = require('../server/http/metrics');

  metrics.reset();

  const dbHandle = await initDB();
  const repos = createRepositories(dbHandle.db);
  seedIfEmpty(repos);
  ensureCurrentWeek(repos);

  const serverState = {
    startedAt: Date.now(),
    ready: true,
    driver: dbHandle.driver,
  };

  const router = createRouter();
  registerRoutes(router, { repos, serverState });
  const authenticate = createAuthenticate(repos);
  const server = createServer(router, { authenticate });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  async function close() {
    await new Promise((resolve) => server.close(() => resolve()));
    closeDB(dbHandle);
    try {
      fs.unlinkSync(process.env.DB_PATH);
    } catch {
      /* ignore */
    }
  }

  return { baseUrl, close, repos, serverState, dbPath: process.env.DB_PATH };
}

/**
 * Minimal HTTP-klient for tester. Auto-gunzip og auto-JSON-parse.
 * Returnerer { status, headers, body (parsed JSON eller string) }.
 */
function request(baseUrl, method, path, { headers = {}, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const h = { ...headers };
    if (body && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = `Bearer ${token}`;

    // Pre-serialize body and set Content-Length so DELETE (and others)
    // reliably transmit the body. Node's http client will silently drop
    // the body on DELETE requests that have neither Content-Length nor
    // Transfer-Encoding: chunked.
    let bodyBuf = null;
    if (body != null) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      bodyBuf = Buffer.from(bodyStr, 'utf8');
      if (!h['Content-Length']) h['Content-Length'] = String(bodyBuf.length);
    }

    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: h,
      },
      (res) => {
        clearTimeout(timeout);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          if (res.headers['content-encoding'] === 'gzip' && buf.length > 0) {
            try {
              buf = zlib.gunzipSync(buf);
            } catch {
              /* leave as-is */
            }
          }
          const text = buf.toString('utf8');
          let parsed = text;
          const ct = res.headers['content-type'] || '';
          if (ct.includes('json') && text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              /* keep as text */
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: text });
        });
      }
    );
    const timeout = setTimeout(() => {
      req.destroy(new Error('Request timed out after 10000ms'));
    }, 10_000);
    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    if (bodyBuf) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

module.exports = { startTestServer, request, freshDbPath };
