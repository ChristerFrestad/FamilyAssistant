// M3.2 OpenAPI contract-test
//
// Verifiserer at openapi.yaml stemmer overens med faktiske ruter:
//
//   1. Parser openapi.yaml (minimal YAML-reader — null avhengigheter)
//   2. Ekstraherer alle registrerte ruter fra routes.js via en ekte
//      router-instans (mock av handlers) for å få full rute-liste
//   3. Sjekker:
//      - Alle dokumenterte ruter finnes i koden
//      - Alle kritiske ruter i koden er dokumentert (soft warning for resten)
//      - HTTP-statuskoder i dokumentasjonen matcher de faktiske svarene
//        for et utvalg kritiske endepunkter
//      - Response-shape (top-level felter) stemmer mot dokumenterte schemas
//        for de viktigste rutene
//
// Dette er en "walking" contract test — ikke full schema-validering med
// ajv, men nok til å fange divergens mellom dokumentasjon og kode.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, request } = require('./helpers');

// ============================================================
// Minimal YAML parser — kun for openapi.yaml (paths-seksjonen)
// ============================================================
//
// OpenAPI har en kjent, avgrenset struktur. Vi trenger bare å hente
// listen over paths + metodene som er dokumentert + statuskoder.
// Full YAML-parsing er overkill — regex-basert uttrekking er mer enn nok
// for vår kontroll-bruk.

function extractDocumentedRoutes(yamlText) {
  const routes = [];
  const lines = yamlText.split('\n');
  let inPaths = false;
  let currentPath = null;
  let currentMethod = null;
  let currentResponses = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const raw = line.replace(/\t/g, '  ');

    if (/^paths:\s*$/.test(raw)) { inPaths = true; continue; }
    if (!inPaths) continue;

    // Top-level section exit: ny seksjon på kolonne 0 som ikke starter med "/"
    if (/^[a-zA-Z]/.test(raw) && !raw.startsWith(' ')) {
      inPaths = false;
      continue;
    }

    // Path-nivå (2 space indent, starter med /)
    const pathMatch = /^  (\/[^:\s]+):\s*$/.exec(raw);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }

    // Method-nivå (4 space indent)
    const methodMatch = /^    (get|post|put|delete|patch):\s*$/i.exec(raw);
    if (methodMatch && currentPath) {
      currentMethod = methodMatch[1].toUpperCase();
      currentResponses = [];
      routes.push({
        method: currentMethod,
        path: currentPath,
        responses: currentResponses,
      });
      continue;
    }

    // Status code (8 space indent under "responses:")
    // Matcher både:
    //   '200':                              (multi-linje form)
    //   '200': { description: Added }       (inline form)
    //   '200': { $ref: "..." }               (inline ref)
    const statusMatch = /^        ['"]?(\d{3})['"]?:/.exec(raw);
    if (statusMatch && currentResponses) {
      currentResponses.push(statusMatch[1]);
    }
  }

  return routes;
}

// ============================================================
// Runtime route discovery via en ekte router + mock av repos
// ============================================================

function collectRuntimeRoutes() {
  // Lazy-require slik at startTestServer får satt NODE_ENV først
  const { createRouter } = require('../server/http/router');
  const { registerRoutes } = require('../server/routes');

  // Fake repos med nok stubs til at routes.js ikke kaster ved registrering.
  // registerRoutes kaller ikke repos — det gjør handlerne — så en plain
  // stub holder.
  const repos = new Proxy({}, {
    get: () => new Proxy({}, { get: () => () => null }),
  });
  const serverState = { ready: true, driver: 'sql.js', startedAt: Date.now() };

  const router = createRouter();
  registerRoutes(router, { repos, serverState });
  return router.routes.map(r => ({
    method: r.method,
    path: r.path,
  }));
}

function normalizePath(p) {
  // OpenAPI: /api/recipes/{id}  →  koden: /api/recipes/:id
  return p.replace(/\{([^}]+)\}/g, ':$1');
}

// ============================================================
// Tester
// ============================================================

describe('M3.2 · OpenAPI contract — paths', () => {
  const yamlPath = path.join(__dirname, '..', 'openapi.yaml');
  const yaml = fs.readFileSync(yamlPath, 'utf8');
  const docRoutes = extractDocumentedRoutes(yaml);
  const codeRoutes = collectRuntimeRoutes();
  const codeKeys = new Set(codeRoutes.map(r => `${r.method} ${r.path}`));
  const docKeys = new Set(docRoutes.map(r => `${r.method} ${normalizePath(r.path)}`));

  test('openapi.yaml parses til minst 15 ruter', () => {
    assert.ok(docRoutes.length >= 15, `fant ${docRoutes.length} dokumenterte ruter`);
  });

  test('routes.js registrerer minst 70 ruter', () => {
    assert.ok(codeRoutes.length >= 70, `fant ${codeRoutes.length} kode-ruter`);
  });

  test('Alle dokumenterte ruter finnes i koden', () => {
    const missing = [];
    for (const docRoute of docRoutes) {
      const normalized = `${docRoute.method} ${normalizePath(docRoute.path)}`;
      if (!codeKeys.has(normalized)) {
        missing.push(normalized);
      }
    }
    assert.deepEqual(missing, [], `Dokumenterte ruter mangler i koden:\n${missing.join('\n')}`);
  });

  test('Kritiske kode-ruter er dokumentert i openapi.yaml', () => {
    const critical = [
      'GET /health',
      'GET /ready',
      'GET /metrics',
      'GET /api/today',
      'GET /api/meals/current',
      'PUT /api/meals/swap',
      'PUT /api/meals/status',
      'GET /api/recipes',
      'GET /api/chores/current',
      'GET /api/calendar/events',
      'POST /api/calendar/events',
      'GET /api/llm/status',
      'POST /api/llm/chat',
    ];
    const missing = critical.filter(c => !docKeys.has(c));
    assert.deepEqual(missing, [], `Kritiske ruter mangler dokumentasjon:\n${missing.join('\n')}`);
  });

  test('Alle dokumenterte ruter erklærer minst én response-status', () => {
    const silent = docRoutes.filter(r => r.responses.length === 0);
    assert.deepEqual(silent, [], `Ruter uten responses:\n${JSON.stringify(silent, null, 2)}`);
  });
});

// ============================================================
// Live response-format-sjekk
// ============================================================
describe('M3.2 · OpenAPI contract — live response shapes', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.close(); });

  test('GET /health returnerer dokumentert Health-shape', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    assert.equal(res.status, 200);
    // Dokumentert: status, uptimeSec, pid, memMB
    assert.equal(typeof res.body.status, 'string');
    assert.equal(typeof res.body.uptimeSec, 'number');
    assert.equal(typeof res.body.pid, 'number');
    assert.equal(typeof res.body.memMB, 'number');
  });

  test('GET /ready returnerer dokumentert Ready-shape', async () => {
    const res = await request(server.baseUrl, 'GET', '/ready');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.ready, 'boolean');
    assert.ok(['better-sqlite3', 'sql.js', 'none'].includes(res.body.driver));
    assert.equal(typeof res.body.kbEntries, 'number');
    assert.equal(typeof res.body.fts5, 'boolean');
  });

  test('GET /api/meals/current returnerer MealsResponse-shape', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.weekYear, 'string');
    assert.ok(/^\d{4}-W\d{2}$/.test(res.body.weekYear));
    assert.ok(Array.isArray(res.body.meals));
    assert.equal(res.body.meals.length, 7);
    for (const slot of res.body.meals) {
      assert.equal(typeof slot.dayOfWeek, 'number');
      assert.ok(slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6);
      assert.equal(typeof slot.dayName, 'string');
    }
  });

  test('GET /api/recipes returnerer Recipe[]-shape', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/recipes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.recipes));
    const first = res.body.recipes[0];
    assert.equal(typeof first.id, 'number');
    assert.equal(typeof first.name, 'string');
    assert.ok(['rask', 'comfort', 'helg'].includes(first.category));
  });

  test('POST /api/meals/swap med 400 svarer med Problem-shape', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 'not-a-number' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.headers['content-type']?.includes('problem+json'));
    assert.ok(res.body.title || res.body.detail);
    assert.equal(res.body.status, 400);
  });

  test('404 for ukjent rute gir Problem-shape', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.ok(res.headers['content-type']?.includes('problem+json'));
    assert.equal(res.body.status, 404);
  });

  test('GET /metrics returnerer text/plain Prometheus format', async () => {
    const res = await request(server.baseUrl, 'GET', '/metrics');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/plain'));
  });
});
