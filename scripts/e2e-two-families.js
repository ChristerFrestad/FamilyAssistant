// Dual-family isolation smoke test via the real password-register path.
// Does NOT scrape magic_link_tokens from SQLite (unlike e2e-tenant-isolation.js).
//
// Prerequisites:
//   - A running FamilyAssistant server (default BASE_URL=http://localhost:17779)
//   - PASSWORD_AUTH_ENABLED=true (default)
//   - PASSWORD_AUTH_OPEN_REGISTER=true — required; register returns 403 otherwise
//
// Usage:
//   node scripts/e2e-two-families.js
//   BASE_URL=http://127.0.0.1:17779 node scripts/e2e-two-families.js
//
// Exits 1 on any cross-family leak.

const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:17779';

function req({ method = 'GET', path, body, cookies = {} }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieStr) headers.Cookie = cookieStr;
    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const r = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks).toString('utf8');
          const parsed = (() => {
            try {
              return buf ? JSON.parse(buf) : null;
            } catch {
              return buf;
            }
          })();
          const setCookies = {};
          const sc = res.headers['set-cookie'] || [];
          for (const line of sc) {
            const [kv] = line.split(';');
            const eq = kv.indexOf('=');
            if (eq > 0) setCookies[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
          }
          resolve({ status: res.statusCode, body: parsed, setCookies, headers: res.headers });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function mergeCookies(jar, setCookies) {
  return { ...jar, ...setCookies };
}

function haystack(body) {
  return JSON.stringify(body);
}

function fail(msg) {
  throw new Error(msg);
}

async function register(username, password, name, email) {
  const r = await req({
    method: 'POST',
    path: '/api/auth/password/register',
    body: { username, password, name, email },
  });
  if (r.status !== 200) {
    fail(`password register failed for ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  if (!r.setCookies.fa_session) {
    fail(`register ${username} did not set fa_session cookie`);
  }
  return mergeCookies({}, r.setCookies);
}

async function onboard(cookies, familyName, userName) {
  const r = await req({
    method: 'POST',
    path: '/api/auth/onboarding/complete',
    cookies,
    body: {
      family: { name: familyName },
      user: { name: userName, category: 'adult', portionFactor: 1.0 },
    },
  });
  if (r.status !== 200) {
    fail(`onboarding complete failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

async function me(cookies) {
  const r = await req({ path: '/api/auth/me', cookies });
  if (r.status !== 200) fail(`/api/auth/me failed: ${r.status}`);
  return r.body;
}

async function addPantry(cookies, productKey, qty) {
  const r = await req({
    method: 'POST',
    path: '/api/pantry/add',
    cookies,
    body: { productKey, qty, unit: 'stk' },
  });
  if (r.status !== 200)
    fail(`pantry add ${productKey} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function getPantry(cookies) {
  const r = await req({ path: '/api/pantry', cookies });
  if (r.status !== 200) fail(`pantry get failed: ${r.status}`);
  return r.body;
}

async function addCalendar(cookies, title, date) {
  const r = await req({
    method: 'POST',
    path: '/api/calendar/events',
    cookies,
    body: { title, date },
  });
  if (r.status !== 200) fail(`calendar add failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.event;
}

async function listCalendar(cookies, from, to) {
  const r = await req({
    path: `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    cookies,
  });
  if (r.status !== 200) fail(`calendar list failed: ${r.status}`);
  return r.body;
}

async function exportMe(cookies) {
  const r = await req({ path: '/api/me/export', cookies });
  if (r.status !== 200) fail(`/api/me/export failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function exportFamily(cookies) {
  const r = await req({ path: '/api/family/export', cookies });
  if (r.status !== 200) fail(`/api/family/export failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function main() {
  const results = [];
  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

  const health = await req({ path: '/health' });
  if (health.status !== 200) fail(`server not ready: ${health.status}`);
  results.push({ step: 'health', pass: true, base: BASE });

  const userA = {
    username: `g0a${suffix}`,
    password: 'secret123',
    name: 'Alice Iso',
    email: `g0a-${suffix}@iso.test`,
    familyName: `Nordseter-A-${suffix}`,
    calTitle: `A-only-PTA-${suffix}`,
  };
  const userB = {
    username: `g0b${suffix}`,
    password: 'secret456',
    name: 'Bjorn Iso',
    email: `g0b-${suffix}@iso.test`,
    familyName: `Lillehammer-B-${suffix}`,
    calTitle: `B-only-Tannlege-${suffix}`,
  };

  const cookiesA = await register(userA.username, userA.password, userA.name, userA.email);
  const cookiesB = await register(userB.username, userB.password, userB.name, userB.email);
  results.push({ step: 'password-register', pass: true });

  const onbA = await onboard(cookiesA, userA.familyName, userA.name);
  const onbB = await onboard(cookiesB, userB.familyName, userB.name);
  if (onbA.family.id === onbB.family.id) fail('A and B ended up in the same family');
  results.push({
    step: 'onboarding-complete',
    pass: true,
    famA: onbA.family.id,
    famB: onbB.family.id,
  });

  const meA = await me(cookiesA);
  const meB = await me(cookiesB);
  if (!meA.authenticated || meA.user.username !== userA.username) {
    fail('user A not authenticated as self');
  }
  if (!meB.authenticated || meB.user.username !== userB.username) {
    fail('user B not authenticated as self');
  }
  if (meA.user.familyId === meB.user.familyId) fail('A and B share familyId on /api/auth/me');
  results.push({
    step: 'distinct-family-ids',
    pass: true,
    familyA: meA.user.familyId,
    familyB: meB.user.familyId,
  });

  await addPantry(cookiesA, 'banana', 3);
  await addPantry(cookiesB, 'apple', 5);
  const pantryA = await getPantry(cookiesA);
  const pantryB = await getPantry(cookiesB);
  const keysA = (pantryA.items || []).map((it) => it.productKey);
  const keysB = (pantryB.items || []).map((it) => it.productKey);
  if (!keysA.includes('banana')) fail('FAIL: Family A does NOT see their own banana');
  if (keysA.includes('apple'))
    fail(`FAIL: Family A sees FAMILY B's apple. Keys: ${keysA.join(',')}`);
  if (!keysB.includes('apple')) fail('FAIL: Family B does NOT see their own apple');
  if (keysB.includes('banana'))
    fail(`FAIL: Family B sees FAMILY A's banana. Keys: ${keysB.join(',')}`);
  results.push({
    step: 'pantry-isolation',
    pass: true,
    familyA_pantry: keysA,
    familyB_pantry: keysB,
  });

  const evA = await addCalendar(cookiesA, userA.calTitle, '2026-11-15');
  const evB = await addCalendar(cookiesB, userB.calTitle, '2026-11-15');
  const listA = await listCalendar(cookiesA, '2026-11-01', '2026-11-30');
  const listB = await listCalendar(cookiesB, '2026-11-01', '2026-11-30');
  const titlesA = (listA.events || []).map((e) => e.title);
  const titlesB = (listB.events || []).map((e) => e.title);
  if (!titlesA.includes(userA.calTitle)) fail('FAIL: Family A missing own calendar title');
  if (titlesA.includes(userB.calTitle)) {
    fail(`FAIL: Family A sees FAMILY B calendar. Titles: ${titlesA.join('|')}`);
  }
  if (!titlesB.includes(userB.calTitle)) fail('FAIL: Family B missing own calendar title');
  if (titlesB.includes(userA.calTitle)) {
    fail(`FAIL: Family B sees FAMILY A calendar. Titles: ${titlesB.join('|')}`);
  }
  results.push({ step: 'calendar-isolation', pass: true });

  const del = await req({
    method: 'DELETE',
    path: `/api/calendar/events/${evB.id}`,
    cookies: cookiesA,
  });
  if (del.status < 200 || del.status >= 500) {
    fail(`cross-delete unexpected status ${del.status}`);
  }
  const listBAfter = await listCalendar(cookiesB, '2026-11-01', '2026-11-30');
  const stillThere = (listBAfter.events || []).some((e) => e.id === evB.id);
  if (!stillThere) fail("FAIL: Family A deleted Family B's calendar event");
  results.push({
    step: 'calendar-cross-delete-blocked',
    pass: true,
    deleteStatus: del.status,
    eventA: evA.id,
    eventB: evB.id,
  });

  const expA = await exportMe(cookiesA);
  const expB = await exportMe(cookiesB);
  const hayA = haystack(expA);
  const hayB = haystack(expB);
  for (const [label, value] of [
    ['B email', userB.email],
    ['B username', userB.username],
    ['B calendar title', userB.calTitle],
    ['B family name', userB.familyName],
  ]) {
    if (hayA.includes(value)) fail(`FAIL: A /api/me/export leaked ${label}=${value}`);
  }
  for (const [label, value] of [
    ['A email', userA.email],
    ['A username', userA.username],
    ['A calendar title', userA.calTitle],
    ['A family name', userA.familyName],
  ]) {
    if (hayB.includes(value)) fail(`FAIL: B /api/me/export leaked ${label}=${value}`);
  }
  results.push({ step: 'me-export-isolation', pass: true });

  const famExpA = await exportFamily(cookiesA);
  const famExpB = await exportFamily(cookiesB);
  const famHayA = haystack(famExpA);
  const famHayB = haystack(famExpB);
  if (famHayA.includes(userB.familyName) || famHayA.includes(userB.email)) {
    fail('FAIL: A /api/family/export leaked B identifiers');
  }
  if (famHayB.includes(userA.familyName) || famHayB.includes(userA.email)) {
    fail('FAIL: B /api/family/export leaked A identifiers');
  }
  results.push({ step: 'family-export-isolation', pass: true });

  const anon = await req({ path: '/api/me/export' });
  if (anon.status !== 401) fail(`unauthenticated /api/me/export expected 401, got ${anon.status}`);
  results.push({ step: 'unauthenticated-export-401', pass: true });

  console.log('\nALL E2E CHECKS PASSED');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('E2E FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
