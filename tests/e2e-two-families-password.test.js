'use strict';

// G0-1: dual-family isolation via the real password-register + onboarding
// path (not magic-link DB scrape). Two families on one SQLite process
// must not see each other's meals, shopping, chores, recipes, calendar,
// pantry, or GDPR export.
//
// Env is set before startTestServer so server/config.js reloads the
// PASSWORD_AUTH_* flags after the helper clears the module cache.

process.env.PASSWORD_AUTH_ENABLED = 'true';
process.env.PASSWORD_AUTH_OPEN_REGISTER = 'true';
process.env.AUTH_TOKEN = 'g0-1-two-family-e2e-token-0123456789abcdef';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

const AUTH_TOKEN = process.env.AUTH_TOKEN;

function cookieHeader(setCookie) {
  if (!setCookie) return '';
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  return raw.map((c) => String(c).split(';')[0]).join('; ');
}

function authHeaders(cookie) {
  return { Cookie: cookie };
}

function leakHaystack(body) {
  return JSON.stringify(body);
}

function assertNoSubstring(haystack, value, label) {
  if (!value) return;
  assert.ok(!haystack.includes(value), label);
}

function pantryKeys(body) {
  return (body.items || []).map((i) => i.productKey);
}

function recipeNames(body) {
  return (body.recipes || []).map((r) => r.name);
}

function mealRecipeNames(body) {
  return (body.meals || []).map((m) => m.recipe && m.recipe.name).filter(Boolean);
}

function calendarTitles(body) {
  return (body.events || []).map((e) => e.title);
}

function shoppingItemNames(body) {
  const fromCats = (body.categories || []).flatMap((c) => c.items || []);
  const fromItems = body.items || [];
  return [...fromCats, ...fromItems].map((i) => i.name || i.ingredientName).filter(Boolean);
}

function choreIds(body) {
  return (body.chores || []).map((c) => c.choreId ?? c.id).filter((id) => id != null);
}

let server;
let A;
let B;

describe(
  'G0-1 two-family password-register isolation',
  { concurrency: false, timeout: 120_000 },
  () => {
    before(async () => {
      process.env.PASSWORD_AUTH_ENABLED = 'true';
      process.env.PASSWORD_AUTH_OPEN_REGISTER = 'true';
      process.env.AUTH_TOKEN = AUTH_TOKEN;

      server = await startTestServer({ authToken: AUTH_TOKEN });

      const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
      const today = new Date().toISOString().slice(0, 10);

      A = {
        username: `g0a${suffix}`,
        password: 'secret123',
        name: 'Alice Iso',
        email: `g0a-${suffix}@iso.test`,
        familyName: `Nordseter-A-${suffix}`,
        recipeName: `A-only-Kyllinggryte-${suffix}`,
        calTitle: `A-only-PTA-${suffix}`,
        calTodayTitle: `A-today-${suffix}`,
        shopItem: `A-only-Kaffe-${suffix}`,
        eventDate: '2026-11-15',
      };
      B = {
        username: `g0b${suffix}`,
        password: 'secret456',
        name: 'Bjorn Iso',
        email: `g0b-${suffix}@iso.test`,
        familyName: `Lillehammer-B-${suffix}`,
        recipeName: `B-only-Fiskesuppe-${suffix}`,
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
        assert.equal(reg.body.ok, true);
        who.cookie = cookieHeader(reg.headers['set-cookie'] || reg.headers['Set-Cookie']);
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
        assert.ok(Number.isInteger(who.familyId) && who.familyId > 0);
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
      assert.equal(meA.body.authenticated, true);
      assert.equal(meB.body.authenticated, true);
      A.familyId = meA.body.user.familyId;
      B.familyId = meB.body.user.familyId;
      A.userId = meA.body.user.id;
      B.userId = meB.body.user.id;
      assert.notEqual(A.familyId, B.familyId, 'A and B must land in different families');
      assert.notEqual(A.userId, B.userId, 'A and B must be different users');
      assert.equal(meA.body.user.username, A.username);
      assert.equal(meB.body.user.username, B.username);

      // Unique recipes via repo insert (no public POST /api/recipes create).
      A.recipeId = runWithFamily(A.familyId, () =>
        server.repos.recipes.insert({
          name: A.recipeName,
          category: 'comfort',
          servings: 4,
        })
      );
      B.recipeId = runWithFamily(B.familyId, () =>
        server.repos.recipes.insert({
          name: B.recipeName,
          category: 'rask',
          servings: 4,
        })
      );
      assert.notEqual(A.recipeId, B.recipeId);

      const swapA = await request(server.baseUrl, 'PUT', '/api/meals/swap', {
        headers: authHeaders(A.cookie),
        body: { dayOfWeek: 0, recipeId: A.recipeId },
      });
      assert.equal(swapA.status, 200, `A meal swap: ${JSON.stringify(swapA.body)}`);

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
      assert.notEqual(A.calId, B.calId);

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
      }
      await seedShopping(A);
      await seedShopping(B);
    });

    after(async () => {
      if (server) await server.close();
    });

    test('GET /api/auth/me shows distinct family ids after password onboarding', async () => {
      const meA = await request(server.baseUrl, 'GET', '/api/auth/me', {
        headers: authHeaders(A.cookie),
      });
      const meB = await request(server.baseUrl, 'GET', '/api/auth/me', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(meA.body.user.familyId, A.familyId);
      assert.equal(meB.body.user.familyId, B.familyId);
      assert.notEqual(meA.body.user.familyId, meB.body.user.familyId);
    });

    test('GET /api/pantry is isolated (A banana not apple; B opposite)', async () => {
      const pantryA = await request(server.baseUrl, 'GET', '/api/pantry', {
        headers: authHeaders(A.cookie),
      });
      const pantryB = await request(server.baseUrl, 'GET', '/api/pantry', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(pantryA.status, 200);
      assert.equal(pantryB.status, 200);
      const keysA = pantryKeys(pantryA.body);
      const keysB = pantryKeys(pantryB.body);
      assert.ok(keysA.includes('banana'), `A missing banana: ${keysA.join(',')}`);
      assert.ok(!keysA.includes('apple'), `A leaked B apple: ${keysA.join(',')}`);
      assert.ok(keysB.includes('apple'), `B missing apple: ${keysB.join(',')}`);
      assert.ok(!keysB.includes('banana'), `B leaked A banana: ${keysB.join(',')}`);
    });

    test("GET /api/meals/current does not leak the other family's unique recipe", async () => {
      const mealsA = await request(server.baseUrl, 'GET', '/api/meals/current', {
        headers: authHeaders(A.cookie),
      });
      const mealsB = await request(server.baseUrl, 'GET', '/api/meals/current', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(mealsA.status, 200);
      assert.equal(mealsB.status, 200);
      const namesA = mealRecipeNames(mealsA.body);
      const namesB = mealRecipeNames(mealsB.body);
      assert.ok(namesA.includes(A.recipeName), `A plan missing own recipe: ${namesA.join('|')}`);
      assert.ok(!namesA.includes(B.recipeName), `A plan leaked B recipe: ${namesA.join('|')}`);
      assert.ok(!namesB.includes(A.recipeName), `B plan leaked A recipe: ${namesB.join('|')}`);
      assertNoSubstring(leakHaystack(mealsB.body), A.recipeName, 'B meals JSON leaked A recipe');
      assertNoSubstring(leakHaystack(mealsA.body), B.recipeName, 'A meals JSON leaked B recipe');
    });

    test('GET /api/today chore IDs are family-scoped; meal/event titles do not leak', async () => {
      const todayA = await request(server.baseUrl, 'GET', '/api/today', {
        headers: authHeaders(A.cookie),
      });
      const todayB = await request(server.baseUrl, 'GET', '/api/today', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(todayA.status, 200);
      assert.equal(todayB.status, 200);

      const hayA = leakHaystack(todayA.body);
      const hayB = leakHaystack(todayB.body);
      assertNoSubstring(hayA, B.recipeName, 'A /api/today leaked B recipe');
      assertNoSubstring(hayA, B.calTodayTitle, 'A /api/today leaked B calendar title');
      assertNoSubstring(hayA, B.familyName, 'A /api/today leaked B family name');
      assertNoSubstring(hayB, A.recipeName, 'B /api/today leaked A recipe');
      assertNoSubstring(hayB, A.calTodayTitle, 'B /api/today leaked A calendar title');
      assertNoSubstring(hayB, A.familyName, 'B /api/today leaked A family name');

      const eventsA = calendarTitles(todayA.body);
      const eventsB = calendarTitles(todayB.body);
      assert.ok(eventsA.includes(A.calTodayTitle), 'A today missing own event');
      assert.ok(!eventsA.includes(B.calTodayTitle), 'A today leaked B event');
      assert.ok(eventsB.includes(B.calTodayTitle), 'B today missing own event');
      assert.ok(!eventsB.includes(A.calTodayTitle), 'B today leaked A event');

      // Chore labels after onboarding are copies of the same seed catalog
      // (same task strings is OK). Isolation is the row identity:
      // family-scoped chore / schedule IDs must not overlap.
      // Labels come from repos.chores (family rows), not seed ids.
      const todayTasksA = (todayA.body.chores || []).map((c) => c.task).filter(Boolean);
      const todayTasksB = (todayB.body.chores || []).map((c) => c.task).filter(Boolean);
      const allTodayTasks = [...todayTasksA, ...todayTasksB];
      assert.ok(
        allTodayTasks.some((t) => t !== '?'),
        "onboarded today chores should include a real task string, not only '?'"
      );
      const idsA = choreIds(todayA.body);
      const idsB = choreIds(todayB.body);
      const todayOverlap = idsA.filter((id) => idsB.includes(id));
      assert.deepEqual(
        todayOverlap,
        [],
        `today chore IDs overlap across families: ${todayOverlap.join(',')}`
      );

      const choresA = await request(server.baseUrl, 'GET', '/api/chores/current', {
        headers: authHeaders(A.cookie),
      });
      const choresB = await request(server.baseUrl, 'GET', '/api/chores/current', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(choresA.status, 200);
      assert.equal(choresB.status, 200);
      assert.ok((choresA.body.chores || []).length > 0, 'A should have seeded chores');
      assert.ok((choresB.body.chores || []).length > 0, 'B should have seeded chores');
      const labeled = [...(choresA.body.chores || []), ...(choresB.body.chores || [])];
      assert.ok(
        labeled.some((c) => typeof c.task === 'string' && c.task !== '?'),
        "chores/current after onboarding must expose a real task, not '?'"
      );
      const cIdsA = choreIds(choresA.body);
      const cIdsB = choreIds(choresB.body);
      const overlap = cIdsA.filter((id) => cIdsB.includes(id));
      assert.deepEqual(overlap, [], `chore IDs overlap across families: ${overlap.join(',')}`);

      const repoIdsA = runWithFamily(A.familyId, () =>
        server.repos.chores.getAll().map((c) => c.id)
      );
      const repoIdsB = runWithFamily(B.familyId, () =>
        server.repos.chores.getAll().map((c) => c.id)
      );
      assert.ok(repoIdsA.length > 0, 'A repo chores empty');
      assert.ok(repoIdsB.length > 0, 'B repo chores empty');
      const repoOverlap = repoIdsA.filter((id) => repoIdsB.includes(id));
      assert.deepEqual(repoOverlap, [], `repo chore IDs overlap: ${repoOverlap.join(',')}`);
    });

    test("GET /api/recipes does not list the other family's unique recipe", async () => {
      const recA = await request(server.baseUrl, 'GET', '/api/recipes', {
        headers: authHeaders(A.cookie),
      });
      const recB = await request(server.baseUrl, 'GET', '/api/recipes', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(recA.status, 200);
      assert.equal(recB.status, 200);
      const namesA = recipeNames(recA.body);
      const namesB = recipeNames(recB.body);
      assert.ok(namesA.includes(A.recipeName), 'A missing own unique recipe');
      assert.ok(!namesA.includes(B.recipeName), `A leaked B recipe: ${namesA.join('|')}`);
      assert.ok(namesB.includes(B.recipeName), 'B missing own unique recipe');
      assert.ok(!namesB.includes(A.recipeName), `B leaked A recipe: ${namesB.join('|')}`);
    });

    test('GET /api/calendar/events titles are isolated', async () => {
      const path = `/api/calendar/events?from=2026-11-01&to=2026-11-30`;
      const calA = await request(server.baseUrl, 'GET', path, {
        headers: authHeaders(A.cookie),
      });
      const calB = await request(server.baseUrl, 'GET', path, {
        headers: authHeaders(B.cookie),
      });
      assert.equal(calA.status, 200);
      assert.equal(calB.status, 200);
      const titlesA = calendarTitles(calA.body);
      const titlesB = calendarTitles(calB.body);
      assert.ok(titlesA.includes(A.calTitle), 'A missing own calendar title');
      assert.ok(!titlesA.includes(B.calTitle), `A leaked B calendar: ${titlesA.join('|')}`);
      assert.ok(titlesB.includes(B.calTitle), 'B missing own calendar title');
      assert.ok(!titlesB.includes(A.calTitle), `B leaked A calendar: ${titlesB.join('|')}`);
    });

    test('GET /api/shopping/list/current items are isolated', async () => {
      const shopA = await request(server.baseUrl, 'GET', '/api/shopping/list/current', {
        headers: authHeaders(A.cookie),
      });
      const shopB = await request(server.baseUrl, 'GET', '/api/shopping/list/current', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(shopA.status, 200);
      assert.equal(shopB.status, 200);
      const namesA = shoppingItemNames(shopA.body);
      const namesB = shoppingItemNames(shopB.body);
      assert.ok(namesA.includes(A.shopItem), `A missing own shop item: ${namesA.join('|')}`);
      assert.ok(!namesA.includes(B.shopItem), `A leaked B shop item: ${namesA.join('|')}`);
      assert.ok(namesB.includes(B.shopItem), `B missing own shop item: ${namesB.join('|')}`);
      assert.ok(!namesB.includes(A.shopItem), `B leaked A shop item: ${namesB.join('|')}`);
    });

    test("GET /api/me/export must not contain the other family's identifiers", async () => {
      const expA = await request(server.baseUrl, 'GET', '/api/me/export', {
        headers: authHeaders(A.cookie),
      });
      const expB = await request(server.baseUrl, 'GET', '/api/me/export', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(expA.status, 200, JSON.stringify(expA.body).slice(0, 400));
      assert.equal(expB.status, 200, JSON.stringify(expB.body).slice(0, 400));

      const hayA = leakHaystack(expA.body);
      const hayB = leakHaystack(expB.body);
      assertNoSubstring(hayA, B.email, 'A me/export leaked B email');
      assertNoSubstring(hayA, B.username, 'A me/export leaked B username');
      assertNoSubstring(hayA, B.recipeName, 'A me/export leaked B recipe');
      assertNoSubstring(hayA, B.calTitle, 'A me/export leaked B calendar title');
      assertNoSubstring(hayA, B.familyName, 'A me/export leaked B family name');
      assertNoSubstring(hayB, A.email, 'B me/export leaked A email');
      assertNoSubstring(hayB, A.username, 'B me/export leaked A username');
      assertNoSubstring(hayB, A.recipeName, 'B me/export leaked A recipe');
      assertNoSubstring(hayB, A.calTitle, 'B me/export leaked A calendar title');
      assertNoSubstring(hayB, A.familyName, 'B me/export leaked A family name');

      assert.ok(hayA.includes(A.recipeName), 'A export missing own recipe');
      assert.ok(hayA.includes(A.familyName), 'A export missing own family name');
      assert.ok(hayB.includes(B.recipeName), 'B export missing own recipe');
      assert.ok(hayB.includes(B.familyName), 'B export missing own family name');
    });

    test('GET /api/family/export as owner is isolated', async () => {
      const expA = await request(server.baseUrl, 'GET', '/api/family/export', {
        headers: authHeaders(A.cookie),
      });
      const expB = await request(server.baseUrl, 'GET', '/api/family/export', {
        headers: authHeaders(B.cookie),
      });
      assert.equal(expA.status, 200, JSON.stringify(expA.body).slice(0, 400));
      assert.equal(expB.status, 200, JSON.stringify(expB.body).slice(0, 400));

      const hayA = leakHaystack(expA.body);
      const hayB = leakHaystack(expB.body);
      assertNoSubstring(hayA, B.email, 'A family/export leaked B email');
      assertNoSubstring(hayA, B.username, 'A family/export leaked B username');
      assertNoSubstring(hayA, B.recipeName, 'A family/export leaked B recipe');
      assertNoSubstring(hayA, B.calTitle, 'A family/export leaked B calendar title');
      assertNoSubstring(hayA, B.familyName, 'A family/export leaked B family name');
      assertNoSubstring(hayB, A.email, 'B family/export leaked A email');
      assertNoSubstring(hayB, A.username, 'B family/export leaked A username');
      assertNoSubstring(hayB, A.recipeName, 'B family/export leaked A recipe');
      assertNoSubstring(hayB, A.calTitle, 'B family/export leaked A calendar title');
      assertNoSubstring(hayB, A.familyName, 'B family/export leaked A family name');
    });

    test("A cannot DELETE B's calendar event; B's event still exists", async () => {
      const del = await request(server.baseUrl, 'DELETE', `/api/calendar/events/${B.calId}`, {
        headers: authHeaders(A.cookie),
      });
      assert.ok(
        del.status === 403 || del.status === 404 || del.status === 200,
        `unexpected cross-delete status ${del.status}: ${JSON.stringify(del.body)}`
      );

      const listB = await request(
        server.baseUrl,
        'GET',
        '/api/calendar/events?from=2026-11-01&to=2026-11-30',
        { headers: authHeaders(B.cookie) }
      );
      assert.equal(listB.status, 200);
      const stillThere = (listB.body.events || []).some((e) => e.id === B.calId);
      assert.ok(stillThere, "B's calendar event was deleted or hidden after A's cross-write");
      assert.ok(
        calendarTitles(listB.body).includes(B.calTitle),
        "B's calendar title disappeared after A's DELETE"
      );
    });

    test('unauthenticated GET /api/me/export is 401', async () => {
      const r = await request(server.baseUrl, 'GET', '/api/me/export');
      assert.equal(r.status, 401);
    });
  }
);
