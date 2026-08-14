'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createUser(email, role, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  if (role === 'owner') server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

const taco = {
  name: 'Hjemmelaget taco',
  category: 'rask',
  prepTime: '20 min',
  servings: 4,
  notes: 'Fredagsklassiker',
  ingredients: [
    { name: 'kjøttdeig', qty: 400, unit: 'g' },
    { name: 'tortilla', qty: 8, unit: 'stk', optional: false },
  ],
};

before(async () => {
  server = await startTestServer({ authToken: 'recipe-crud-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('POST /api/recipes without session returns 401', async () => {
  const r = await request(server.baseUrl, 'POST', '/api/recipes', { body: taco });
  assert.equal(r.status, 401);
});

test('child cannot POST /api/recipes (403)', async () => {
  const child = createUser('child-recipe@crud.test', 'child', 'Child Recipe Fam');
  const r = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: child.cookie },
    body: taco,
  });
  assert.equal(r.status, 403);
});

test('adult create then GET list includes the recipe', async () => {
  const adult = createUser('adult-create@crud.test', 'adult', 'Adult Create Fam');
  const created = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: adult.cookie },
    body: taco,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.ok, true);
  assert.ok(created.body.recipeId > 0);
  assert.equal(created.body.recipe.name, taco.name);
  assert.equal(created.body.recipe.category, 'rask');
  assert.equal(created.body.recipe.sourceType, 'manual');
  assert.equal(created.body.recipe.active, true);
  assert.equal(created.body.recipe.ingredients.length, 2);

  const list = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(list.status, 200);
  const names = list.body.recipes.map((r) => r.name);
  assert.ok(names.includes(taco.name));
});

test('PATCH updates name and replaces ingredients', async () => {
  const adult = createUser('adult-patch@crud.test', 'adult', 'Adult Patch Fam');
  const created = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: adult.cookie },
    body: taco,
  });
  assert.equal(created.status, 201);
  const id = created.body.recipeId;

  const patched = await request(server.baseUrl, 'PATCH', `/api/recipes/${id}`, {
    headers: { Cookie: adult.cookie },
    body: {
      name: 'Taco deluxe',
      ingredients: [{ name: 'laks', qty: 300, unit: 'g', productKey: 'laks' }],
    },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.recipe.name, 'Taco deluxe');
  assert.equal(patched.body.recipe.ingredients.length, 1);
  assert.equal(patched.body.recipe.ingredients[0].name, 'laks');
  assert.equal(patched.body.recipe.ingredients[0].qty, 300);
  assert.ok(
    !patched.body.recipe.ingredients.some((i) => i.name === 'kjøttdeig'),
    'old ingredients must be gone'
  );
});

test('deactivate hides from GET list but GET :id still returns 200', async () => {
  const adult = createUser('adult-deact@crud.test', 'adult', 'Adult Deact Fam');
  const created = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: adult.cookie },
    body: { name: 'Gjemt gryte', category: 'comfort' },
  });
  const id = created.body.recipeId;

  const deact = await request(server.baseUrl, 'POST', `/api/recipes/${id}/deactivate`, {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(deact.status, 200);
  assert.equal(deact.body.ok, true);
  assert.equal(deact.body.recipe.active, false);

  const list = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(list.status, 200);
  assert.equal(
    list.body.recipes.some((r) => r.id === id),
    false,
    'deactivated recipe must not appear in list'
  );

  const one = await request(server.baseUrl, 'GET', `/api/recipes/${id}`, {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(one.status, 200);
  assert.equal(one.body.recipe.name, 'Gjemt gryte');
  assert.equal(one.body.recipe.active, false);
});

test('two families: GET list and PATCH stay isolated', async () => {
  const a = createUser('iso-a@crud.test', 'adult', 'Iso Family A');
  const b = createUser('iso-b@crud.test', 'adult', 'Iso Family B');

  const createdA = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: a.cookie },
    body: { name: 'A-only lapskaus', category: 'comfort' },
  });
  assert.equal(createdA.status, 201);
  const aId = createdA.body.recipeId;

  const createdB = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: b.cookie },
    body: { name: 'B-only fiskesuppe', category: 'rask' },
  });
  assert.equal(createdB.status, 201);

  const listA = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: a.cookie },
  });
  const namesA = listA.body.recipes.map((r) => r.name);
  assert.ok(namesA.includes('A-only lapskaus'));
  assert.equal(namesA.includes('B-only fiskesuppe'), false);

  const listB = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: b.cookie },
  });
  const namesB = listB.body.recipes.map((r) => r.name);
  assert.ok(namesB.includes('B-only fiskesuppe'));
  assert.equal(namesB.includes('A-only lapskaus'), false);

  const patchB = await request(server.baseUrl, 'PATCH', `/api/recipes/${aId}`, {
    headers: { Cookie: b.cookie },
    body: { name: 'Stolen name' },
  });
  assert.equal(patchB.status, 404);

  const stillA = await request(server.baseUrl, 'GET', `/api/recipes/${aId}`, {
    headers: { Cookie: a.cookie },
  });
  assert.equal(stillA.status, 200);
  assert.equal(stillA.body.recipe.name, 'A-only lapskaus');
});

test('deactivated recipe on meal plan: GET /api/meals/current does not 500', async () => {
  const adult = createUser('adult-meals@crud.test', 'adult', 'Meal Deact Fam');
  const created = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: adult.cookie },
    body: { name: 'Planlagt lasagne', category: 'helg', servings: 4 },
  });
  assert.equal(created.status, 201);
  const recipeId = created.body.recipeId;

  const current = await request(server.baseUrl, 'GET', '/api/meals/current', {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(current.status, 200);
  const weekYear = current.body.weekYear;

  runWithFamily(adult.familyId, () => {
    server.repos.mealPlans.setRecipe(weekYear, 0, recipeId, 'planned');
  });

  const deact = await request(server.baseUrl, 'POST', `/api/recipes/${recipeId}/deactivate`, {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(deact.status, 200);

  const after = await request(server.baseUrl, 'GET', '/api/meals/current', {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(after.status, 200);
  const monday = after.body.meals.find((m) => m.dayOfWeek === 0);
  assert.ok(monday, 'monday slot should exist');
  assert.equal(monday.recipeId, recipeId);
  assert.ok(monday.recipe, 'getById must still resolve inactive recipe');
  assert.equal(monday.recipe.name, 'Planlagt lasagne');
});

test('DELETE /api/recipes/:id is rejected; deactivate instead', async () => {
  const adult = createUser('adult-del@crud.test', 'adult', 'No Delete Fam');
  const created = await request(server.baseUrl, 'POST', '/api/recipes', {
    headers: { Cookie: adult.cookie },
    body: { name: 'Ikke slett meg', category: 'rask' },
  });
  const id = created.body.recipeId;
  const del = await request(server.baseUrl, 'DELETE', `/api/recipes/${id}`, {
    headers: { Cookie: adult.cookie },
  });
  assert.equal(del.status, 405);
  assert.match(String(del.body.detail || del.body.title || ''), /deactivate/i);
});
