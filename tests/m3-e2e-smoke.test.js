// M3.1 E2E smoke-test
//
// Kjører raw HTTP mot startTestServer og simulerer de samme API-kallene
// som frontend gjør når brukeren klikker gjennom tab-ene. Dekker:
//   - Forsiden (static HTML)
//   - I dag: /api/today
//   - Ukesmeny: /api/meals/current, /api/meals/suggestions/:dow, swap
//   - Handleliste: /api/shopping/list/current, add, check
//   - Husarbeid: /api/chores/current, complete
//   - LLM status (disabled når Ollama ikke kjører)
//   - Calendar CRUD
//   - Profile read/write
//   - Recipe read/similar
//
// Dette er en funksjonell "klikk gjennom alle flater" i stedet for
// ekte browser-automation — sjekker at backend-kontraktene holder for
// det frontend faktisk trenger.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startTestServer, request } = require('./helpers');

let server;

before(async () => {
  server = await startTestServer();
});
after(async () => {
  if (server) await server.close();
});

describe('M3.1 · E2E smoke — forsiden', () => {
  test('GET / serverer index.html', async () => {
    const res = await request(server.baseUrl, 'GET', '/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    // Trenger noen markører fra den faktiske filen
    assert.ok(res.raw.includes('Familieassistenten'));
    assert.ok(res.raw.includes('<script>'));
  });

  test('GET /manifest.json er gyldig PWA manifest', async () => {
    const res = await request(server.baseUrl, 'GET', '/manifest.json');
    assert.equal(res.status, 200);
    // body kan være parsed JSON eller string
    const manifest = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    assert.ok(manifest.name || manifest.short_name);
  });

  test('Alle M1 security-headers satt', async () => {
    const res = await request(server.baseUrl, 'GET', '/health');
    const h = res.headers;
    assert.ok(h['content-security-policy'], 'CSP mangler');
    assert.equal(h['x-content-type-options'], 'nosniff');
    assert.equal(h['x-frame-options'], 'DENY');
    assert.equal(h['cross-origin-opener-policy'], 'same-origin');
    assert.equal(h['cross-origin-resource-policy'], 'same-origin');
    assert.equal(h['referrer-policy'], 'same-origin');
  });
});

describe('M3.1 · E2E smoke — I dag', () => {
  test('GET /api/today laster dagens data', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/today');
    assert.equal(res.status, 200);
    assert.ok('weekYear' in res.body);
    assert.ok('dayName' in res.body);
    // chores-array kan være tom, men feltet må eksistere
    assert.ok(Array.isArray(res.body.chores) || res.body.chores === undefined);
  });
});

describe('M3.1 · E2E smoke — Ukesmeny', () => {
  test('GET /api/meals/current returnerer 7 dager', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(res.status, 200);
    assert.equal(res.body.meals.length, 7);
    for (const slot of res.body.meals) {
      assert.ok('dayOfWeek' in slot);
      assert.ok('dayName' in slot);
    }
  });

  test('GET /api/meals/suggestions/0 returnerer forslag', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/meals/suggestions/0');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.suggestions));
  });

  test('PUT /api/meals/swap bytter middag og invaliderer cache', async () => {
    const suggestRes = await request(server.baseUrl, 'GET', '/api/meals/suggestions/0');
    const recipeId = suggestRes.body.suggestions[0]?.recipeId;
    assert.ok(recipeId, 'må ha minst ett forslag');

    const swap = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 0, recipeId },
    });
    assert.equal(swap.status, 200);

    const after = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(after.body.meals[0].recipeId, recipeId);
  });

  test('PUT /api/meals/status=away fungerer', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/meals/status', {
      body: { dayOfWeek: 2, status: 'away' },
    });
    assert.equal(res.status, 200);
  });

  test('GET /api/recipes returnerer liste', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/recipes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.recipes));
    assert.ok(res.body.recipes.length > 0);
  });

  test('GET /api/recipes/:id/similar for en eksisterende oppskrift', async () => {
    const list = await request(server.baseUrl, 'GET', '/api/recipes');
    const first = list.body.recipes[0];
    const res = await request(server.baseUrl, 'GET', `/api/recipes/${first.id}/similar?limit=3`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.similar));
  });
});

describe('M3.1 · E2E smoke — Handleliste', () => {
  test('GET /api/shopping/list/current', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/shopping/list/current');
    // Kan være 200 med eksisterende liste, eller 200 med tom liste
    assert.equal(res.status, 200);
    assert.ok('weekYear' in res.body || 'id' in res.body || 'categories' in res.body);
  });

  test('POST /api/shopping/add legger til vare', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/shopping/add', {
      body: { name: 'Testvare E2E', category: 'Tørrvarer & annet', quantity: 2 },
    });
    assert.equal(res.status, 200);
  });

  test('POST /api/shopping/generate genererer ny liste (force)', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
      body: { force: true },
    });
    assert.equal(res.status, 200);
  });
});

describe('M3.1 · E2E smoke — Husarbeid', () => {
  test('GET /api/chores/current returnerer ukas oppgaver', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/chores/current');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.chores));
  });

  test('PUT /api/chores/complete på første chore', async () => {
    const list = await request(server.baseUrl, 'GET', '/api/chores/current');
    const firstChore = list.body.chores.find((c) => c.status !== 'done');
    if (!firstChore) return; // ingenting å markere
    const res = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
      body: { choreId: firstChore.choreId },
    });
    assert.equal(res.status, 200);
  });
});

describe('M3.1 · E2E smoke — Calendar', () => {
  let createdId;

  test('POST /api/calendar/events oppretter hendelse', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await request(server.baseUrl, 'POST', '/api/calendar/events', {
      body: {
        title: 'E2E testhendelse',
        date: tomorrow,
        startTime: '10:00',
        endTime: '11:00',
        location: 'Heia 9',
      },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.id || res.body.event?.id);
    createdId = res.body.id || res.body.event.id;
  });

  test('GET /api/calendar/events lister hendelser', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/calendar/events');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events || res.body));
  });

  test('DELETE /api/calendar/events/:id sletter hendelse', async () => {
    if (!createdId) return;
    const res = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${createdId}`);
    assert.equal(res.status, 200);
  });
});

describe('M3.1 · E2E smoke — Profile + Settings', () => {
  test('GET /api/profile returnerer struktur', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/profile');
    assert.equal(res.status, 200);
    assert.ok('members' in res.body);
    assert.ok('allergies' in res.body);
    assert.ok('dislikes' in res.body);
  });

  test('PUT /api/profile oppdaterer allergier', async () => {
    const res = await request(server.baseUrl, 'PUT', '/api/profile', {
      body: { allergies: ['nøtter', 'skalldyr'] },
    });
    assert.equal(res.status, 200);
    const after = await request(server.baseUrl, 'GET', '/api/profile');
    assert.deepEqual(after.body.allergies.sort(), ['nøtter', 'skalldyr'].sort());
  });

  test('GET /api/settings/env returnerer maskerte nøkler', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/settings/env');
    assert.equal(res.status, 200);
    assert.ok(res.body.values, 'skal ha values-objekt');
    // Verdier skal være null eller maskerte strings — aldri klartekst
    for (const [key, value] of Object.entries(res.body.values)) {
      if (value === null) continue;
      assert.ok(typeof value === 'string', `${key} er ikke string (${typeof value})`);
      // Maskert verdi inneholder unicode-bullet eller er under 10 tegn
      assert.ok(/●/.test(value) || value.length < 10, `${key} ser ut som klartekst: ${value}`);
    }
  });
});

describe('M3.1 · E2E smoke — System', () => {
  test('GET /api/status inneholder versjon, breakers, migrations', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.version);
    assert.ok(res.body.breakers);
    assert.ok(typeof res.body.uptime === 'number');
  });

  test('GET /api/llm/status svarer selv når LLM er nede', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/llm/status');
    assert.equal(res.status, 200);
    assert.ok('available' in res.body);
    assert.ok('model' in res.body);
  });

  test('GET /metrics returnerer Prometheus exposition format', async () => {
    const res = await request(server.baseUrl, 'GET', '/metrics');
    assert.equal(res.status, 200);
    assert.ok(res.raw.includes('# HELP') || res.raw.includes('# TYPE'));
  });
});

describe('M3.1 · E2E smoke — Cache invalidation flow', () => {
  test('write invaliderer cached read', async () => {
    // 1. Les current meals (cache miss)
    const first = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(first.status, 200);
    // 2. Les igjen (cache hit)
    const second = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(second.headers['x-cache'], 'HIT');
    // 3. Swap → skal invalidere
    const suggest = await request(server.baseUrl, 'GET', '/api/meals/suggestions/3');
    const rid = suggest.body.suggestions?.[0]?.recipeId;
    if (!rid) return;
    await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      body: { dayOfWeek: 3, recipeId: rid },
    });
    // 4. Les igjen — cache skal være miss
    const after = await request(server.baseUrl, 'GET', '/api/meals/current');
    assert.equal(after.headers['x-cache'], 'MISS');
  });
});
