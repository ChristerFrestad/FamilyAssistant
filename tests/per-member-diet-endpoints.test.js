'use strict';

// Integration tests for B7 / D7 commit 3:
//   - GET  /api/family/members/:id/diet
//   - PUT  /api/family/members/:id/diet
//   - /api/recipes respons shape (legacy + perMember + filter.ignoreDietTags)
//   - /api/recipes?ignoreDietTags=true D7 override
//   - /api/profile/check-recipe new perMember fields + legacy preserved

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

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

before(async () => {
  server = await startTestServer({ authToken: 'per-member-diet-endpoints-test-1234567890abcdef' });
});

after(async () => {
  await server.close();
});

// ============================================================
// GET /api/family/members/:id/diet
// ============================================================

test('GET /diet returns defaults for a freshly-added member', async () => {
  const owner = createUser('diet-get-default@test', 'owner', 'Get-Default');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Kari' });

  const r = await request(server.baseUrl, 'GET', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.memberId, m.id);
  assert.strictEqual(r.body.name, 'Kari');
  assert.strictEqual(r.body.allergies, null);
  assert.strictEqual(r.body.dislikes, null);
  assert.deepEqual(r.body.dietTags, []);
  assert.strictEqual(r.body.customDietNote, null);
});

test('GET /diet returns 404 for non-existent member', async () => {
  const owner = createUser('diet-get-404@test', 'owner', 'Get-404');
  const r = await request(server.baseUrl, 'GET', '/api/family/members/999999/diet', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 404);
});

// ============================================================
// PUT /api/family/members/:id/diet
// ============================================================

test('PUT /diet sets all 4 fields and returns normalized result', async () => {
  const owner = createUser('diet-put-all@test', 'owner', 'Put-All');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Lise' });

  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: {
      allergies: ['Gluten', 'Laktose'],
      dislikes: ['Sopp'],
      dietTags: ['vegetarian', 'laktosefri'],
      customDietNote: 'Foretrekker norsk mat',
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.deepEqual(r.body.diet.allergies, ['Gluten', 'Laktose']);
  assert.deepEqual(r.body.diet.dislikes, ['Sopp']);
  assert.deepEqual(r.body.diet.dietTags, ['vegetarian', 'laktosefri']);
  assert.strictEqual(r.body.diet.customDietNote, 'Foretrekker norsk mat');

  // GET roundtrip
  const g = await request(server.baseUrl, 'GET', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
  });
  assert.deepEqual(g.body.allergies, ['Gluten', 'Laktose']);
  assert.deepEqual(g.body.dietTags, ['vegetarian', 'laktosefri']);
});

test('PUT /diet partial update: only dislikes changed, others untouched', async () => {
  const owner = createUser('diet-put-partial@test', 'owner', 'Put-Partial');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Per' });

  // Seed state
  await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: { allergies: ['Nøtter'], dietTags: ['vegan'] },
  });

  // Partial update
  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: { dislikes: ['Kål'] },
  });
  assert.strictEqual(r.status, 200);
  assert.deepEqual(r.body.diet.allergies, ['Nøtter']); // untouched
  assert.deepEqual(r.body.diet.dislikes, ['Kål']); // new
  assert.deepEqual(r.body.diet.dietTags, ['vegan']); // untouched
});

test('PUT /diet null clears a field (fallback mode for allergies)', async () => {
  const owner = createUser('diet-put-null@test', 'owner', 'Put-Null');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Ola' });

  await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: { allergies: ['Egg'] },
  });
  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: { allergies: null },
  });
  assert.strictEqual(r.body.diet.allergies, null, 'cleared to null (inheritance mode)');
});

test('PUT /diet rejects unknown dietTag', async () => {
  const owner = createUser('diet-put-invalid-tag@test', 'owner', 'Put-Invalid');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Tor' });

  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: { dietTags: ['made-up-diet'] },
  });
  assert.strictEqual(r.status, 400);
});

test('PUT /diet rejects non-array allergies', async () => {
  const owner = createUser('diet-put-wrong-type@test', 'owner', 'Put-Wrong');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Siv' });

  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: owner.cookie },
    body: { allergies: 'Gluten' },
  });
  assert.strictEqual(r.status, 400);
});

test('PUT /diet returns 404 for non-existent member', async () => {
  const owner = createUser('diet-put-404@test', 'owner', 'Put-404');
  const r = await request(server.baseUrl, 'PUT', '/api/family/members/999999/diet', {
    headers: { Cookie: owner.cookie },
    body: { allergies: ['X'] },
  });
  assert.strictEqual(r.status, 404);
});

// ============================================================
// Role enforcement
// ============================================================

test('PUT /diet rejects child role (adult-only)', async () => {
  const child = createUser('diet-put-child@test', 'child', 'Child-Family');
  const m = server.repos.family.addMember(child.familyId, { name: 'Kid' });

  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: child.cookie },
    body: { allergies: ['Nøtter'] },
  });
  assert.strictEqual(r.status, 403);
});

test('GET /diet allows child role (read-only access)', async () => {
  const child = createUser('diet-get-child@test', 'child', 'Child-Get-Family');
  const m = server.repos.family.addMember(child.familyId, { name: 'KidView' });

  const r = await request(server.baseUrl, 'GET', `/api/family/members/${m.id}/diet`, {
    headers: { Cookie: child.cookie },
  });
  assert.strictEqual(r.status, 200);
});

// ============================================================
// Tenant isolation
// ============================================================

test('PUT /diet cannot update another family\u2019s member', async () => {
  const ownerA = createUser('diet-iso-A@test', 'owner', 'Iso-A');
  const ownerB = createUser('diet-iso-B@test', 'owner', 'Iso-B');
  const memberA = server.repos.family.addMember(ownerA.familyId, { name: 'Secret' });

  // Family B tries to update member A via its cookie
  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${memberA.id}/diet`, {
    headers: { Cookie: ownerB.cookie },
    body: { allergies: ['Hijacked'] },
  });
  assert.strictEqual(r.status, 404, 'cross-family update must look like not-found');

  // Verify A's data is untouched
  const a = await request(server.baseUrl, 'GET', `/api/family/members/${memberA.id}/diet`, {
    headers: { Cookie: ownerA.cookie },
  });
  assert.strictEqual(a.body.allergies, null);
});

// ============================================================
// /api/recipes shape — legacy + perMember + filter metadata
// ============================================================

test('GET /api/recipes still exposes legacy safeForProfile (backward-compat)', async () => {
  const owner = createUser('recipes-legacy@test', 'owner', 'Recipes-Legacy');
  const r = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.body.recipes));
  if (r.body.recipes.length > 0) {
    const first = r.body.recipes[0];
    // Legacy fields present
    assert.ok('safeForProfile' in first);
    assert.ok('blockedIngredients' in first);
    assert.ok('checkedAgainst' in first);
    // New perMember bundle present
    assert.ok('perMember' in first);
    assert.ok('allergy' in first.perMember);
    assert.ok('dislike' in first.perMember);
    assert.ok('diet' in first.perMember);
    // New top-level flags
    assert.ok('hiddenByAllergy' in first);
    assert.ok('hiddenByDiet' in first);
    assert.ok('shownWithDislikeWarning' in first);
  }
});

test('GET /api/recipes returns filter metadata (ignoreDietTags, activeDietTags)', async () => {
  const owner = createUser('recipes-filter-meta@test', 'owner', 'Recipes-Meta');
  const r = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.ok('filter' in r.body);
  assert.strictEqual(r.body.filter.ignoreDietTags, false);
  assert.ok(Array.isArray(r.body.filter.activeDietTags));
});

test('GET /api/recipes?ignoreDietTags=true reflects override in metadata', async () => {
  const owner = createUser('recipes-override@test', 'owner', 'Recipes-Override');
  const r = await request(server.baseUrl, 'GET', '/api/recipes?ignoreDietTags=true', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.filter.ignoreDietTags, true);
});

// ============================================================
// D7 integration: override actually hides/shows diet-blocked recipes
// ============================================================

test('D7 override: vegetarian member hides meat recipe; ?ignoreDietTags=true shows it', async () => {
  const owner = createUser('d7-override@test', 'owner', 'D7-Override');
  // Set up a vegetarian member
  const m = server.repos.family.addMember(owner.familyId, { name: 'Lise' });
  server.repos.family.updateMemberDiet(owner.familyId, m.id, { dietTags: ['vegetarian'] });

  // Find a kylling recipe (seeded)
  const recipesRaw = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: owner.cookie },
  });
  const kyllingRecipes = recipesRaw.body.recipes.filter((r) =>
    (r.ingredients || []).some((i) => /kylling|kjøtt|biff|svin|lam/i.test(i.name || ''))
  );

  // Without override: at least one meat recipe should be hiddenByDiet
  if (kyllingRecipes.length > 0) {
    const hiddenCount = kyllingRecipes.filter((r) => r.hiddenByDiet).length;
    assert.ok(hiddenCount > 0, 'Expected meat recipes to be hiddenByDiet for vegetarian member');

    // With override: same recipes should NOT be hiddenByDiet
    const override = await request(server.baseUrl, 'GET', '/api/recipes?ignoreDietTags=true', {
      headers: { Cookie: owner.cookie },
    });
    const sameRecipes = override.body.recipes.filter((r) =>
      kyllingRecipes.some((k) => k.id === r.id)
    );
    const hiddenAfter = sameRecipes.filter((r) => r.hiddenByDiet).length;
    assert.strictEqual(hiddenAfter, 0, 'Override must clear hiddenByDiet on diet-blocked recipes');
  } else {
    // Seed data changed — skip with warning
    console.warn('⚠ No meat recipes found in seed; D7 override path not exercised end-to-end');
  }
});

// ============================================================
// /api/profile/check-recipe — legacy + perMember shape
// ============================================================

test('POST /api/profile/check-recipe returns legacy + perMember', async () => {
  const owner = createUser('check-recipe@test', 'owner', 'Check-Recipe');
  // Seed family-level allergy. Newly-created families don't get a
  // family_profile row by default (only family_id=1 is seeded in
  // migration 009), so INSERT OR REPLACE — UPDATE would no-op. The
  // `id` column (legacy, not defaulted after migration 016) mirrors
  // family_id for this row.
  server.repos._db
    .prepare(
      `INSERT OR REPLACE INTO family_profile (id, family_id, members, allergies, dislikes, preferences)
       VALUES (?, ?, '[]', ?, '[]', '{}')`
    )
    .run(owner.familyId, owner.familyId, JSON.stringify(['Gluten']));

  const r = await request(server.baseUrl, 'POST', '/api/profile/check-recipe', {
    headers: { Cookie: owner.cookie },
    body: { recipe: { ingredients: [{ name: 'Hvetemel' }, { name: 'Ris' }] } },
  });
  assert.strictEqual(r.status, 200);
  // Legacy fields
  assert.strictEqual(r.body.safeForProfile, false, 'Hvetemel triggers Gluten');
  assert.ok(Array.isArray(r.body.blockedIngredients));
  // New per-member bundle
  assert.ok('perMember' in r.body);
  assert.strictEqual(r.body.perMember.allergy.safeForFamily, false);
  assert.ok('hiddenByAllergy' in r.body);
  assert.strictEqual(r.body.hiddenByAllergy, true);
});

test('POST /api/profile/check-recipe body.members overrides current-family members', async () => {
  const owner = createUser('check-recipe-override@test', 'owner', 'Check-Override');
  const r = await request(server.baseUrl, 'POST', '/api/profile/check-recipe', {
    headers: { Cookie: owner.cookie },
    body: {
      recipe: { ingredients: [{ name: 'Kylling' }] },
      profile: { allergies: [], dislikes: [] },
      members: [{ id: 99, name: 'Virtual', dietTags: ['vegan'] }],
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.hiddenByDiet, true, 'virtual vegan member triggers diet conflict');
  assert.strictEqual(r.body.perMember.diet.dietConflicts[0].memberName, 'Virtual');
});
