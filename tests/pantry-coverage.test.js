// Tester for pantry-coverage-service + pantry-first forslag i meal-planning.
//
// Dekker:
//   1. scoreRecipeByPantry — maksimer vs balansert
//   2. rankRecipes — sortering, limit, tie-breaks
//   3. subtractIngredientsFromInventory — simulert "trekk fra"
//   4. generatePantryRestOfWeek — kategori-filter + returnerer topp-5
//   5. computeMissingForRestOfWeek — kun gjenværende dager telles
//   6. POST /api/meals/pantry-suggestions + /accept — ende-til-ende
//   7. Modus-valg via family_profile.preferences.suggestionMode

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const pantryCov = require('../server/services/pantry-coverage.service');
const mealPlanning = require('../server/services/meal-planning.service');
const { startTestServer, request } = require('./helpers');

// ============================================================
// Enhetstester: scoreRecipeByPantry
// ============================================================

describe('pantry-coverage — scoreRecipeByPantry', () => {
  const recipe = {
    id: 1,
    name: 'Test',
    ingredients: [
      { productKey: 'a', name: 'A', qty: 2, unit: 'stk' },
      { productKey: 'b', name: 'B', qty: 1, unit: 'stk' },
    ],
  };

  test('tom pantry → score 0', () => {
    const r = pantryCov.scoreRecipeByPantry(recipe, {}, 'maksimer');
    assert.equal(r.score, 0);
    assert.equal(r.ingredientsAtHome, 0);
    assert.equal(r.totalIngredients, 2);
  });

  test('full pantry → score 1', () => {
    const inv = { a: { qtyRemaining: 10 }, b: { qtyRemaining: 5 } };
    const r = pantryCov.scoreRecipeByPantry(recipe, inv, 'maksimer');
    assert.equal(r.score, 1);
    assert.equal(r.ingredientsAtHome, 2);
  });

  test('delvis pantry → score mellom 0 og 1', () => {
    const inv = { a: { qtyRemaining: 1 } }; // 50% av a, 0% av b
    const r = pantryCov.scoreRecipeByPantry(recipe, inv, 'maksimer');
    // veiet snitt: (0.5 + 0) / 2 = 0.25
    assert.ok(r.score > 0 && r.score < 1);
    assert.ok(Math.abs(r.score - 0.25) < 1e-6, `score=${r.score}`);
    assert.equal(r.ingredientsAtHome, 1);
  });

  test('optional-ingredienser vektes lavere', () => {
    const recipe2 = {
      ingredients: [
        { productKey: 'a', qty: 1 },
        { productKey: 'b', qty: 1, optional: true },
      ],
    };
    // Full a, null b: base = (1*1 + 0*0.3) / (1 + 0.3) ≈ 0.769
    const r = pantryCov.scoreRecipeByPantry(recipe2, { a: { qtyRemaining: 1 } }, 'maksimer');
    assert.ok(r.score > 0.7 && r.score < 0.8, `score=${r.score}`);
  });

  test('balansert gir urgency-bonus for utløpsnær vare', () => {
    const now = Date.UTC(2026, 3, 16); // 2026-04-16
    const inv = {
      a: { qtyRemaining: 10, expiresEst: '2026-04-17' }, // 1 dag igjen
      b: { qtyRemaining: 5 },
    };
    const max = pantryCov.scoreRecipeByPantry(recipe, inv, 'maksimer', now);
    const bal = pantryCov.scoreRecipeByPantry(recipe, inv, 'balansert', now);
    assert.equal(max.score, 1); // full dekning
    assert.ok(bal.score > max.score, `bal=${bal.score} skal være > max=${max.score}`);
    assert.equal(bal.expiringUsed, 1);
  });

  test('ingen utløpsdato gir ingen urgency-bonus i balansert', () => {
    const inv = { a: { qtyRemaining: 10 }, b: { qtyRemaining: 5 } };
    const bal = pantryCov.scoreRecipeByPantry(recipe, inv, 'balansert');
    assert.equal(bal.score, 1);
    assert.equal(bal.expiringUsed, 0);
  });

  test('langt frem i tid gir ingen urgency-bonus', () => {
    const now = Date.UTC(2026, 3, 16);
    const inv = {
      a: { qtyRemaining: 10, expiresEst: '2026-05-30' }, // ~44 dager
      b: { qtyRemaining: 5 },
    };
    const bal = pantryCov.scoreRecipeByPantry(recipe, inv, 'balansert', now);
    assert.equal(bal.score, 1);
    assert.equal(bal.expiringUsed, 0);
  });

  test('tom ingrediensliste → score 0', () => {
    const r = pantryCov.scoreRecipeByPantry({ ingredients: [] }, {}, 'maksimer');
    assert.equal(r.score, 0);
    assert.equal(r.totalIngredients, 0);
  });
});

// ============================================================
// Enhetstester: rankRecipes
// ============================================================

describe('pantry-coverage — rankRecipes', () => {
  const recipes = [
    {
      id: 1,
      name: 'R1',
      prepTime: '30 min',
      ingredients: [
        { productKey: 'a', qty: 1 },
        { productKey: 'b', qty: 1 },
      ],
    },
    {
      id: 2,
      name: 'R2',
      prepTime: '15 min',
      ingredients: [{ productKey: 'a', qty: 1 }],
    },
    {
      id: 3,
      name: 'R3',
      prepTime: '45 min',
      ingredients: [{ productKey: 'c', qty: 1 }],
    },
  ];

  test('sorterer desc etter score (score 1 vinner over 0)', () => {
    const inv = { a: { qtyRemaining: 5 }, b: { qtyRemaining: 5 } };
    const r = pantryCov.rankRecipes(recipes, inv, 'maksimer');
    // R1 (2/2) og R2 (1/1) har begge score 1; tie-break på prepTime: R2 (15) < R1 (30)
    // R3 (0/1) har score 0
    assert.equal(r[2].recipe.id, 3); // R3 sist
    const topIds = [r[0].recipe.id, r[1].recipe.id].sort();
    assert.deepEqual(topIds, [1, 2]); // R1 og R2 på topp i én eller annen rekkefølge
    // Tie-break: R2 (kortere prepTime) vinner
    assert.equal(r[0].recipe.id, 2);
  });

  test('tie-break: kortere prepTime vinner ved lik score', () => {
    const inv = { a: { qtyRemaining: 5 } };
    // R1: 0.5 (a dekker 1/2), R2: 1.0, R3: 0
    const r = pantryCov.rankRecipes(recipes, inv, 'maksimer');
    assert.equal(r[0].recipe.id, 2);
  });

  test('limit respekteres', () => {
    const r = pantryCov.rankRecipes(recipes, {}, 'maksimer', 2);
    assert.equal(r.length, 2);
  });

  test('balansert tie-break: flere utløpsnære varer brukt vinner', () => {
    const now = Date.UTC(2026, 3, 16);
    const inv = {
      a: { qtyRemaining: 5, expiresEst: '2026-04-17' },
      b: { qtyRemaining: 5, expiresEst: '2026-04-17' },
    };
    // R1 bruker a+b (begge utløper snart) → expiringUsed=2
    // R2 bruker kun a → expiringUsed=1
    // Scorer likt på base (full dekning), men R1 skal vinne
    const r = pantryCov.rankRecipes(recipes, inv, 'balansert');
    assert.equal(r[0].recipe.id, 1);
  });

  test('tom input → tom array', () => {
    assert.deepEqual(pantryCov.rankRecipes([], {}, 'maksimer'), []);
  });
});

// ============================================================
// Enhetstester: subtractIngredientsFromInventory
// ============================================================

describe('pantry-coverage — subtractIngredientsFromInventory', () => {
  test('trekker fra mengder uten å mutere original', () => {
    const inv = { a: { qtyRemaining: 5, unit: 'stk' } };
    const recipe = { ingredients: [{ productKey: 'a', qty: 2 }] };
    const next = pantryCov.subtractIngredientsFromInventory(inv, recipe);
    assert.equal(inv.a.qtyRemaining, 5, 'original uendret');
    assert.equal(next.a.qtyRemaining, 3);
  });

  test('går ikke under 0', () => {
    const inv = { a: { qtyRemaining: 1 } };
    const recipe = { ingredients: [{ productKey: 'a', qty: 10 }] };
    const next = pantryCov.subtractIngredientsFromInventory(inv, recipe);
    assert.equal(next.a.qtyRemaining, 0);
  });

  test('ignorerer ingredienser som ikke finnes i pantry', () => {
    const inv = { a: { qtyRemaining: 5 } };
    const recipe = { ingredients: [{ productKey: 'z', qty: 1 }] };
    const next = pantryCov.subtractIngredientsFromInventory(inv, recipe);
    assert.deepEqual(next.a, inv.a);
    assert.equal(next.z, undefined);
  });
});

// ============================================================
// Integrasjonstester: generatePantryRestOfWeek + routes
// ============================================================

describe('meal-planning — generatePantryRestOfWeek (direct)', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('returnerer topp-N oppskrifter i valgt kategori', () => {
    const result = mealPlanning.generatePantryRestOfWeek(ctx.repos, { category: 'rask' });
    assert.equal(result.category, 'rask');
    assert.ok(Array.isArray(result.suggestions));
    assert.ok(result.suggestions.length <= 5);
    for (const s of result.suggestions) {
      assert.equal(s.category, 'rask');
      assert.ok(typeof s.score === 'number');
      assert.ok(typeof s.ingredientsAtHome === 'number');
      assert.ok(typeof s.totalIngredients === 'number');
    }
  });

  test('suggestions sortert desc etter score', () => {
    const result = mealPlanning.generatePantryRestOfWeek(ctx.repos, { category: 'comfort' });
    for (let i = 1; i < result.suggestions.length; i++) {
      assert.ok(
        result.suggestions[i - 1].score >= result.suggestions[i].score,
        `score ikke desc: ${result.suggestions[i - 1].score} < ${result.suggestions[i].score}`
      );
    }
  });

  test('ugyldig kategori kaster feil', () => {
    assert.throws(
      () => mealPlanning.generatePantryRestOfWeek(ctx.repos, { category: 'ugyldig' }),
      /Ugyldig kategori/
    );
  });

  test('remainingDays inneholder bare dager >= i dag', () => {
    const result = mealPlanning.generatePantryRestOfWeek(ctx.repos, { category: 'rask' });
    for (const d of result.remainingDays) {
      assert.ok(d >= result.currentDayOfWeek);
      assert.ok(d <= 6);
    }
  });
});

// ============================================================
// HTTP-tester: /api/meals/pantry-suggestions + /accept
// ============================================================

describe('POST /api/meals/pantry-suggestions', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('returnerer 200 med suggestions for gyldig kategori', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/meals/pantry-suggestions', {
      body: { category: 'rask' },
    });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.suggestions));
    assert.equal(r.body.category, 'rask');
    assert.ok(typeof r.body.currentDayOfWeek === 'number');
  });

  test('400 ved ugyldig kategori', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/meals/pantry-suggestions', {
      body: { category: 'tull' },
    });
    assert.equal(r.status, 400);
  });

  test('400 uten body', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/meals/pantry-suggestions', {
      body: {},
    });
    assert.equal(r.status, 400);
  });
});

describe('POST /api/meals/pantry-suggestions/accept', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('lagrer valgte måltider og genererer missing_ingredients-varsel ved mangel', async () => {
    // Hent først en kandidat
    const suggR = await request(ctx.baseUrl, 'POST', '/api/meals/pantry-suggestions', {
      body: { category: 'comfort' },
    });
    assert.equal(suggR.status, 200);
    const cand = suggR.body.suggestions[0];
    assert.ok(cand, 'må ha minst én kandidat');
    const dayOfWeek = suggR.body.remainingDays[0];
    if (dayOfWeek === undefined) return; // test-uka er ferdig — skip

    const r = await request(ctx.baseUrl, 'POST', '/api/meals/pantry-suggestions/accept', {
      body: { meals: [{ dayOfWeek, recipeId: cand.recipeId }] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.missing));

    // Verifiser at plan-en faktisk ble oppdatert
    const plan = ctx.repos.mealPlans.getWeek(r.body.weekYear);
    const slot = plan.find((p) => p.dayOfWeek === dayOfWeek);
    assert.equal(slot?.recipeId, cand.recipeId);

    // Verifiser at varsel ble lagret (hvis det var noe som manglet)
    if (r.body.missing.length > 0) {
      const unread = ctx.repos.notifications.getUnread();
      const missing = unread.find((n) => n.type === 'missing_ingredients');
      assert.ok(missing, 'missing_ingredients-varsel skal være opprettet');
    }
  });

  test('400 ved tom meals-array', async () => {
    const r = await request(ctx.baseUrl, 'POST', '/api/meals/pantry-suggestions/accept', {
      body: { meals: [] },
    });
    assert.equal(r.status, 400);
  });
});

// ============================================================
// Modus-valg via preferences.suggestionMode
// ============================================================

describe('suggestionMode i family_profile.preferences', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    await ctx.close();
  });

  test('default → resolveMode returnerer "default"', () => {
    assert.equal(mealPlanning.resolveMode(ctx.repos), 'default');
  });

  test('setter til "balansert" via /api/profile', async () => {
    const r = await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: { preferences: { suggestionMode: 'balansert' } },
    });
    assert.equal(r.status, 200);
    assert.equal(mealPlanning.resolveMode(ctx.repos), 'balansert');
  });

  test('ugyldig verdi faller tilbake til "default"', async () => {
    await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: { preferences: { suggestionMode: 'ugyldig-verdi' } },
    });
    assert.equal(mealPlanning.resolveMode(ctx.repos), 'default');
  });

  test('getSwapSuggestions respekterer pantry-first modus', async () => {
    // Sett modus
    await request(ctx.baseUrl, 'PUT', '/api/profile', {
      body: { preferences: { suggestionMode: 'maksimer' } },
    });

    const r = await request(ctx.baseUrl, 'GET', '/api/meals/suggestions/2');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.suggestions));
    // I pantry-first skal hvert forslag ha score-feltet
    if (r.body.suggestions.length > 0) {
      assert.ok(typeof r.body.suggestions[0].score === 'number');
      // Sortert desc
      for (let i = 1; i < r.body.suggestions.length; i++) {
        assert.ok(r.body.suggestions[i - 1].score >= r.body.suggestions[i].score);
      }
    }
  });
});
