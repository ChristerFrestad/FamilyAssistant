// Empirical 2-user tenant-isolation smoke test.
// Simulates two independent browser sessions (via separate cookie jars)
// against a locally running server, each authenticated as a different
// user in a different family. Verifies that data does not leak across.
//
// Christer's requirement (Q4 precision): "to faktiske brukere på to
// faktiske familier som logger inn og bekrefter at de ikke ser
// hverandres data. Ikke bare grønne tester."

const http = require('http');
const { URL } = require('url');

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
          // Extract cookies from Set-Cookie
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

async function login(email) {
  // Start magic-link flow; with MAGIC_LINK_CONSOLE=true the token is
  // visible in server logs. We read the token directly from the DB for
  // the test instead of screen-scraping logs.
  const jar = {};
  const start = await req({
    method: 'POST',
    path: '/api/auth/magic-link/start',
    body: { email },
  });
  if (start.status !== 200) {
    throw new Error(`magic-link start failed: ${start.status} ${JSON.stringify(start.body)}`);
  }

  // Read the token from the DB (simulating "operator copies it from
  // the log"). Uses the same DB the server is running against.
  const Database = require('better-sqlite3');
  const db = new Database(process.env.DB_PATH, { readonly: true });
  const row = db
    .prepare(`SELECT token FROM magic_link_tokens WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
    .get(email);
  db.close();
  if (!row) throw new Error(`no magic-link token for ${email} — is MAGIC_LINK_CONSOLE on?`);

  const verify = await req({
    method: 'GET',
    path: `/api/auth/magic-link/verify?token=${encodeURIComponent(row.token)}`,
  });
  if (verify.status !== 302) {
    throw new Error(`magic-link verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return mergeCookies(jar, verify.setCookies);
}

async function me(cookies) {
  const r = await req({ path: '/api/auth/me', cookies });
  if (r.status !== 200) throw new Error(`/api/auth/me failed: ${r.status}`);
  return r.body;
}

async function createFamily(cookies, name) {
  // The legacy /api/onboarding/create-family endpoint was retired in
  // PR #77 (atomic onboarding). The replacement endpoint also creates
  // the user's first profile-member row and flips
  // onboarding_completed=1 in one transaction, so this script's setup
  // step matches what the v2 SPA does for a real user.
  const r = await req({
    method: 'POST',
    path: '/api/auth/onboarding/complete',
    cookies,
    body: {
      family: { name },
      user: { name: 'E2E user', category: 'adult', portionFactor: 1.0 },
    },
  });
  if (r.status !== 200) {
    throw new Error(`onboarding complete failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  // Preserve the legacy return shape callers expect: { ok, family: {...} }.
  return { ok: r.body.ok, family: r.body.family };
}

async function addPantryItem(cookies, productKey, qty) {
  const r = await req({
    method: 'POST',
    path: '/api/pantry/add',
    cookies,
    body: { productKey, qty, unit: 'stk' },
  });
  if (r.status !== 200) {
    throw new Error(`pantry add failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

async function getPantry(cookies) {
  const r = await req({ path: '/api/pantry', cookies });
  if (r.status !== 200) throw new Error(`pantry get failed: ${r.status}`);
  return r.body;
}

async function main() {
  const results = [];

  // Ensure server is up
  const health = await req({ path: '/health' });
  if (health.status !== 200) throw new Error(`server not ready: ${health.status}`);
  results.push({ step: 'health', pass: true });

  // Create two users via magic-link (each gets a distinct session cookie)
  const userAEmail = `e2e-user-a-${Date.now()}@test.local`;
  const userBEmail = `e2e-user-b-${Date.now()}@test.local`;
  const cookiesA = await login(userAEmail);
  const cookiesB = await login(userBEmail);

  const meA = await me(cookiesA);
  const meB = await me(cookiesB);
  if (!meA.authenticated || meA.user.email !== userAEmail) {
    throw new Error('user A not authenticated as self');
  }
  if (!meB.authenticated || meB.user.email !== userBEmail) {
    throw new Error('user B not authenticated as self');
  }
  if (meA.user.id === meB.user.id) {
    throw new Error('A and B have same user id');
  }
  results.push({
    step: 'two-users-authenticated',
    pass: true,
    userA: meA.user.id,
    userB: meB.user.id,
  });

  // Each user creates a family (must have none prior)
  const famA = await createFamily(cookiesA, 'E2E Family A');
  const famB = await createFamily(cookiesB, 'E2E Family B');
  if (famA.family.id === famB.family.id) {
    throw new Error('A and B ended up in same family');
  }
  results.push({
    step: 'two-families-created',
    pass: true,
    famA: famA.family.id,
    famB: famB.family.id,
  });

  // Re-login to refresh session (family_id is cached on session creation)
  // Sessions DB stores user_id; auth middleware re-reads user.family_id
  // on every request, so no refresh is needed. Skip and proceed.

  // Add distinct pantry items per family
  await addPantryItem(cookiesA, 'banana', 3);
  await addPantryItem(cookiesB, 'apple', 5);
  results.push({ step: 'pantry-items-added', pass: true });

  // The CORE isolation check: each user must see ONLY their family's data.
  const pantryA = await getPantry(cookiesA);
  const pantryB = await getPantry(cookiesB);

  // /api/pantry returns { items: [{ productKey, ... }, ...] }
  const keysA = (pantryA.items || []).map((it) => it.productKey);
  const keysB = (pantryB.items || []).map((it) => it.productKey);

  const aHasBanana = keysA.includes('banana');
  const aHasApple = keysA.includes('apple');
  const bHasApple = keysB.includes('apple');
  const bHasBanana = keysB.includes('banana');

  if (!aHasBanana) throw new Error('FAIL: Family A does NOT see their own banana');
  if (aHasApple) throw new Error(`FAIL: Family A sees FAMILY B's apple. Keys: ${keysA.join(',')}`);
  if (!bHasApple) throw new Error('FAIL: Family B does NOT see their own apple');
  if (bHasBanana)
    throw new Error(`FAIL: Family B sees FAMILY A's banana. Keys: ${keysB.join(',')}`);
  results.push({
    step: 'tenant-isolation-verified',
    pass: true,
    familyA_pantry: keysA,
    familyB_pantry: keysB,
  });

  // DB-level cross-check
  const Database = require('better-sqlite3');
  const db = new Database(process.env.DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT family_id, product_key, qty_remaining FROM inventory WHERE product_key IN ('banana','apple') ORDER BY family_id, product_key`
    )
    .all();
  db.close();

  if (rows.length !== 2) {
    throw new Error(
      `expected 2 rows (one per family), got ${rows.length}: ${JSON.stringify(rows)}`
    );
  }
  const [r1, r2] = rows;
  if (r1.family_id === r2.family_id) {
    throw new Error('DB has both products under same family — isolation broken at storage layer');
  }
  results.push({ step: 'db-level-isolation-verified', pass: true, rows });

  console.log('\n✓ ALL E2E CHECKS PASSED');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('✖ E2E FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
