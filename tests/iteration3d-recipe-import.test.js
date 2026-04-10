// Tester for iterasjon 3b fase D: recipe import via tekst + bilde-OCR.
//
// Dekker:
//   - Service: importFromText happy path (mock LLM returnerer ferdig JSON)
//   - Service: importFromText med engelsk tekst → normalizer oversetter ingr.
//   - Service: kategori utenfor CHECK-constraint faller tilbake til 'rask'
//   - Service: for kort tekst → error
//   - Service: LLM-parse feil → error
//   - Service: importFromImage med fake OCR-adapter → importFromText kjøres
//   - Service: importFromImage med tom OCR-tekst → error
//   - Route: POST /api/recipes/import (JSON) happy path
//   - Route: POST /api/recipes/import valideringsfeil (400)
//   - Route: POST /api/recipes/import/image base64 happy path

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, request } = require('./helpers');

function setupLlmMock(responseObj) {
  const llm = require('../server/llm');
  const originalChat = llm.llmChat;
  llm.llmChat = async () => ({
    type: 'text',
    content: JSON.stringify(responseObj),
  });
  return () => { llm.llmChat = originalChat; };
}

function setupLlmRaw(rawString) {
  const llm = require('../server/llm');
  const originalChat = llm.llmChat;
  llm.llmChat = async () => ({ type: 'text', content: rawString });
  return () => { llm.llmChat = originalChat; };
}

// ============================================================
// Service: importFromText
// ============================================================

describe('recipe-import: importFromText', () => {
  let server;
  let importService;

  before(async () => {
    server = await startTestServer();
    importService = require('../server/services/recipe-import.service');
  });
  after(async () => { if (server) await server.close(); });

  test('norsk tekst + mock LLM → recipe lagret med ingredienser', async () => {
    const restore = setupLlmMock({
      name: 'Spagetti Bolognese',
      category: 'comfort',
      prepTimeMin: 35,
      servings: 4,
      ingredients: [
        { name: 'kjøttdeig', qty: 400, unit: 'g' },
        { name: 'løk', qty: 1, unit: 'stk' },
        { name: 'hvitløk', qty: 2, unit: 'stk' },
        { name: 'spagetti', qty: 300, unit: 'g' },
      ],
      steps: ['Stek løk og hvitløk', 'Tilsett kjøttdeig', 'Kok spagetti'],
    });

    try {
      const r = await importService.importFromText(server.repos, {
        text: 'Lag en skikkelig bolognese med kjøttdeig og løk. Kok spagetti i 10 minutter.',
        title: 'Bolognese',
      });

      assert.ok(r.recipeId, 'skal ha recipeId');
      assert.equal(r.recipe.name, 'Spagetti Bolognese');
      assert.equal(r.recipe.category, 'comfort');
      assert.equal(r.recipe.servings, 4);
      assert.equal(r.recipe.ingredients.length, 4);
      const names = r.recipe.ingredients.map(i => i.name);
      assert.ok(names.includes('kjøttdeig'));
      assert.ok(names.includes('løk'));
    } finally {
      restore();
    }
  });

  test('engelsk input → normalizer oversetter ingredienser', async () => {
    const restore = setupLlmMock({
      name: 'Chicken Stir Fry',
      category: 'rask',
      prepTimeMin: 20,
      servings: 2,
      ingredients: [
        // Simulerer en LLM som *ikke* har oversatt — normalizer skal ta det
        { name: 'chicken breast', qty: 300, unit: 'g' },
        { name: 'soy sauce', qty: 30, unit: 'ml' },
      ],
      steps: ['Steg 1', 'Steg 2'],
    });

    try {
      const r = await importService.importFromText(server.repos, {
        text: 'Quick chicken stir fry with soy sauce and garlic. Cook 15 minutes.',
      });

      assert.ok(r.recipeId);
      const names = r.recipe.ingredients.map(i => i.name);
      assert.ok(names.includes('kyllingfilet'), `forventet kyllingfilet, fikk ${JSON.stringify(names)}`);
      assert.ok(names.includes('soyasaus'), `forventet soyasaus, fikk ${JSON.stringify(names)}`);
    } finally {
      restore();
    }
  });

  test('ugyldig kategori fra LLM faller tilbake til "rask"', async () => {
    const restore = setupLlmMock({
      name: 'Testrett',
      category: 'fastfood',
      prepTimeMin: 15,
      servings: 2,
      ingredients: [{ name: 'ris', qty: 200, unit: 'g' }],
      steps: ['Kok ris'],
    });

    try {
      const r = await importService.importFromText(server.repos, {
        text: 'En enkel rett. Kok risen. Server varm på tallerken.',
      });
      assert.ok(r.recipeId);
      assert.equal(r.recipe.category, 'rask');
    } finally {
      restore();
    }
  });

  test('for kort tekst → error', async () => {
    const r = await require('../server/services/recipe-import.service')
      .importFromText(server.repos, { text: 'kort' });
    assert.ok(r.error);
    assert.ok(r.error.includes('for kort'));
  });

  test('LLM returnerer ikke-JSON → error', async () => {
    const restore = setupLlmRaw('Beklager, jeg kan ikke parse denne oppskriften.');
    try {
      const r = await require('../server/services/recipe-import.service')
        .importFromText(server.repos, {
          text: 'En oppskrift på noe som helst med flere ord for å passere lengden.',
        });
      assert.ok(r.error);
    } finally {
      restore();
    }
  });

  test('LLM returnerer ingen ingredienser → error', async () => {
    const restore = setupLlmMock({
      name: 'Tom rett',
      category: 'rask',
      ingredients: [],
      steps: [],
    });
    try {
      const r = await require('../server/services/recipe-import.service')
        .importFromText(server.repos, {
          text: 'En oppskrift på noe som helst med flere ord for å passere lengden.',
        });
      assert.ok(r.error);
      assert.ok(r.error.includes('ingredienser'));
    } finally {
      restore();
    }
  });
});

// ============================================================
// Service: importFromImage (fake OCR-adapter)
// ============================================================

describe('recipe-import: importFromImage', () => {
  let server;
  let importService;
  before(async () => {
    server = await startTestServer();
    importService = require('../server/services/recipe-import.service');
  });
  after(async () => { if (server) await server.close(); });

  test('fake OCR-adapter → tekst → LLM → recipe lagret', async () => {
    const restore = setupLlmMock({
      name: 'OCR-rett',
      category: 'helg',
      prepTimeMin: 60,
      servings: 4,
      ingredients: [{ name: 'laks', qty: 800, unit: 'g' }],
      steps: ['Steik laksen'],
    });

    // 1-byte "bilde" — vi bruker fake adapter, så innholdet er uinteressant,
    // men vi trenger minst 1 byte for å passe buffer-validering.
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const fakeOcr = async () => ({
      text: 'Laks i ovn med sitron og dill. Steik ved 180 grader i 25 minutter.',
      engine: 'fake',
    });

    try {
      const r = await importService.importFromImage(server.repos, {
        buffer: fakeImage,
        mime: 'image/jpeg',
        ocrAdapter: fakeOcr,
      });
      assert.ok(r.recipeId, `forventet recipeId, fikk ${JSON.stringify(r)}`);
      assert.equal(r.recipe.name, 'OCR-rett');
      assert.equal(r.recipe.category, 'helg');
    } finally {
      restore();
    }
  });

  test('fake OCR returnerer tom tekst → error', async () => {
    const fakeImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const fakeOcr = async () => ({ text: '', engine: 'fake' });

    const r = await importService.importFromImage(server.repos, {
      buffer: fakeImage,
      mime: 'image/jpeg',
      ocrAdapter: fakeOcr,
    });
    assert.ok(r.error);
    assert.ok(r.error.toLowerCase().includes('ocr'));
  });

  test('ugyldig mime → error', async () => {
    const r = await importService.importFromImage(server.repos, {
      buffer: Buffer.from([1, 2, 3]),
      mime: 'application/pdf',
      ocrAdapter: async () => ({ text: 'noe' }),
    });
    assert.ok(r.error);
    assert.ok(r.error.includes('Ugyldig bildetype'));
  });

  test('tom buffer → error', async () => {
    const r = await importService.importFromImage(server.repos, {
      buffer: Buffer.alloc(0),
      mime: 'image/png',
    });
    assert.ok(r.error);
  });
});

// ============================================================
// Route: POST /api/recipes/import
// ============================================================

describe('route: POST /api/recipes/import', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.close(); });

  test('JSON-body → 201 med recipeId', async () => {
    const restore = setupLlmMock({
      name: 'Route-rett',
      category: 'rask',
      prepTimeMin: 20,
      servings: 3,
      ingredients: [{ name: 'pasta', qty: 250, unit: 'g' }],
      steps: ['Kok pasta'],
    });

    try {
      const res = await request(server.baseUrl, 'POST', '/api/recipes/import', {
        body: {
          text: 'En enkel pasta-rett med tomatsaus og basilikum. Kok pastaen al dente.',
          title: 'Pasta',
        },
      });
      assert.equal(res.status, 201);
      assert.ok(res.body.recipeId);
      assert.equal(res.body.recipe.name, 'Route-rett');
    } finally {
      restore();
    }
  });

  test('manglende text → 400', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/recipes/import', {
      body: { title: 'uten tekst' },
    });
    assert.equal(res.status, 400);
  });

  test('for kort text → 400', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/recipes/import', {
      body: { text: 'kort' },
    });
    assert.equal(res.status, 400);
  });
});

// ============================================================
// Route: POST /api/recipes/import/image (base64)
// ============================================================

describe('route: POST /api/recipes/import/image', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.close(); });

  test('base64 image → 400 når OCR ikke er tilgjengelig (ingen tesseract)', async () => {
    // Vi gjør ingen LLM-mock og ingen OCR-override. På CI/dev uten Tesseract
    // skal service-laget svare error og route-laget returnere 400.
    // Hvis Tesseract tilfeldigvis ER installert vil dette fortsatt feile
    // fordi vi sender en 4-byte "fake" fil som ikke kan OCR-es.
    const fakeImageB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
    const res = await request(server.baseUrl, 'POST', '/api/recipes/import/image', {
      body: {
        imageBase64: fakeImageB64,
        mime: 'image/jpeg',
      },
    });
    assert.equal(res.status, 400);
  });

  test('manglende imageBase64 → 400', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/recipes/import/image', {
      body: { mime: 'image/png' },
    });
    assert.equal(res.status, 400);
  });

  test('ugyldig mime → 400', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/recipes/import/image', {
      body: {
        imageBase64: Buffer.from('x'.repeat(30)).toString('base64'),
        mime: 'application/pdf',
      },
    });
    assert.equal(res.status, 400);
  });
});
