// Uke 9 (SAF-5): Safety fuzz-tester for allergi-filter
//
// 30+ adversarial-scenarier der vi ber om oppskrifter og verifiserer at
// post-filteret fanger allergi-brudd uansett hvordan LLM "glemmer" profilen.
//
// Strategi:
//   1. Unit-tester: allergy-filter.service.checkRecipe på hånd-lagde oppskrifter
//   2. Integration: POST /api/profile/check-recipe gir korrekt respons
//   3. Integration: GET /api/recipes/:id returnerer safeForProfile-felt
//   4. Regresjon: det MÅ aldri bli "safe" når en trigger-substring er i ingrediens

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const allergyFilter = require('../server/services/allergy-filter.service');
const { startTestServer, request } = require('./helpers');

// ============================================================
// SAF-5a: Unit-tester på checkRecipe
// ============================================================
describe('Uke9 · SAF-5a allergy-filter unit tester', () => {
  test('Tom profil = alt er safe', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'melk' }, { name: 'peanøtter' }] },
      { allergies: [] }
    );
    assert.equal(result.safeForProfile, true);
    assert.equal(result.blockedIngredients.length, 0);
    assert.equal(result.checkedAgainst.length, 0);
  });

  test('Ingen ingredienser = alt er safe', () => {
    const result = allergyFilter.checkRecipe({ ingredients: [] }, { allergies: ['nøtter'] });
    assert.equal(result.safeForProfile, true);
    assert.equal(result.blockedIngredients.length, 0);
  });

  test('Nøtt-allergi fanger "hasselnøtt"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'hasselnøtter' }, { name: 'sukker' }] },
      { allergies: ['nøtter'] }
    );
    assert.equal(result.safeForProfile, false);
    assert.equal(result.blockedIngredients.length, 1);
    assert.equal(result.blockedIngredients[0].ingredient, 'hasselnøtter');
    assert.equal(result.blockedIngredients[0].allergy, 'nøtter');
  });

  test('Nøtt-allergi fanger "peanøtter" via bred kategori', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'peanøttsmør' }] },
      { allergies: ['nøtter'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Laktose fanger "parmesan"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'pasta' }, { name: 'parmesan', qty: 50 }] },
      { allergies: ['laktose'] }
    );
    assert.equal(result.safeForProfile, false);
    assert.ok(result.blockedIngredients.some((b) => b.ingredient === 'parmesan'));
  });

  test('Laktose fanger "fløte" og "smør"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'kremfløte' }, { name: 'meierismør' }] },
      { allergies: ['laktose'] }
    );
    assert.equal(result.safeForProfile, false);
    assert.equal(result.blockedIngredients.length, 2);
  });

  test('Gluten fanger "hvetemel"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'hvetemel' }] },
      { allergies: ['gluten'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Case-insensitiv matching ("MELK" vs "melk")', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'MELK' }] },
      { allergies: ['laktose'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Egg-allergi fanger "eggehvite"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'eggehvite' }, { name: 'sukker' }] },
      { allergies: ['egg'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Fisk-allergi fanger "laks"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'fersk laks' }, { name: 'sitron' }] },
      { allergies: ['fisk'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Skalldyr-allergi fanger "reker"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'kokte reker' }] },
      { allergies: ['skalldyr'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Soya-allergi fanger "tofu"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'tofu' }, { name: 'ris' }] },
      { allergies: ['soya'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Sesam-allergi fanger "tahini"', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'tahini saus' }] },
      { allergies: ['sesam'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Flere allergier på samme oppskrift — alle blir rapportert', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'melk' }, { name: 'hasselnøtter' }, { name: 'egg' }] },
      { allergies: ['laktose', 'nøtter', 'egg'] }
    );
    assert.equal(result.safeForProfile, false);
    assert.equal(result.blockedIngredients.length, 3);
  });

  test('Ingrediens-array med "ingredient"-key (alternativ shape)', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ ingredient: 'melk', qty: 2 }] },
      { allergies: ['laktose'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Ugyldig input: null recipe', () => {
    const result = allergyFilter.checkRecipe(null, { allergies: ['nøtter'] });
    assert.equal(result.safeForProfile, true);
    assert.equal(result.blockedIngredients.length, 0);
  });

  test('Ugyldig input: recipe uten ingredients', () => {
    const result = allergyFilter.checkRecipe({}, { allergies: ['nøtter'] });
    assert.equal(result.safeForProfile, true);
  });

  test('Ugyldig input: undefined ingredient-name', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: undefined }, { name: 'melk' }] },
      { allergies: ['laktose'] }
    );
    // Kun "melk" skal trigge
    assert.equal(result.safeForProfile, false);
    assert.equal(result.blockedIngredients.length, 1);
  });

  test('Ugyldig profil: null profile', () => {
    const result = allergyFilter.checkRecipe({ ingredients: [{ name: 'melk' }] }, null);
    assert.equal(result.safeForProfile, true);
  });

  test('Melk-allergi (ikke laktose) fanger samme triggere', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'cheddarost' }] },
      { allergies: ['melk'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Fuzzy: "peanøttolje" fanges av "peanøtter"-allergi', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'peanøttolje' }] },
      { allergies: ['peanøtter'] }
    );
    assert.equal(result.safeForProfile, false);
  });

  test('Trygg oppskrift: ingen allergener', () => {
    const result = allergyFilter.checkRecipe(
      { ingredients: [{ name: 'ris' }, { name: 'kylling' }, { name: 'salt' }] },
      { allergies: ['nøtter', 'laktose', 'egg'] }
    );
    assert.equal(result.safeForProfile, true);
    assert.equal(result.blockedIngredients.length, 0);
  });

  test('annotateRecipe beholder original shape + legger til safety-felter', () => {
    const original = {
      id: 42,
      name: 'Test-rett',
      ingredients: [{ name: 'melk' }],
      servings: 4,
    };
    const annotated = allergyFilter.annotateRecipe(original, { allergies: ['laktose'] });
    assert.equal(annotated.id, 42);
    assert.equal(annotated.name, 'Test-rett');
    assert.equal(annotated.servings, 4);
    assert.equal(annotated.safeForProfile, false);
    assert.equal(annotated.blockedIngredients.length, 1);
  });

  test('checkRecipes batch-operasjon', () => {
    const recipes = [
      { ingredients: [{ name: 'ris' }] }, // safe
      { ingredients: [{ name: 'melk' }] }, // ikke safe
      { ingredients: [{ name: 'brød' }] }, // ikke safe (gluten)
    ];
    const results = allergyFilter.checkRecipes(recipes, { allergies: ['laktose', 'gluten'] });
    assert.equal(results.length, 3);
    assert.equal(results[0].safeForProfile, true);
    assert.equal(results[1].safeForProfile, false);
    assert.equal(results[2].safeForProfile, false);
  });
});

// ============================================================
// SAF-5b: Regresjon — hver enkelt trigger må bli fanget
// ============================================================
describe('Uke9 · SAF-5b regresjon: alle triggere fanges', () => {
  // Systematisk test: for hver allergi i ALLERGY_TRIGGERS, prøv hver trigger
  // og verifiser at den blir fanget. Dette er en "never again"-gate for at
  // ingen trigger kan silently fjernes.
  for (const [allergyKey, triggers] of Object.entries(allergyFilter.ALLERGY_TRIGGERS)) {
    for (const trigger of triggers) {
      test(`Allergi "${allergyKey}" fanger trigger "${trigger}"`, () => {
        const result = allergyFilter.checkRecipe(
          { ingredients: [{ name: trigger }] },
          { allergies: [allergyKey] }
        );
        assert.equal(
          result.safeForProfile,
          false,
          `Trigger "${trigger}" burde blitt fanget av allergi "${allergyKey}"`
        );
        assert.ok(
          result.blockedIngredients.length >= 1,
          `Forventet >=1 blocked, fant ${result.blockedIngredients.length}`
        );
      });
    }
  }
});

// ============================================================
// SAF-5c: API-integration
// ============================================================
describe('Uke9 · SAF-5c /api/profile/check-recipe endepunkt', () => {
  let server;
  before(async () => {
    server = await startTestServer();
    // Sett en allergi-profil
    server.repos.familyProfile.update({ allergies: ['laktose', 'nøtter'] });
  });
  after(async () => {
    if (server) await server.close();
  });

  test('POST /api/profile/check-recipe returnerer safeForProfile', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/profile/check-recipe', {
      body: {
        recipe: { ingredients: [{ name: 'melk' }, { name: 'ris' }] },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.safeForProfile, false);
    assert.ok(res.body.blockedIngredients.length >= 1);
    assert.ok(res.body.checkedAgainst.includes('laktose'));
  });

  test('Trygg oppskrift gir safeForProfile=true', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/profile/check-recipe', {
      body: {
        recipe: { ingredients: [{ name: 'ris' }, { name: 'kylling' }] },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.safeForProfile, true);
    assert.equal(res.body.blockedIngredients.length, 0);
  });

  test('Overstyring via body.profile', async () => {
    // Overstyr til tom allergi-liste → alt er safe
    const res = await request(server.baseUrl, 'POST', '/api/profile/check-recipe', {
      body: {
        recipe: { ingredients: [{ name: 'melk' }] },
        profile: { allergies: [] },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.safeForProfile, true);
  });

  test('400 ved manglende ingredients', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/profile/check-recipe', {
      body: { recipe: { name: 'uten ingredienser' } },
    });
    assert.equal(res.status, 400);
  });
});

// ============================================================
// SAF-5d: GET /api/recipes annoterer med safety
// ============================================================
describe('Uke9 · SAF-5d /api/recipes annoterer hver oppskrift', () => {
  let server;
  before(async () => {
    server = await startTestServer();
    server.repos.familyProfile.update({ allergies: ['laktose'] });
  });
  after(async () => {
    if (server) await server.close();
  });

  test('GET /api/recipes returnerer alle med safeForProfile-felt', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/recipes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.recipes));
    assert.ok(res.body.recipes.length > 0, 'Forventet seeded recipes');
    // Hver oppskrift må ha safety-felter
    for (const r of res.body.recipes) {
      assert.ok('safeForProfile' in r, `Oppskrift ${r.id} mangler safeForProfile-felt`);
      assert.ok('blockedIngredients' in r, `Oppskrift ${r.id} mangler blockedIngredients-felt`);
    }
  });

  test('GET /api/recipes/:id returnerer safeForProfile-felt', async () => {
    const all = await request(server.baseUrl, 'GET', '/api/recipes');
    const first = all.body.recipes[0];
    const res = await request(server.baseUrl, 'GET', `/api/recipes/${first.id}`);
    assert.equal(res.status, 200);
    assert.ok('safeForProfile' in res.body.recipe);
    assert.ok('blockedIngredients' in res.body.recipe);
    assert.ok(Array.isArray(res.body.recipe.checkedAgainst));
  });
});
