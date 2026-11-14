'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { parseLibraryIngredient } = require('../server/services/recipe-library/ingredients');
const { matchCatalogKey } = require('../server/services/recipe-library/catalog-match');
const { libraryRecordFromHtml } = require('../server/services/recipe-library/record');
const {
  ingestRecipeLibrary,
  releaseIngestLock,
  assertAllowed,
  USER_AGENT,
  DELAY_MS,
} = require('../server/services/recipe-library/ingest');
const { canonicalRecipeUrl } = require('../server/services/recipe-library/url');
const { enabledSources, SOURCES } = require('../server/services/recipe-library/sources');
const {
  recipeSourcesSyncJob,
  recipeLibraryIngestJob,
  startCronJobs,
  stopCronJobs,
} = require('../server/cron');

const FIXTURES = path.join(__dirname, 'fixtures', 'recipe-library');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

let server;
const realFetch = globalThis.fetch;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createUser(email, role) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(`Family-${email}`)
      .lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { cookie: cookieHeader(sid), userId: user.id };
}

before(async () => {
  server = await startTestServer({ authToken: 'library-ingest-token-0123456789abcd' });
  globalThis.fetch = async () => {
    throw new Error('recipe-library test made a real network call');
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  releaseIngestLock();
  await server.close();
});

test('ingredient lines parse kg and mixed ss/tbsp without guessing', () => {
  const potatoes = parseLibraryIngredient('1.00 kg poteter');
  assert.equal(potatoes.qty, 1);
  assert.equal(potatoes.unit, 'kg');
  assert.equal(potatoes.name, 'poteter');
  const butter = parseLibraryIngredient('2 ss / tbsp smør');
  assert.equal(butter.unit, 'ss');
  assert.equal(butter.name, 'smør');
  const unknown = parseLibraryIngredient('en neve dill');
  assert.equal(unknown.qty, null);
  assert.equal(unknown.unit, null);
  assert.equal(unknown.name, 'en neve dill');
  const half = parseLibraryIngredient('½ dl melk');
  assert.equal(half.qty, 0.5);
  assert.equal(half.unit, 'dl');
  assert.equal(half.name, 'melk');
  const slash = parseLibraryIngredient('1/2 løk');
  assert.equal(slash.qty, 0.5);
  assert.equal(slash.unit, 'stk');
  assert.equal(slash.name, 'løk');
  const range = parseLibraryIngredient('2-3 ss soyasaus');
  assert.equal(range.qty, 2);
  assert.equal(range.unit, 'ss');
  assert.equal(range.name, 'soyasaus');
  const onion = parseLibraryIngredient('1 løk');
  assert.equal(onion.qty, 1);
  assert.equal(onion.unit, 'stk');
  assert.equal(onion.name, 'løk');
  const eggs = parseLibraryIngredient('2 store egg');
  assert.equal(eggs.qty, 2);
  assert.equal(eggs.unit, 'stk');
  assert.equal(eggs.name, 'store egg');
});

test('catalog match is exact or a unique slug, never a longer key', () => {
  const products = server.repos.products.getAllAsMap();
  assert.equal(matchCatalogKey('poteter', products), 'poteter');
  assert.equal(matchCatalogKey('Poteter', products), 'poteter');
  assert.equal(matchCatalogKey('løk', products), 'løk');
  assert.notEqual(matchCatalogKey('løk', products), 'hvitløk');
  assert.equal(matchCatalogKey('noe-helt-ukjent', products), null);
});

test('library HTML keeps no method text and stores structured ingredients', () => {
  for (const file of ['meny.html', 'altasiatisk.html', 'coop.html', 'rema.html']) {
    const html = fixture(file);
    assert.equal(html.includes('recipeInstructions'), true);
    assert.equal(html.includes('description'), true);
    const record = libraryRecordFromHtml(
      html,
      'https://meny.no/oppskrifter/fisk/' + file.replace('.html', ''),
      file,
      server.repos.products.getAllAsMap()
    );
    assert.ok(record);
    const encoded = JSON.stringify(record);
    assert.equal(encoded.includes('recipeInstructions'), false);
    assert.equal(encoded.includes('STEG I PANNEN TIL GYLLEN'), false);
    assert.equal(encoded.includes('EN LANG BESKRIVELSE SOM IKKE SKAL LAGRES'), false);
  }
  const meny = libraryRecordFromHtml(
    fixture('meny.html'),
    'https://meny.no/oppskrifter/fisk/fiskekaker',
    'Meny',
    server.repos.products.getAllAsMap()
  );
  assert.equal(meny.totalTimeMin, 25);
  assert.equal(meny.imageUrl, 'https://meny.no/img/fiskekaker.jpg');
  const potato = meny.ingredients.find((ing) => ing.name === 'poteter');
  assert.equal(potato.productKey, 'poteter');
  const dill = meny.ingredients.find((ing) => ing.rawLine === 'en neve dill');
  assert.equal(dill.productKey, null);
});

test('ingest reads fixture pages, waits per host, and resumes', async () => {
  const recipeUrl = 'https://meny.no/oppskrifter/fisk/fiskekaker';
  const sitemap = `<?xml version="1.0"?><urlset><url><loc>${recipeUrl}</loc></url></urlset>`;
  const calls = [];
  let clock = 0;
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ua: init.headers['User-Agent'], inm: init.headers['If-None-Match'] });
    const body = String(url).endsWith('.xml') ? sitemap : fixture('meny.html');
    return {
      status: 200,
      headers: { get: (name) => (name === 'etag' ? '"meny-1"' : null) },
      text: async () => body,
    };
  };
  const deps = {
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  const first = await ingestRecipeLibrary(server.repos, {
    sourceId: 'meny',
    maxPages: 5,
    ...deps,
  });
  assert.equal(first.stored, 1);
  assert.ok(calls.every((call) => call.ua === USER_AGENT));
  assert.ok(sleeps.every((ms) => ms >= DELAY_MS));
  const row = server.repos.recipeLibrary.getById(
    server.repos._db.prepare('SELECT id FROM recipe_library WHERE canonical_url = ?').get(recipeUrl)
      .id
  );
  assert.equal(row.title, 'Meny fiskekaker');
  const columns = server.repos._db
    .prepare('PRAGMA table_info(recipe_library)')
    .all()
    .map((col) => col.name);
  assert.equal(columns.includes('notes'), false);
  assert.equal(columns.includes('family_id'), false);

  const recipeFetches = () => calls.filter((call) => call.url === recipeUrl).length;
  assert.equal(recipeFetches(), 1);
  await ingestRecipeLibrary(server.repos, { sourceId: 'meny', maxPages: 5, ...deps });
  assert.equal(recipeFetches(), 1);
});

test('a disabled source id is not fetched', async () => {
  let called = false;
  const result = await ingestRecipeLibrary(server.repos, {
    sourceId: 'matprat',
    fetch: async () => {
      called = true;
      throw new Error('disabled source was fetched');
    },
    sleep: async () => {},
    now: () => 0,
  });
  assert.equal(called, false);
  assert.deepEqual(result.sources, []);
  assert.equal(result.stored, 0);
});

test('disabled publishers stay in the config list', () => {
  const enabled = new Set(enabledSources().map((source) => source.id));
  for (const id of ['meny', 'altasiatisk', 'coop', 'rema']) assert.equal(enabled.has(id), true);
  for (const id of ['matprat', 'aperitif', 'godt', 'tine']) assert.equal(enabled.has(id), false);
  assert.equal(SOURCES.length, 8);
});

test('recipe-sources cron still reports a missing family list', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await recipeSourcesSyncJob({ family: {} });
    await recipeLibraryIngestJob(server.repos);
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((line) => line.includes('Recipe-sources') && line.includes('listIds')));
  assert.equal(
    lines.some((line) => line.includes('Recipe-library')),
    false
  );
});

test('the library cron is registered only while ingest is on', () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    startCronJobs(server.repos);
    stopCronJobs();
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((line) => line.includes('Recipe-sources-sync')));
  assert.equal(
    lines.some((line) => line.includes('Recipe-library-ingest')),
    false
  );
});

function ok(body, headers = {}) {
  return {
    status: 200,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] || null,
    },
    text: async () => body,
  };
}

test('urls are canonical and blocked hosts are never fetched', async () => {
  assert.equal(
    canonicalRecipeUrl('https://MENY.no/oppskrifter/fisk/x/?utm_source=a&ref=1'),
    'https://meny.no/oppskrifter/fisk/x'
  );
  assert.equal(canonicalRecipeUrl('http://meny.no/oppskrifter/fisk/x'), null);

  const meny = SOURCES.find((source) => source.id === 'meny');
  const original = meny.sitemapUrl;
  meny.sitemapUrl = 'https://meny.no/index.xml';
  const seen = [];
  let clock = 0;
  try {
    const result = await ingestRecipeLibrary(server.repos, {
      sourceId: 'meny',
      maxPages: 20,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetch: async (url, init) => {
        const target = String(url);
        seen.push(target);
        assert.equal(init.redirect, 'manual');
        assert.ok(init.signal);
        if (target.endsWith('/robots.txt')) {
          return ok('User-agent: *\nDisallow: /\nCrawl-delay: 1\n');
        }
        if (target.endsWith('/index.xml')) {
          return ok(
            '<sitemapindex><sitemap><loc>http://meny.no/bad.xml</loc></sitemap>' +
              '<sitemap><loc>https://evil.example/x.xml</loc></sitemap>' +
              '<sitemap><loc>https://meny.no/recipes.xml</loc></sitemap></sitemapindex>'
          );
        }
        if (target.endsWith('/recipes.xml')) {
          return ok(
            '<urlset><url><loc>https://MENY.no/oppskrifter/fisk/fiskekaker-kanon/?utm_source=x</loc></url>' +
              '<url><loc>https://meny.no/oppskrifter/fisk/hop/</loc></url>' +
              '<url><loc>http://meny.no/oppskrifter/fisk/plain</loc></url>' +
              '<url><loc>https://meny.no/oppskrifter/fisk/neste</loc></url></urlset>'
          );
        }
        if (target.endsWith('/hop')) {
          return {
            status: 302,
            headers: { get: (name) => (name === 'location' ? 'https://evil.example/steal' : null) },
            text: async () => '',
          };
        }
        if (target.endsWith('/neste')) throw new Error('boom');
        return ok(fixture('meny.html'));
      },
    });
    assert.equal(result.stored, 1);
    assert.equal(seen.includes('https://evil.example/x.xml'), false);
    assert.equal(seen.includes('http://meny.no/bad.xml'), false);
    assert.equal(seen.includes('https://evil.example/steal'), false);
    assert.equal(seen.includes('http://meny.no/oppskrifter/fisk/plain'), false);
    const row = server.repos._db
      .prepare('SELECT title FROM recipe_library WHERE canonical_url = ?')
      .get('https://meny.no/oppskrifter/fisk/fiskekaker-kanon');
    assert.equal(row.title, 'Meny fiskekaker');
    const failed = server.repos.recipeLibrary.getFetch('https://meny.no/oppskrifter/fisk/neste');
    assert.match(failed.error, /boom/);
  } finally {
    meny.sitemapUrl = original;
  }
});

test('rema keeps recipe locs and a crawl-delay above 2.5s', async () => {
  const rema = SOURCES.find((source) => source.id === 'rema');
  const original = rema.sitemapUrl;
  rema.sitemapUrl = 'https://www.rema.no/oppskrifter-index.xml';
  const seen = [];
  const sleeps = [];
  let clock = 0;
  try {
    const result = await ingestRecipeLibrary(server.repos, {
      sourceId: 'rema',
      maxPages: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      fetch: async (url) => {
        const target = String(url);
        seen.push(target);
        if (target.endsWith('/robots.txt')) {
          return ok('User-agent: *\nDisallow: /oppskrifter\nCrawl-delay: 5\n');
        }
        if (target.endsWith('/oppskrifter-index.xml')) {
          return ok(
            '<sitemapindex><sitemap><loc>https://www.rema.no/butikker.xml</loc></sitemap>' +
              '<sitemap><loc>https://evil.example/oppskrifter.xml</loc></sitemap>' +
              '<sitemap><loc>https://www.rema.no/oppskrifter.xml</loc></sitemap></sitemapindex>'
          );
        }
        if (target.endsWith('/oppskrifter.xml')) {
          return ok(
            '<urlset><url><loc>https://www.rema.no/butikker/oslo/</loc></url>' +
              '<url><loc>https://www.rema.no/oppskrifter/vegansk/lasagne/</loc></url></urlset>'
          );
        }
        return ok(fixture('rema.html'));
      },
    });
    assert.equal(result.stored, 1);
    assert.equal(seen.includes('https://www.rema.no/butikker.xml'), false);
    assert.equal(seen.includes('https://evil.example/oppskrifter.xml'), false);
    assert.equal(seen.includes('https://www.rema.no/butikker/oslo'), false);
    assert.ok(seen.includes('https://www.rema.no/oppskrifter/vegansk/lasagne'));
    assert.ok(sleeps.some((ms) => ms >= 5000));
  } finally {
    rema.sitemapUrl = original;
  }
});

test('a huge page is stored as an error and the next url still runs', async () => {
  const meny = SOURCES.find((source) => source.id === 'meny');
  const original = meny.sitemapUrl;
  meny.sitemapUrl = 'https://meny.no/cap.xml';
  try {
    let clock = 0;
    const result = await ingestRecipeLibrary(server.repos, {
      sourceId: 'meny',
      maxPages: 10,
      maxBytes: 250,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith('/robots.txt')) return ok('');
        if (target.endsWith('/cap.xml')) {
          return ok(
            '<urlset><url><loc>https://meny.no/oppskrifter/fisk/stor</loc></url>' +
              '<url><loc>https://meny.no/oppskrifter/fisk/liten</loc></url></urlset>'
          );
        }
        if (target.endsWith('/stor')) return ok('x'.repeat(400));
        return ok(
          '<script type="application/ld+json">{"@type":"Recipe","name":"Liten","recipeIngredient":["1 løk"]}</script>'
        );
      },
    });
    assert.equal(result.stored, 1);
    const failed = server.repos.recipeLibrary.getFetch('https://meny.no/oppskrifter/fisk/stor');
    assert.match(failed.error, /too large/);
  } finally {
    meny.sitemapUrl = original;
  }
});

test('one run at a time, and a hung fetch times out', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = ingestRecipeLibrary(server.repos, {
    sourceId: 'meny',
    maxPages: 2,
    sleep: async () => {},
    now: () => 0,
    fetch: async (url) => {
      if (String(url).endsWith('/robots.txt')) return ok('');
      await gate;
      return ok('<urlset></urlset>');
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await ingestRecipeLibrary(server.repos, {
    sourceId: 'meny',
    fetch: async () => {
      throw new Error('overlap');
    },
  });
  assert.equal(second.alreadyRunning, true);
  release();
  const done = await first;
  assert.equal(done.alreadyRunning, undefined);

  const timed = await ingestRecipeLibrary(server.repos, {
    sourceId: 'meny',
    maxPages: 2,
    timeoutMs: 20,
    sleep: async () => {},
    now: () => Date.now(),
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        if (String(url).endsWith('/robots.txt')) {
          resolve(ok(''));
          return;
        }
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  assert.equal(timed.stored, 0);
  const sitemap = server.repos.recipeLibrary.getFetch('https://meny.no/sitemap/recipes.xml');
  assert.match(sitemap.error, /aborted/);
});

test('admin ingest is 401, 403, 409, then 202 in the background', async () => {
  const anon = await request(server.baseUrl, 'POST', '/api/admin/recipe-library/ingest', {
    body: {},
  });
  assert.equal(anon.status, 401);

  const owner = createUser('owner-library@example.com', 'owner');
  const forbidden = await request(server.baseUrl, 'POST', '/api/admin/recipe-library/ingest', {
    headers: { Cookie: owner.cookie },
    body: {},
  });
  assert.equal(forbidden.status, 403);

  server.repos._db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(owner.userId);
  const off = await request(server.baseUrl, 'POST', '/api/admin/recipe-library/ingest', {
    headers: { Cookie: owner.cookie },
    body: {},
  });
  assert.equal(off.status, 409);

  process.env.RECIPE_LIBRARY_INGEST = '1';
  const live = await startTestServer({ authToken: 'library-ingest-on-token-0123456789abcd' });
  try {
    const liveIngest = require('../server/services/recipe-library/ingest');
    const admin = createUserOn(live, 'admin-library@example.com');
    live.repos._db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin.userId);
    assert.equal(liveIngest.holdIngestLock(), true);
    const busy = await request(live.baseUrl, 'POST', '/api/admin/recipe-library/ingest', {
      headers: { Cookie: admin.cookie },
      body: {},
    });
    assert.equal(busy.status, 409);
    liveIngest.releaseIngestLock();

    globalThis.fetch = async () => ok('<urlset></urlset>');
    const accepted = await request(live.baseUrl, 'POST', '/api/admin/recipe-library/ingest', {
      headers: { Cookie: admin.cookie },
      body: {},
    });
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.started, true);
    for (let i = 0; i < 80 && liveIngest.isIngestRunning(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(liveIngest.isIngestRunning(), false);
  } finally {
    delete process.env.RECIPE_LIBRARY_INGEST;
    globalThis.fetch = async () => {
      throw new Error('recipe-library test made a real network call');
    };
    await live.close();
  }
});

function createUserOn(target, email) {
  const fid = Number(
    target.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(`Family-${email}`)
      .lastInsertRowid
  );
  const user = target.repos.auth.createUser({ email, name: email });
  target.repos.auth.setFamily(user.id, fid, 'owner');
  const sid = crypto.randomBytes(32).toString('hex');
  target.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { cookie: cookieHeader(sid), userId: user.id };
}

test('failed fetches and redirect hops count before the next request', async () => {
  const meny = SOURCES.find((source) => source.id === 'meny');
  const original = meny.sitemapUrl;
  meny.sitemapUrl = 'https://meny.no/page-cap.xml';
  const seen = [];
  let clock = 0;
  try {
    const failed = await ingestRecipeLibrary(server.repos, {
      sourceId: 'meny',
      maxPages: 3,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetch: async (url) => {
        const target = String(url);
        seen.push(target);
        if (target.endsWith('/robots.txt')) return ok('');
        if (target.endsWith('/page-cap.xml')) {
          return ok(
            '<urlset><url><loc>https://meny.no/oppskrifter/fisk/en</loc></url>' +
              '<url><loc>https://meny.no/oppskrifter/fisk/to</loc></url></urlset>'
          );
        }
        if (target.endsWith('/en')) throw new Error('fail');
        throw new Error('fetched past the cap: ' + target);
      },
    });
    assert.equal(failed.pages, 3);
    assert.equal(seen.includes('https://meny.no/oppskrifter/fisk/en'), true);
    assert.equal(seen.includes('https://meny.no/oppskrifter/fisk/to'), false);

    seen.length = 0;
    clock = 0;
    meny.sitemapUrl = 'https://meny.no/hop-cap.xml';
    const hopped = await ingestRecipeLibrary(server.repos, {
      sourceId: 'meny',
      maxPages: 3,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetch: async (url) => {
        const target = String(url);
        seen.push(target);
        if (target.endsWith('/robots.txt')) return ok('');
        if (target.endsWith('/hop-cap.xml')) {
          return ok(
            '<urlset><url><loc>https://meny.no/oppskrifter/fisk/start</loc></url></urlset>'
          );
        }
        if (target.endsWith('/start')) {
          return {
            status: 302,
            headers: {
              get: (name) =>
                name === 'location' ? 'https://meny.no/oppskrifter/fisk/landed' : null,
            },
            text: async () => '',
          };
        }
        throw new Error('redirect target was fetched: ' + target);
      },
    });
    assert.equal(hopped.pages, 3);
    assert.equal(seen.includes('https://meny.no/oppskrifter/fisk/landed'), false);
  } finally {
    meny.sitemapUrl = original;
  }
});

test('explicit ports and userinfo are rejected', async () => {
  const meny = SOURCES.find((source) => source.id === 'meny');
  assert.throws(() => assertAllowed(meny, 'https://meny.no:8443/oppskrifter/fisk/x'), /port/);
  assert.throws(() => assertAllowed(meny, 'https://user@meny.no/oppskrifter/fisk/x'), /userinfo/);
  assert.equal(
    canonicalRecipeUrl('https://meny.no:443/oppskrifter/fisk/x'),
    'https://meny.no/oppskrifter/fisk/x'
  );
  assert.equal(canonicalRecipeUrl('https://meny.no:8443/oppskrifter/fisk/x'), null);
  assert.equal(canonicalRecipeUrl('https://user:pw@meny.no/oppskrifter/fisk/x'), null);

  const original = meny.sitemapUrl;
  meny.sitemapUrl = 'https://meny.no/blocked.xml';
  const seen = [];
  let clock = 0;
  try {
    await ingestRecipeLibrary(server.repos, {
      sourceId: 'meny',
      maxPages: 8,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetch: async (url) => {
        const target = String(url);
        seen.push(target);
        if (target.endsWith('/robots.txt')) return ok('');
        if (target.endsWith('/blocked.xml')) {
          return ok(
            '<urlset><url><loc>https://meny.no/oppskrifter/fisk/port</loc></url>' +
              '<url><loc>https://meny.no/oppskrifter/fisk/user</loc></url></urlset>'
          );
        }
        if (target.endsWith('/port')) {
          return {
            status: 302,
            headers: {
              get: (name) => (name === 'location' ? 'https://meny.no:8443/secret' : null),
            },
            text: async () => '',
          };
        }
        return {
          status: 302,
          headers: {
            get: (name) => (name === 'location' ? 'https://user@meny.no/oppskrifter/fisk/x' : null),
          },
          text: async () => '',
        };
      },
    });
    assert.equal(seen.includes('https://meny.no:8443/secret'), false);
    assert.equal(
      seen.some((url) => url.includes('user@')),
      false
    );
  } finally {
    meny.sitemapUrl = original;
  }
});

test('a crawl-delay above 30 seconds skips that source', async () => {
  const meny = SOURCES.find((source) => source.id === 'meny');
  const original = meny.sitemapUrl;
  meny.sitemapUrl = 'https://meny.no/slow.xml';
  const seen = [];
  let clock = 0;
  try {
    const result = await ingestRecipeLibrary(server.repos, {
      sourceId: 'meny',
      maxPages: 5,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      fetch: async (url) => {
        seen.push(String(url));
        return ok('User-agent: *\nCrawl-delay: 31\n');
      },
    });
    assert.equal(result.stored, 0);
    assert.deepEqual(seen, ['https://meny.no/robots.txt']);
  } finally {
    meny.sitemapUrl = original;
  }
});
