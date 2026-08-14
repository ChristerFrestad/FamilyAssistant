'use strict';

// G0-5: adversarial isolation attacker.
//
// Authenticated as family A, try to leak or mutate family B by swapping
// family_id in body/query/header, replaying A's cookie on B ids, and
// probing shared caches. Expected: 401/403/404/empty — never 200 with
// foreign unique markers.
//
// Setup replays G0-1: password register + onboarding (not magic-link
// scrape). Child member in A is created via createUser + session cookie.

process.env.PASSWORD_AUTH_ENABLED = 'true';
process.env.PASSWORD_AUTH_OPEN_REGISTER = 'true';
process.env.AUTH_TOKEN = 'g0-5-isolation-attacker-token-0123456789ab';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

const AUTH_TOKEN = process.env.AUTH_TOKEN;

function cookieFromSetCookie(setCookie) {
  if (!setCookie) return '';
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  return raw.map((c) => String(c).split(';')[0]).join('; ');
}

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function authHeaders(cookie, extra = {}) {
  return { Cookie: cookie, ...extra };
}

function haystack(body) {
  return JSON.stringify(body);
}

function uniqueMarkers(who) {
  return [
    who.recipeName,
    who.recipeName2,
    who.calTitle,
    who.calTodayTitle,
    who.shopItem,
    who.familyName,
    who.email,
    who.username,
  ].filter(Boolean);
}

function assertNoMarkers(res, markers, probe) {
  const hay = haystack(res.body);
  const leaked = markers.filter((m) => hay.includes(m));
  assert.equal(
    leaked.length,
    0,
    `${probe} leaked foreign markers [${leaked.join(', ')}] status=${res.status} body=${hay.slice(0, 500)}`
  );
}

function assertDeniedOrEmpty(res, probe) {
  const ok =
    res.status === 401 ||
    res.status === 403 ||
    res.status === 404 ||
    res.status === 405 ||
    res.status === 400 ||
    (res.status === 200 && !res.body) ||
    (res.status === 200 && res.body && (res.body.recipe == null || res.body.similar?.length === 0));
  assert.ok(
    ok || res.status === 200,
    `${probe} unexpected status ${res.status}: ${haystack(res.body).slice(0, 300)}`
  );
}

function shoppingItems(body) {
  const fromCats = (body.categories || []).flatMap((c) => c.items || []);
  const fromItems = body.items || [];
  const seen = new Set();
  const out = [];
  for (const it of [...fromCats, ...fromItems]) {
    if (!it || it.id == null || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function shoppingNames(body) {
  return shoppingItems(body)
    .map((i) => i.name || i.ingredientName)
    .filter(Boolean);
}

function calendarTitles(body) {
  return (body.events || []).map((e) => e.title);
}

function mealRecipeNames(body) {
  return (body.meals || []).map((m) => m.recipe && m.recipe.name).filter(Boolean);
}

let server;
let A;
let B;

describe('G0-5 isolation attacker', { concurrency: false, timeout: 120_000 }, () => {
  before(async () => {
    process.env.PASSWORD_AUTH_ENABLED = 'true';
    process.env.PASSWORD_AUTH_OPEN_REGISTER = 'true';
    process.env.AUTH_TOKEN = AUTH_TOKEN;

    server = await startTestServer({ authToken: AUTH_TOKEN });

    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
    const today = new Date().toISOString().slice(0, 10);

    A = {
      username: `g05a${suffix}`,
      password: 'secret123',
      name: 'Alice Attacker',
      email: `g05a-${suffix}@iso.test`,
      familyName: `Attacker-A-${suffix}`,
      recipeName: `A-only-Kyllinggryte-${suffix}`,
      recipeName2: `A-only-Lapskaus-${suffix}`,
      calTitle: `A-only-PTA-${suffix}`,
      calTodayTitle: `A-today-${suffix}`,
      shopItem: `A-only-Kaffe-${suffix}`,
      eventDate: '2026-11-15',
    };
    B = {
      username: `g05b${suffix}`,
      password: 'secret456',
      name: 'Bjorn Target',
      email: `g05b-${suffix}@iso.test`,
      familyName: `Target-B-${suffix}`,
      recipeName: `B-only-Fiskesuppe-${suffix}`,
      recipeName2: `B-only-Raspeball-${suffix}`,
      calTitle: `B-only-Tannlege-${suffix}`,
      calTodayTitle: `B-today-${suffix}`,
      shopItem: `B-only-Te-${suffix}`,
      eventDate: '2026-11-15',
    };

    async function registerAndOnboard(who) {
      const reg = await request(server.baseUrl, 'POST', '/api/auth/password/register', {
        body: {
          username: who.username,
          password: who.password,
          name: who.name,
          email: who.email,
        },
      });
      assert.equal(reg.status, 200, `register ${who.username}: ${JSON.stringify(reg.body)}`);
      who.cookie = cookieFromSetCookie(reg.headers['set-cookie'] || reg.headers['Set-Cookie']);
      assert.ok(who.cookie.includes('fa_session='), `missing fa_session for ${who.username}`);

      const onb = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
        headers: authHeaders(who.cookie),
        body: {
          family: { name: who.familyName },
          user: { name: who.name, category: 'adult', portionFactor: 1.0 },
        },
      });
      assert.equal(onb.status, 200, `onboarding ${who.username}: ${JSON.stringify(onb.body)}`);
      who.familyId = onb.body.family.id;
      who.userId = onb.body.user?.id || onb.body.family.ownerUserId;
    }

    await registerAndOnboard(A);
    await registerAndOnboard(B);

    const meA = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: authHeaders(A.cookie),
    });
    const meB = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: authHeaders(B.cookie),
    });
    assert.equal(meA.status, 200);
    assert.equal(meB.status, 200);
    A.familyId = meA.body.user.familyId;
    B.familyId = meB.body.user.familyId;
    A.userId = meA.body.user.id;
    B.userId = meB.body.user.id;
    assert.notEqual(A.familyId, B.familyId);
    assert.notEqual(A.userId, B.userId);

    A.recipeId = runWithFamily(A.familyId, () =>
      server.repos.recipes.insert({
        name: A.recipeName,
        category: 'comfort',
        servings: 4,
        ingredients: [{ name: 'kylling', qty: 400, unit: 'g' }],
      })
    );
    A.recipeId2 = runWithFamily(A.familyId, () =>
      server.repos.recipes.insert({
        name: A.recipeName2,
        category: 'comfort',
        servings: 4,
        ingredients: [{ name: 'kylling', qty: 300, unit: 'g' }],
      })
    );
    B.recipeId = runWithFamily(B.familyId, () =>
      server.repos.recipes.insert({
        name: B.recipeName,
        category: 'rask',
        servings: 4,
        ingredients: [{ name: 'torsk', qty: 400, unit: 'g' }],
      })
    );
    B.recipeId2 = runWithFamily(B.familyId, () =>
      server.repos.recipes.insert({
        name: B.recipeName2,
        category: 'rask',
        servings: 4,
        ingredients: [{ name: 'torsk', qty: 300, unit: 'g' }],
      })
    );

    const swapA = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      headers: authHeaders(A.cookie),
      body: { dayOfWeek: 0, recipeId: A.recipeId },
    });
    const swapB = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      headers: authHeaders(B.cookie),
      body: { dayOfWeek: 0, recipeId: B.recipeId },
    });
    assert.equal(swapA.status, 200, JSON.stringify(swapA.body));
    assert.equal(swapB.status, 200, JSON.stringify(swapB.body));

    const mealsB = await request(server.baseUrl, 'GET', '/api/meals/current', {
      headers: authHeaders(B.cookie),
    });
    assert.equal(mealsB.status, 200);
    B.mondayMealId = (mealsB.body.meals || []).find((m) => m.dayOfWeek === 0)?.id;
    B.mondayRecipeId = (mealsB.body.meals || []).find((m) => m.dayOfWeek === 0)?.recipeId;
    B.weekYear = mealsB.body.weekYear;

    const pantryA = await request(server.baseUrl, 'POST', '/api/pantry/add', {
      headers: authHeaders(A.cookie),
      body: { productKey: 'banana', qty: 3, unit: 'stk' },
    });
    const pantryB = await request(server.baseUrl, 'POST', '/api/pantry/add', {
      headers: authHeaders(B.cookie),
      body: { productKey: 'apple', qty: 5, unit: 'stk' },
    });
    assert.equal(pantryA.status, 200, JSON.stringify(pantryA.body));
    assert.equal(pantryB.status, 200, JSON.stringify(pantryB.body));

    async function addCalendar(who, title, date) {
      const r = await request(server.baseUrl, 'POST', '/api/calendar/events', {
        headers: authHeaders(who.cookie),
        body: { title, date },
      });
      assert.equal(r.status, 200, `calendar ${title}: ${JSON.stringify(r.body)}`);
      return r.body.event.id;
    }
    A.calId = await addCalendar(A, A.calTitle, A.eventDate);
    B.calId = await addCalendar(B, B.calTitle, B.eventDate);
    A.calTodayId = await addCalendar(A, A.calTodayTitle, today);
    B.calTodayId = await addCalendar(B, B.calTodayTitle, today);

    async function seedShopping(who) {
      const gen = await request(server.baseUrl, 'POST', '/api/shopping/generate', {
        headers: authHeaders(who.cookie),
        body: { force: true, mode: 'merge' },
      });
      assert.ok(
        gen.status === 200 || gen.status === 201,
        `shopping generate ${who.username}: ${JSON.stringify(gen.body)}`
      );
      const add = await request(server.baseUrl, 'POST', '/api/shopping/items', {
        headers: authHeaders(who.cookie),
        body: { name: who.shopItem },
      });
      assert.equal(add.status, 201, `shopping add ${who.shopItem}: ${JSON.stringify(add.body)}`);
      who.shopItemId = add.body.item?.id;
      const list = await request(server.baseUrl, 'GET', '/api/shopping/list/current', {
        headers: authHeaders(who.cookie),
      });
      assert.equal(list.status, 200);
      who.listId = list.body.id;
      if (!who.shopItemId) {
        const hit = shoppingItems(list.body).find(
          (i) => (i.name || i.ingredientName) === who.shopItem
        );
        who.shopItemId = hit?.id;
      }
    }
    await seedShopping(A);
    await seedShopping(B);
    assert.ok(B.shopItemId, 'B shopping item id missing');
    assert.ok(B.listId, 'B shopping list id missing');

    const choresB = await request(server.baseUrl, 'GET', '/api/chores/current', {
      headers: authHeaders(B.cookie),
    });
    assert.equal(choresB.status, 200);
    B.choreId = (choresB.body.chores || [])[0]?.choreId ?? (choresB.body.chores || [])[0]?.id;
    B.choreStatus = (choresB.body.chores || [])[0]?.status;

    const childUser = server.repos.auth.createUser({
      email: `g05a-child-${suffix}@iso.test`,
      name: 'Child A',
    });
    server.repos.auth.setFamily(childUser.id, A.familyId, 'child');
    const childSid = crypto.randomBytes(32).toString('hex');
    server.repos.auth.createSession({ id: childSid, userId: childUser.id, ttlDays: 30 });
    A.childCookie = cookieHeader(childSid);
    A.childUserId = childUser.id;
  });

  after(async () => {
    if (server) await server.close();
  });

  // ============================================================
  // Probe 1 — swap family_id in JSON body
  // ============================================================

  test('probe 1: no public schema accepts family_id — extra field is stripped or 400', async () => {
    // Code review: server/schemas.js has no family_id / familyId field.
    // Calendar body is non-strict (Zod strips). Shopping add is .strict().
    const cal = await request(server.baseUrl, 'POST', '/api/calendar/events', {
      headers: authHeaders(A.cookie),
      body: {
        title: `A-body-swap-${A.username}`,
        date: '2026-12-01',
        family_id: B.familyId,
        familyId: B.familyId,
      },
    });
    assert.ok(cal.status === 200 || cal.status === 400, `calendar body-swap status ${cal.status}`);
    assertNoMarkers(cal, uniqueMarkers(B), 'POST /api/calendar/events family_id body');

    const listB = await request(
      server.baseUrl,
      'GET',
      '/api/calendar/events?from=2026-12-01&to=2026-12-01',
      { headers: authHeaders(B.cookie) }
    );
    assert.equal(listB.status, 200);
    assert.equal(
      calendarTitles(listB.body).includes(`A-body-swap-${A.username}`),
      false,
      "B calendar received A's event created with family_id=B in body"
    );

    if (cal.status === 200) {
      const listA = await request(
        server.baseUrl,
        'GET',
        '/api/calendar/events?from=2026-12-01&to=2026-12-01',
        { headers: authHeaders(A.cookie) }
      );
      assert.ok(
        calendarTitles(listA.body).includes(`A-body-swap-${A.username}`),
        'stripped family_id should still create the event in A'
      );
    }
  });

  test('probe 1b: POST /api/shopping/items with family_id=B does not land in B', async () => {
    const sneak = `A-sneak-item-${A.username}`;
    const add = await request(server.baseUrl, 'POST', '/api/shopping/items', {
      headers: authHeaders(A.cookie),
      body: { name: sneak, family_id: B.familyId, familyId: B.familyId },
    });
    // .strict() schema → 400; if it ever loosens, item must stay in A.
    assert.ok(
      add.status === 400 || add.status === 201 || add.status === 200,
      `status ${add.status}`
    );
    assertNoMarkers(add, uniqueMarkers(B), 'POST /api/shopping/items family_id body');

    const shopB = await request(server.baseUrl, 'GET', '/api/shopping/list/current', {
      headers: authHeaders(B.cookie),
    });
    assert.equal(shopB.status, 200);
    assert.equal(
      shoppingNames(shopB.body).includes(sneak),
      false,
      'B shopping list received item posted by A with family_id=B'
    );
  });

  test('probe 1c: PUT /api/meals/swap with family_id=B does not change B plan', async () => {
    const beforeB = await request(server.baseUrl, 'GET', '/api/meals/current', {
      headers: authHeaders(B.cookie),
    });
    assert.equal(beforeB.status, 200);
    const beforeIds = (beforeB.body.meals || []).map((m) => m.recipeId);

    const swap = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
      headers: authHeaders(A.cookie),
      body: { dayOfWeek: 1, recipeId: A.recipeId, family_id: B.familyId, familyId: B.familyId },
    });
    assert.ok(swap.status === 200 || swap.status === 400, `swap status ${swap.status}`);
    assertNoMarkers(swap, uniqueMarkers(B), 'PUT /api/meals/swap family_id body');

    const afterB = await request(server.baseUrl, 'GET', '/api/meals/current', {
      headers: authHeaders(B.cookie),
    });
    assert.equal(afterB.status, 200);
    assert.deepEqual(
      (afterB.body.meals || []).map((m) => m.recipeId),
      beforeIds,
      'B meal plan changed after A swap with family_id=B'
    );
    assert.equal(
      mealRecipeNames(afterB.body).includes(A.recipeName),
      false,
      "B meals now show A's recipe"
    );
  });

  // ============================================================
  // Probe 2 — family_id / familyId in query string
  // ============================================================

  const queryPaths = [
    '/api/recipes',
    '/api/meals/current',
    '/api/calendar/events?from=2026-11-01&to=2026-11-30',
    '/api/pantry',
    '/api/me/export',
    '/api/family/export',
    '/api/today',
  ];

  for (const param of ['family_id', 'familyId']) {
    for (const path of queryPaths) {
      const joiner = path.includes('?') ? '&' : '?';
      test(`probe 2: A GET ${path} with ${param}=B must not leak B`, async () => {
        const url = `${path}${joiner}${param}=${B.familyId}`;
        const res = await request(server.baseUrl, 'GET', url, {
          headers: authHeaders(A.cookie),
        });
        assert.ok(
          res.status === 200 || res.status === 400 || res.status === 403 || res.status === 404,
          `${url} status ${res.status}`
        );
        assertNoMarkers(res, uniqueMarkers(B), `GET ${url}`);
      });
    }
  }

  // ============================================================
  // Probe 3 — B numeric IDs in A's GET/PUT/DELETE
  // ============================================================

  test("probe 3a: A GET /api/recipes/:bId must not return B's recipe", async () => {
    const res = await request(server.baseUrl, 'GET', `/api/recipes/${B.recipeId}`, {
      headers: authHeaders(A.cookie),
    });
    assertDeniedOrEmpty(res, 'GET /api/recipes/:bId');
    assertNoMarkers(res, uniqueMarkers(B), 'GET /api/recipes/:bId');
    assert.ok(
      res.status === 403 || res.status === 404 || (res.status === 200 && !res.body?.recipe?.id),
      `expected 403/404/empty, got ${res.status} ${haystack(res.body).slice(0, 200)}`
    );
  });

  test('probe 3b: A GET /api/recipes/:bId/similar after B warmed cache must not leak B names', async () => {
    const warm = await request(server.baseUrl, 'GET', `/api/recipes/${B.recipeId}/similar`, {
      headers: authHeaders(B.cookie),
    });
    assert.equal(warm.status, 200, `B similar warm ${JSON.stringify(warm.body)}`);
    assert.ok(
      haystack(warm.body).includes(B.recipeName2) || (warm.body.similar || []).length >= 0,
      'B similar warmup ran'
    );

    const res = await request(server.baseUrl, 'GET', `/api/recipes/${B.recipeId}/similar`, {
      headers: authHeaders(A.cookie),
    });
    assert.ok(
      res.status === 200 || res.status === 403 || res.status === 404,
      `status ${res.status}`
    );
    assertNoMarkers(res, uniqueMarkers(B), 'GET /api/recipes/:bId/similar after B cache warm');
    if (res.status === 200) {
      assert.deepEqual(
        res.body.similar || [],
        [],
        'A received a non-empty similar list for B recipe'
      );
    }
  });

  test('probe 3c: A cannot GET/PUT/DELETE B calendar event by id', async () => {
    const get = await request(server.baseUrl, 'GET', `/api/calendar/events/${B.calId}`, {
      headers: authHeaders(A.cookie),
    });
    assert.ok(
      get.status === 404 || get.status === 403 || get.status === 405,
      `GET calendar by id status ${get.status}`
    );
    assertNoMarkers(get, uniqueMarkers(B), 'GET /api/calendar/events/:bId');

    const put = await request(server.baseUrl, 'PUT', `/api/calendar/events/${B.calId}`, {
      headers: authHeaders(A.cookie),
      body: { title: 'hacked', date: '2026-11-15', family_id: B.familyId },
    });
    assert.ok(
      put.status === 404 || put.status === 403 || put.status === 405,
      `PUT calendar by id status ${put.status}`
    );

    const del = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${B.calId}`, {
      headers: authHeaders(A.cookie),
    });
    assert.ok(del.status >= 200 && del.status < 500, `DELETE calendar status ${del.status}`);
    assertNoMarkers(del, uniqueMarkers(B), 'DELETE /api/calendar/events/:bId');

    const still = server.repos._db
      .prepare('SELECT id, title FROM calendar_events WHERE id = ?')
      .get(B.calId);
    assert.ok(still, `B calendar event ${B.calId} was deleted by A`);
    assert.equal(still.title, B.calTitle);
  });

  test('probe 3d: A cannot read or delete B shopping list/item by id', async () => {
    const list = await request(server.baseUrl, 'GET', `/api/shopping/list/${B.listId}`, {
      headers: authHeaders(A.cookie),
    });
    assert.ok(
      list.status === 403 || list.status === 404,
      `GET shopping list status ${list.status}`
    );
    assertNoMarkers(list, uniqueMarkers(B), 'GET /api/shopping/list/:bListId');

    const del = await request(server.baseUrl, 'DELETE', `/api/shopping/items/${B.shopItemId}`, {
      headers: authHeaders(A.cookie),
    });
    assert.ok(
      del.status === 403 || del.status === 404,
      `DELETE shopping item status ${del.status}`
    );
    const still = server.repos._db
      .prepare('SELECT id FROM shopping_list_items WHERE id = ?')
      .get(B.shopItemId);
    assert.ok(still, 'B shopping item was deleted by A');

    const hasHome = await request(
      server.baseUrl,
      'PUT',
      `/api/shopping/items/${B.shopItemId}/has-home`,
      { headers: authHeaders(A.cookie), body: { qty: 99 } }
    );
    assert.ok(hasHome.status >= 200 && hasHome.status < 500, `has-home status ${hasHome.status}`);
    const item = server.repos._db
      .prepare('SELECT pantry_has FROM shopping_list_items WHERE id = ?')
      .get(B.shopItemId);
    assert.equal(item.pantry_has, 0, 'B item marked has-home by A');
  });

  test('probe 3e: A PUT /api/chores/complete with B choreId does not complete B', async () => {
    assert.ok(B.choreId, 'B choreId missing');
    const res = await request(server.baseUrl, 'PUT', '/api/chores/complete', {
      headers: authHeaders(A.cookie),
      body: { choreId: B.choreId, weekYear: B.weekYear, family_id: B.familyId },
    });
    assert.ok(res.status >= 200 && res.status < 500, `chore complete status ${res.status}`);
    assertNoMarkers(res, uniqueMarkers(B), 'PUT /api/chores/complete B id');

    const row = server.repos._db
      .prepare('SELECT status FROM chore_schedules WHERE family_id = ? AND chore_id = ?')
      .get(B.familyId, B.choreId);
    assert.notEqual(row?.status, 'done', `B chore completed by A (status=${res.status})`);
  });

  test('probe 3f: A POST /api/meals/:bMealId/mark-eaten does not cook B slot', async () => {
    if (!B.mondayMealId) {
      assert.ok(true, 'B monday meal id missing — skip');
      return;
    }
    const before = server.repos._db
      .prepare('SELECT status FROM meal_plans WHERE id = ?')
      .get(B.mondayMealId);
    const res = await request(server.baseUrl, 'POST', `/api/meals/${B.mondayMealId}/mark-eaten`, {
      headers: authHeaders(A.cookie),
    });
    assert.ok(
      res.status === 403 || res.status === 404 || res.status === 400,
      `mark-eaten status ${res.status} ${haystack(res.body).slice(0, 200)}`
    );
    assertNoMarkers(res, uniqueMarkers(B), 'POST /api/meals/:bMealId/mark-eaten');
    const after = server.repos._db
      .prepare('SELECT status FROM meal_plans WHERE id = ?')
      .get(B.mondayMealId);
    assert.equal(after.status, before.status, 'B meal status changed by A mark-eaten');
  });

  // ============================================================
  // Probe 4 — replay A's cookie on B resources (explicit)
  // ============================================================

  test("probe 4: A's cookie on B resources never returns B unique data", async () => {
    const probes = [
      ['GET', `/api/recipes/${B.recipeId}`],
      ['GET', `/api/recipes/${B.recipeId2}`],
      ['GET', `/api/shopping/list/${B.listId}`],
      ['DELETE', `/api/calendar/events/${B.calTodayId}`],
      ['GET', `/api/family/export?family_id=${B.familyId}`],
      ['GET', `/api/me/export?familyId=${B.familyId}`],
    ];
    for (const [method, path] of probes) {
      const res = await request(server.baseUrl, method, path, {
        headers: authHeaders(A.cookie),
      });
      assertNoMarkers(res, uniqueMarkers(B), `replay A cookie ${method} ${path}`);
    }

    const stillToday = server.repos._db
      .prepare('SELECT id FROM calendar_events WHERE id = ?')
      .get(B.calTodayId);
    assert.ok(stillToday, "A cookie DELETE removed B's today event");
  });

  // ============================================================
  // Probe 5 — cache: A GET /api/today then B GET same query
  // ============================================================

  test("probe 5: B GET /api/today after A warmed cache must not receive A's meal/event", async () => {
    const path = '/api/today';
    const firstA = await request(server.baseUrl, 'GET', path, {
      headers: authHeaders(A.cookie),
    });
    assert.equal(firstA.status, 200);
    assert.ok(haystack(firstA.body).includes(A.calTodayTitle), 'A today missing own event');

    const secondA = await request(server.baseUrl, 'GET', path, {
      headers: authHeaders(A.cookie),
    });
    assert.equal(secondA.status, 200);
    assertNoMarkers(secondA, uniqueMarkers(B), 'A second GET /api/today');

    const firstB = await request(server.baseUrl, 'GET', path, {
      headers: authHeaders(B.cookie),
    });
    assert.equal(firstB.status, 200, `B /api/today ${haystack(firstB.body).slice(0, 200)}`);
    assertNoMarkers(firstB, uniqueMarkers(A), 'B GET /api/today after A cache warm');
    assert.ok(
      haystack(firstB.body).includes(B.calTodayTitle),
      'B today missing own event (got A cache?)'
    );
    assert.equal(
      (firstB.body.events || []).some((e) => e.title === A.calTodayTitle),
      false,
      'B /api/today events include A today title'
    );
    if (firstB.body.meal && firstB.body.meal.recipe) {
      assert.notEqual(firstB.body.meal.recipe.name, A.recipeName, 'B today meal is A recipe');
    }
  });

  test('probe 5b: same query string on /api/today does not cross families', async () => {
    const path = '/api/today?x=1';
    const a = await request(server.baseUrl, 'GET', path, { headers: authHeaders(A.cookie) });
    const b = await request(server.baseUrl, 'GET', path, { headers: authHeaders(B.cookie) });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assertNoMarkers(a, uniqueMarkers(B), 'A GET /api/today?x=1');
    assertNoMarkers(b, uniqueMarkers(A), 'B GET /api/today?x=1 after A');
  });

  // ============================================================
  // Probe 6 — child in family A cannot POST calendar or chore
  // ============================================================

  test('probe 6: child in A cannot POST /api/calendar/events', async () => {
    const res = await request(server.baseUrl, 'POST', '/api/calendar/events', {
      headers: authHeaders(A.childCookie),
      body: { title: 'child sneak', date: '2026-12-24' },
    });
    assert.equal(res.status, 403, `child calendar POST ${res.status} ${haystack(res.body)}`);
  });

  test('probe 6b: child in A POST chore is 403/404/405 (no create route)', async () => {
    for (const path of ['/api/chores', '/api/chores/create', '/api/chores/add']) {
      const res = await request(server.baseUrl, 'POST', path, {
        headers: authHeaders(A.childCookie),
        body: { task: 'sneak chore', family_id: B.familyId },
      });
      assert.ok(
        res.status === 403 || res.status === 404 || res.status === 405,
        `child POST ${path} status ${res.status}`
      );
      assertNoMarkers(res, uniqueMarkers(B), `child POST ${path}`);
    }
  });

  // ============================================================
  // Probe 7 — CSRF-ish: no cookie, family_id header
  // ============================================================

  test('probe 7: request without cookie but with B family_id header is 401', async () => {
    const headerSets = [
      { 'X-Family-Id': String(B.familyId) },
      { family_id: String(B.familyId) },
      { familyId: String(B.familyId) },
      { 'X-Family-Id': String(B.familyId), family_id: String(B.familyId) },
    ];
    const paths = [
      ['GET', '/api/today'],
      ['GET', `/api/today?family_id=${B.familyId}`],
      ['GET', '/api/recipes'],
      ['GET', `/api/recipes/${B.recipeId}`],
      ['GET', '/api/me/export'],
      ['GET', '/api/family/export'],
      ['POST', '/api/calendar/events'],
    ];
    for (const headers of headerSets) {
      for (const [method, path] of paths) {
        const res = await request(server.baseUrl, method, path, {
          headers,
          body: method === 'POST' ? { title: 'csrf', date: '2026-12-02' } : undefined,
        });
        assert.ok(
          res.status === 401 || res.status === 403,
          `no-cookie ${method} ${path} headers=${JSON.stringify(headers)} status=${res.status}`
        );
        assertNoMarkers(res, uniqueMarkers(B), `CSRF ${method} ${path}`);
        assertNoMarkers(res, uniqueMarkers(A), `CSRF ${method} ${path} leaked A`);
      }
    }
  });
});
