'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

let server;

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createFamilyWithUser(familyName, userEmail) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email: userEmail, name: userEmail });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  const sid = newSessionId();
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'secret-tenant-token-1234567890abcdef' });
});

after(async () => {
  await server.close();
});

// ============================================================
// Repository-level isolation (direct ALS-context calls)
// ============================================================

test('inventory is scoped per family', () => {
  const a = createFamilyWithUser('Inv Family A', 'inv-a@tenant.test');
  const b = createFamilyWithUser('Inv Family B', 'inv-b@tenant.test');

  server.repos._db
    .prepare(
      "INSERT OR IGNORE INTO products(key, product_name, category, pack_size, unit) VALUES('iso-milk','Iso Milk','meieri',1,'l')"
    )
    .run();

  runWithFamily(a.familyId, () => {
    server.repos.inventory.upsertManual('iso-milk', { qtyAdded: 2, unit: 'l' });
  });

  const invA = runWithFamily(a.familyId, () => server.repos.inventory.getAll());
  const invB = runWithFamily(b.familyId, () => server.repos.inventory.getAll());

  assert.ok(invA['iso-milk'], 'A sees their own milk');
  assert.strictEqual(invA['iso-milk'].qtyRemaining, 2);
  assert.strictEqual(invB['iso-milk'], undefined, 'B must not see A milk');
});

test('recipes are scoped per family', () => {
  const a = createFamilyWithUser('Rcp Family A', 'rcp-a@tenant.test');
  const b = createFamilyWithUser('Rcp Family B', 'rcp-b@tenant.test');

  const ridA = runWithFamily(a.familyId, () =>
    server.repos.recipes.insert({
      name: 'A-only kyllinggryte',
      category: 'comfort',
      servings: 4,
    })
  );
  const ridB = runWithFamily(b.familyId, () =>
    server.repos.recipes.insert({
      name: 'B-only fiskesuppe',
      category: 'rask',
      servings: 4,
    })
  );

  assert.notStrictEqual(ridA, ridB);

  const allA = runWithFamily(a.familyId, () => server.repos.recipes.getAll());
  const allB = runWithFamily(b.familyId, () => server.repos.recipes.getAll());
  const namesA = allA.map((r) => r.name);
  const namesB = allB.map((r) => r.name);

  assert.ok(namesA.includes('A-only kyllinggryte'), 'A sees own recipe');
  assert.ok(!namesA.includes('B-only fiskesuppe'), 'A must not see B recipe');
  assert.ok(namesB.includes('B-only fiskesuppe'), 'B sees own recipe');
  assert.ok(!namesB.includes('A-only kyllinggryte'), 'B must not see A recipe');

  // Cross-family getById must return null.
  const bFromA = runWithFamily(a.familyId, () => server.repos.recipes.getById(ridB));
  const aFromB = runWithFamily(b.familyId, () => server.repos.recipes.getById(ridA));
  assert.strictEqual(bFromA, null, 'A.getById(B recipe) must be null');
  assert.strictEqual(aFromB, null, 'B.getById(A recipe) must be null');
});

test('meal plans are scoped per family', () => {
  const a = createFamilyWithUser('Meal Family A', 'meal-a@tenant.test');
  const b = createFamilyWithUser('Meal Family B', 'meal-b@tenant.test');

  const ridA = runWithFamily(a.familyId, () =>
    server.repos.recipes.insert({ name: 'A Monday', category: 'comfort', servings: 2 })
  );
  const ridB = runWithFamily(b.familyId, () =>
    server.repos.recipes.insert({ name: 'B Monday', category: 'rask', servings: 2 })
  );

  runWithFamily(a.familyId, () => server.repos.mealPlans.setRecipe('2026-20', 0, ridA, 'planned'));
  runWithFamily(b.familyId, () => server.repos.mealPlans.setRecipe('2026-20', 0, ridB, 'planned'));

  const weekA = runWithFamily(a.familyId, () => server.repos.mealPlans.getWeek('2026-20'));
  const weekB = runWithFamily(b.familyId, () => server.repos.mealPlans.getWeek('2026-20'));

  const mondayA = weekA.find((m) => m.dayOfWeek === 0);
  const mondayB = weekB.find((m) => m.dayOfWeek === 0);

  assert.strictEqual(mondayA.recipeId, ridA);
  assert.strictEqual(mondayB.recipeId, ridB);
});

test('family profile is scoped per family', () => {
  const a = createFamilyWithUser('Profile A', 'prof-a@tenant.test');
  const b = createFamilyWithUser('Profile B', 'prof-b@tenant.test');

  runWithFamily(a.familyId, () =>
    server.repos.familyProfile.update({ members: ['Alice', 'Anna'], allergies: ['nuts'] })
  );
  runWithFamily(b.familyId, () =>
    server.repos.familyProfile.update({ members: ['Bob'], allergies: ['gluten'] })
  );

  const profileA = runWithFamily(a.familyId, () => server.repos.familyProfile.get());
  const profileB = runWithFamily(b.familyId, () => server.repos.familyProfile.get());

  assert.deepStrictEqual(profileA.members, ['Alice', 'Anna']);
  assert.deepStrictEqual(profileA.allergies, ['nuts']);
  assert.deepStrictEqual(profileB.members, ['Bob']);
  assert.deepStrictEqual(profileB.allergies, ['gluten']);
});

test('shopping lists are scoped per family (partial UNIQUE allows both)', () => {
  const a = createFamilyWithUser('Shop A', 'shop-a@tenant.test');
  const b = createFamilyWithUser('Shop B', 'shop-b@tenant.test');

  const resA = runWithFamily(a.familyId, () =>
    server.repos.shoppingLists.createActive('2026-30', [
      { sourceType: 'extra', ingredientName: 'Kaffe — A', needsBuy: true },
    ])
  );
  const resB = runWithFamily(b.familyId, () =>
    server.repos.shoppingLists.createActive('2026-30', [
      { sourceType: 'extra', ingredientName: 'Te — B', needsBuy: true },
    ])
  );

  assert.notStrictEqual(resA.listId, resB.listId, 'each family gets a distinct list row');

  const activeA = runWithFamily(a.familyId, () => server.repos.shoppingLists.getActive('2026-30'));
  const activeB = runWithFamily(b.familyId, () => server.repos.shoppingLists.getActive('2026-30'));

  assert.deepStrictEqual(
    activeA.items.map((i) => i.ingredientName),
    ['Kaffe — A']
  );
  assert.deepStrictEqual(
    activeB.items.map((i) => i.ingredientName),
    ['Te — B']
  );
});

// ============================================================
// HTTP-level isolation: session cookies drive the family
// ============================================================

test("GET /api/pantry returns only the calling family's inventory", async () => {
  const a = createFamilyWithUser('HTTP Inv A', 'http-inv-a@tenant.test');
  const b = createFamilyWithUser('HTTP Inv B', 'http-inv-b@tenant.test');

  server.repos._db
    .prepare(
      "INSERT OR IGNORE INTO products(key, product_name, category, pack_size, unit) VALUES('http-milk','HTTP Milk','meieri',1,'l')"
    )
    .run();

  runWithFamily(a.familyId, () => {
    server.repos.inventory.upsertManual('http-milk', { qtyAdded: 3, unit: 'l' });
  });

  const listA = await request(server.baseUrl, 'GET', '/api/pantry', {
    headers: { Cookie: a.cookie },
  });
  const listB = await request(server.baseUrl, 'GET', '/api/pantry', {
    headers: { Cookie: b.cookie },
  });

  assert.strictEqual(listA.status, 200);
  assert.strictEqual(listB.status, 200);
  const keysA = (listA.body.items || []).map((i) => i.productKey);
  const keysB = (listB.body.items || []).map((i) => i.productKey);
  assert.ok(keysA.includes('http-milk'), 'A sees own inventory over HTTP');
  assert.ok(!keysB.includes('http-milk'), 'B must not see A inventory over HTTP');
});

test('repo calls without an active family context fall back to legacy family 1', () => {
  const profile = server.repos.familyProfile.get();
  assert.ok(profile); // should not throw, returns family-1 profile shape
});
