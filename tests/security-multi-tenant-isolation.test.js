'use strict';

// Negative multi-tenant isolation tests.
//
// The app's tenant-isolation guarantee is built on the app-layer pattern
// `getFamilyId()` (AsyncLocalStorage-backed) rather than database RLS,
// since SQLite has no RLS. That means every repository read/write uses
// the family_id of the authenticated user's session and queries are
// scoped to that family.
//
// These tests prove the guarantee end-to-end. They:
//
//   1. Stand up two real families (A and B) with their own owner-user.
//   2. Seed data inside each family.
//   3. Authenticate as Family A and try to read or mutate Family B's
//      resources via the public HTTP API.
//   4. Assert that the response either does not contain Family B's
//      data (for list endpoints) or returns 403/404 (for resource-by-ID
//      endpoints).
//
// We use the same harness pattern as tests/family-endpoints.test.js:
// startTestServer + direct DB inserts for setup + cookie-based session
// auth for HTTP requests.
//
// scripts/run-tests.js does a flat readdir of tests/, so this file lives
// directly under tests/ rather than tests/security/ (the spec's
// preference) — putting it in a subdirectory would silently exclude it
// from CI.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createFamilyWithOwner(email, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

// Direct DB seeders for each resource type. We bypass the repo layer
// here so we can stamp family_id explicitly without involving
// AsyncLocalStorage, which keeps the seed code isolated from the
// running test request.
function seedShoppingItem(familyId) {
  // shopping_lists schema (post-014): (id, family_id, week_year, status,
  // generated_at). No created_at/updated_at.
  const listId = Number(
    server.repos._db
      .prepare(
        `INSERT INTO shopping_lists (family_id, week_year, status)
         VALUES (?, '2026-W17', 'active')`
      )
      .run(familyId).lastInsertRowid
  );
  // shopping_list_items requires source_type + ingredient_name (NOT NULL).
  // family_id was added by migration 014.
  const itemId = Number(
    server.repos._db
      .prepare(
        `INSERT INTO shopping_list_items
         (list_id, family_id, source_type, ingredient_name, product_key, qty, unit)
         VALUES (?, ?, 'manual', 'kyllingfilet', 'kyllingfilet', 500, 'g')`
      )
      .run(listId, familyId).lastInsertRowid
  );
  return { listId, itemId };
}

function seedRecipe(familyId, name = 'Family-modified recipe') {
  // recipes.category is an enum with three legal values: rask | comfort | helg.
  // family_id was added by migration 014.
  return Number(
    server.repos._db
      .prepare(
        `INSERT INTO recipes (family_id, name, category, source, url)
         VALUES (?, ?, 'rask', 'family-modified', NULL)`
      )
      .run(familyId, name).lastInsertRowid
  );
}

function seedFamilyMember(familyId, name = 'Lise') {
  // family_profile_members.category (not "role") with values adult|teen|child.
  return Number(
    server.repos._db
      .prepare(
        `INSERT INTO family_profile_members (family_id, name, category, portion_factor)
         VALUES (?, ?, 'adult', 1.0)`
      )
      .run(familyId, name).lastInsertRowid
  );
}

function seedChore(familyId, task = 'Vacuum') {
  // chores.frequency is NOT NULL with no enum check. family_id was added
  // by migration 014.
  const choreId = Number(
    server.repos._db
      .prepare(
        `INSERT INTO chores (family_id, task, frequency, default_day, active)
         VALUES (?, ?, 'weekly', 1, 1)`
      )
      .run(familyId, task).lastInsertRowid
  );
  server.repos._db
    .prepare(
      `INSERT INTO chore_schedules (family_id, chore_id, week_year, scheduled_day, status)
       VALUES (?, ?, '2026-W17', 1, 'pending')`
    )
    .run(familyId, choreId);
  return choreId;
}

function seedNotification(familyId, message = 'Test notification body') {
  // notifications schema: (id, type, message, data_json, read, created_at,
  // family_id). No title/body — message holds the human-readable text.
  return Number(
    server.repos._db
      .prepare(
        `INSERT INTO notifications (family_id, type, message)
         VALUES (?, 'info', ?)`
      )
      .run(familyId, message).lastInsertRowid
  );
}

let familyA;
let familyB;
let familyBData;

before(async () => {
  // Use a long-enough auth token to satisfy config.js validation, but
  // we never send it as a Bearer header — we authenticate via session
  // cookies in every test below.
  server = await startTestServer({ authToken: 'mt-iso-test-1234567890abcdef0123' });

  familyA = createFamilyWithOwner('alice@example.com', 'Family Alice');
  familyB = createFamilyWithOwner('bob@example.com', 'Family Bob');

  familyBData = {
    shopping: seedShoppingItem(familyB.familyId),
    recipeId: seedRecipe(familyB.familyId, 'Bob family pasta'),
    memberId: seedFamilyMember(familyB.familyId, 'Bob spouse'),
    choreId: seedChore(familyB.familyId, 'Bob vacuum'),
    notificationId: seedNotification(familyB.familyId, 'Bob notification body'),
  };
});

after(async () => {
  await server.close();
});

// ============================================================
// 1. GET /api/family — read family info
// ============================================================

test("GET /api/family — Family A cannot see Family B's family info", async () => {
  const r = await request(server.baseUrl, 'GET', '/api/family', {
    headers: { Cookie: familyA.cookie },
  });
  assert.equal(r.status, 200);
  // Response should describe Family A, never Family B.
  assert.ok(
    !JSON.stringify(r.body).includes('Family Bob'),
    `Response leaked Family B name: ${JSON.stringify(r.body)}`
  );
  assert.equal(r.body.family?.id, familyA.familyId);
});

// ============================================================
// 2. GET /api/family/members/:id/diet — cross-family member access
// ============================================================

test('GET /api/family/members/:id/diet — Family A cannot read Family B member diet', async () => {
  const r = await request(
    server.baseUrl,
    'GET',
    `/api/family/members/${familyBData.memberId}/diet`,
    { headers: { Cookie: familyA.cookie } }
  );
  // Should be 403 (forbidden) or 404 (not found within Family A scope).
  assert.ok(r.status === 403 || r.status === 404, `Expected 403/404, got ${r.status}`);
});

// ============================================================
// 3. PUT /api/family/members/:id — cross-family member mutation
// ============================================================

test('PUT /api/family/members/:id — Family A cannot update Family B member', async () => {
  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${familyBData.memberId}`, {
    headers: { Cookie: familyA.cookie },
    body: { name: 'Hacked' },
  });
  assert.ok(r.status === 403 || r.status === 404, `Expected 403/404, got ${r.status}`);
  // Verify Family B's member is unchanged.
  const stillBob = server.repos._db
    .prepare('SELECT name FROM family_profile_members WHERE id = ?')
    .get(familyBData.memberId);
  assert.equal(stillBob.name, 'Bob spouse');
});

// ============================================================
// 4. DELETE /api/family/members/:id — cross-family member deletion
// ============================================================

test('DELETE /api/family/members/:id — Family A cannot delete Family B member', async () => {
  const r = await request(server.baseUrl, 'DELETE', `/api/family/members/${familyBData.memberId}`, {
    headers: { Cookie: familyA.cookie },
  });
  // The endpoint scopes the DELETE by getFamilyId(), so Family A asking
  // to delete Family B's id is a no-op rather than a 403/404. The
  // critical assertion is that Family B's member is unchanged — the
  // status code is secondary (UX-only). Some routes return 403/404,
  // others 200-no-op; both preserve isolation.
  assert.ok(r.status >= 200 && r.status < 500, `Unexpected error status: ${r.status}`);
  const stillThere = server.repos._db
    .prepare('SELECT id FROM family_profile_members WHERE id = ?')
    .get(familyBData.memberId);
  assert.ok(stillThere, `Family B member was wrongfully deleted (response status=${r.status})`);
});

// ============================================================
// 5. GET /api/recipes — list scoping
// ============================================================

test('GET /api/recipes — Family A list does not include Family B family-modified recipe', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/recipes', {
    headers: { Cookie: familyA.cookie },
  });
  assert.equal(r.status, 200);
  const list = Array.isArray(r.body) ? r.body : r.body?.recipes || [];
  const names = list.map((x) => x?.name).filter(Boolean);
  assert.ok(
    !names.includes('Bob family pasta'),
    `Family A list leaked Family B family-modified recipe: ${names.join(', ')}`
  );
});

// ============================================================
// 6. GET /api/recipes/:id — single recipe by id
// ============================================================

test('GET /api/recipes/:id — Family A cannot read Family B family-modified recipe', async () => {
  const r = await request(server.baseUrl, 'GET', `/api/recipes/${familyBData.recipeId}`, {
    headers: { Cookie: familyA.cookie },
  });
  // Family-modified recipes are family-scoped; cross-tenant access must
  // not return them. 200 with empty/null body is also acceptable as
  // "not found in this family", but typically returns 404.
  assert.ok(
    r.status === 403 || r.status === 404 || (r.status === 200 && !r.body?.id),
    `Expected 403/404 or 200-with-null, got ${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`
  );
});

// ============================================================
// 7. GET /api/shopping/list/:id — cross-family shopping list read
// ============================================================

test('GET /api/shopping/list/:id — Family A cannot read Family B shopping list', async () => {
  const r = await request(
    server.baseUrl,
    'GET',
    `/api/shopping/list/${familyBData.shopping.listId}`,
    { headers: { Cookie: familyA.cookie } }
  );
  assert.ok(r.status === 403 || r.status === 404, `Expected 403/404, got ${r.status}`);
});

// ============================================================
// 8. PUT /api/shopping/items/:id/has-home — cross-family item mutation
// ============================================================

test('PUT /api/shopping/items/:id/has-home — Family A cannot mutate Family B item', async () => {
  const r = await request(
    server.baseUrl,
    'PUT',
    `/api/shopping/items/${familyBData.shopping.itemId}/has-home`,
    { headers: { Cookie: familyA.cookie }, body: { qty: 999 } }
  );
  // 403/404 OR 200-no-op (depending on how the route scopes its UPDATE
  // via getFamilyId()). Both preserve isolation; the critical
  // invariant is that Family B's item is unchanged.
  assert.ok(r.status >= 200 && r.status < 500, `Unexpected error status: ${r.status}`);
  const item = server.repos._db
    .prepare('SELECT pantry_has, pantry_qty FROM shopping_list_items WHERE id = ?')
    .get(familyBData.shopping.itemId);
  assert.equal(
    item.pantry_has,
    0,
    `Family B item was wrongfully marked as has-home (response status=${r.status})`
  );
});

// ============================================================
// 9. DELETE /api/shopping/items/:id — cross-family item deletion
// ============================================================

test('DELETE /api/shopping/items/:id — Family A cannot delete Family B item', async () => {
  const r = await request(
    server.baseUrl,
    'DELETE',
    `/api/shopping/items/${familyBData.shopping.itemId}`,
    { headers: { Cookie: familyA.cookie } }
  );
  assert.ok(r.status === 403 || r.status === 404, `Expected 403/404, got ${r.status}`);
  // Verify Family B's item still exists.
  const stillThere = server.repos._db
    .prepare('SELECT id FROM shopping_list_items WHERE id = ?')
    .get(familyBData.shopping.itemId);
  assert.ok(stillThere, 'Family B shopping item was wrongfully deleted');
});

// ============================================================
// 10. PUT /api/chores/complete — cross-family chore mutation
// ============================================================

test('PUT /api/chores/complete — Family A cannot mark Family B chore complete', async () => {
  const r = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
    headers: { Cookie: familyA.cookie },
    body: { choreId: familyBData.choreId, weekYear: '2026-W17' },
  });
  // Either 403/404 (rejected outright) or 200 with no-op (because
  // getFamilyId() filters the query so the chore "doesn't exist" in
  // Family A's scope). Both are acceptable as long as Family B's
  // chore status is not modified.
  assert.ok(r.status >= 200 && r.status < 500, `Unexpected error status: ${r.status}`);
  const stillPending = server.repos._db
    .prepare('SELECT status FROM chore_schedules WHERE family_id = ? AND chore_id = ?')
    .get(familyB.familyId, familyBData.choreId);
  assert.equal(
    stillPending?.status,
    'pending',
    `Family B chore was wrongfully completed (response status=${r.status})`
  );
});

// ============================================================
// 11. GET /api/notifications — list scoping
// ============================================================

test('GET /api/notifications — Family A does not see Family B notifications', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/notifications', {
    headers: { Cookie: familyA.cookie },
  });
  assert.equal(r.status, 200);
  const list = Array.isArray(r.body) ? r.body : r.body?.notifications || [];
  // notifications schema uses `message`, not `title`.
  const messages = list.map((x) => x?.message).filter(Boolean);
  assert.ok(
    !messages.includes('Bob notification body'),
    `Family A list leaked Family B notification: ${messages.join(', ')}`
  );
});

// ============================================================
// 12. GET /api/pantry — list scoping
// ============================================================

test('GET /api/pantry — Family A pantry list does not contain Family B inventory', async () => {
  // inventory schema (post-014): primary key is composite (family_id,
  // product_key). Column is qty_remaining, not qty.
  server.repos._db
    .prepare(
      `INSERT INTO inventory
        (family_id, product_key, qty_remaining, unit, last_purchased, expires_est)
       VALUES (?, 'kyllingfilet', 500, 'g', date('now'), date('now', '+3 days'))`
    )
    .run(familyB.familyId);

  const r = await request(server.baseUrl, 'GET', '/api/pantry', {
    headers: { Cookie: familyA.cookie },
  });
  assert.equal(r.status, 200);
  const list = Array.isArray(r.body) ? r.body : r.body?.items || [];
  // Family A has no inventory of its own — list must be empty.
  // (If someone seeds Family A inventory in the future, this assert
  // should change to assert that NO row has family_id=B.)
  assert.equal(list.length, 0, `Family A list contained Family B inventory: ${list.length} rows`);
});

// ============================================================
// 13. Unauthenticated requests are blocked entirely
// ============================================================

test('GET /api/family without cookie returns 401', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/family');
  assert.ok(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`);
});
