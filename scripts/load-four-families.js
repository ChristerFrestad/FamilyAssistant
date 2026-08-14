#!/usr/bin/env node
'use strict';

// G5-2: four-family parallel writes against one SQLite process.
//
// Embeds startTestServer so CI does not need a running server.
// Against a live instance: BASE_URL=http://host:7777 node scripts/load-four-families.js
//
// Each family: password register + onboarding, then 20 parallel batches of
//   GET /api/today
//   POST /api/pantry/add or POST /api/shopping/add
//   PUT /api/chores/complete (if /api/chores/current returned a choreId)
//
// Exits 1 on any 5xx or a body containing SQLITE_BUSY.
// Prints { families, requests, errors }.

const crypto = require('crypto');

const FAMILY_COUNT = 4;
const BATCHES_PER_FAMILY = 20;
const EMBEDDED_AUTH_TOKEN = 'g5-2-load-four-families-token-0123456789ab';

function cookieHeader(setCookie) {
  if (!setCookie) return '';
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  return raw.map((c) => String(c).split(';')[0]).join('; ');
}

function haystack(res) {
  const parts = [];
  if (res && res.raw != null) parts.push(String(res.raw));
  if (res && res.body != null) {
    parts.push(typeof res.body === 'string' ? res.body : JSON.stringify(res.body));
  }
  return parts.join('\n');
}

function isLoadError(res) {
  if (!res) return true;
  if (res.status >= 500 || res.status === 0) return true;
  return /SQLITE_BUSY/i.test(haystack(res));
}

function applyEmbeddedEnv() {
  if (!process.env.PASSWORD_AUTH_ENABLED) process.env.PASSWORD_AUTH_ENABLED = 'true';
  if (!process.env.PASSWORD_AUTH_OPEN_REGISTER) process.env.PASSWORD_AUTH_OPEN_REGISTER = 'true';
  if (!process.env.RATE_LIMIT_MAX) process.env.RATE_LIMIT_MAX = '100000';
  if (!process.env.AUTH_RATE_LIMIT_MAX) process.env.AUTH_RATE_LIMIT_MAX = '100000';
}

/**
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] — skip startTestServer when set (or BASE_URL)
 * @param {boolean} [opts.exitOnError] — process.exit(1) when errors > 0
 * @returns {Promise<{ families: number, requests: number, errors: number }>}
 */
async function run(opts = {}) {
  const { startTestServer, request } = require('../tests/helpers');

  const requestedBase = opts.baseUrl || process.env.BASE_URL || '';
  const exitOnError = opts.exitOnError === true;
  let close = null;
  let baseUrl = requestedBase;

  if (!baseUrl) {
    applyEmbeddedEnv();
    const server = await startTestServer({
      authToken: process.env.AUTH_TOKEN || EMBEDDED_AUTH_TOKEN,
    });
    baseUrl = server.baseUrl;
    close = () => server.close();
  }

  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  /** @type {Array<{ index: number, cookie: string, familyId: number|null, choreId: number|null }>} */
  const families = [];
  let requests = 0;
  let errors = 0;

  async function call(method, path, { cookie, body } = {}) {
    let res;
    try {
      res = await request(baseUrl, method, path, {
        headers: cookie ? { Cookie: cookie } : {},
        body,
      });
    } catch (err) {
      res = {
        status: 0,
        body: err && err.message ? err.message : String(err),
        raw: err && err.message ? err.message : String(err),
      };
    }
    requests += 1;
    if (isLoadError(res)) errors += 1;
    return res;
  }

  async function createFamily(index) {
    const username = `g52f${index}${suffix}`;
    const password = 'secret123';
    const name = `LoadFam ${index}`;
    const email = `g52f${index}-${suffix}@load.test`;

    const reg = await call('POST', '/api/auth/password/register', {
      body: { username, password, name, email },
    });
    const cookie = cookieHeader(
      reg.headers && (reg.headers['set-cookie'] || reg.headers['Set-Cookie'])
    );
    if (!cookie || !cookie.includes('fa_session=')) {
      errors += 1;
      return { index, cookie: '', familyId: null, choreId: null };
    }

    const onb = await call('POST', '/api/auth/onboarding/complete', {
      cookie,
      body: {
        family: { name: `Load-Family-${index}-${suffix}` },
        user: { name, category: 'adult', portionFactor: 1.0 },
      },
    });
    const familyId = onb.body && onb.body.family && onb.body.family.id;

    const current = await call('GET', '/api/chores/current', { cookie });
    const chore =
      current.body && Array.isArray(current.body.chores) ? current.body.chores[0] : null;
    const choreId = chore && (chore.choreId ?? chore.id);

    return {
      index,
      cookie,
      familyId: Number.isInteger(familyId) ? familyId : null,
      choreId: Number.isInteger(choreId) ? choreId : null,
    };
  }

  async function oneBatch(family, batchIndex) {
    await call('GET', '/api/today', { cookie: family.cookie });

    if (batchIndex % 2 === 0) {
      await call('POST', '/api/pantry/add', {
        cookie: family.cookie,
        body: { query: `load-milk-${family.index}-${batchIndex}`, qty: 1, unit: 'l' },
      });
    } else {
      await call('POST', '/api/shopping/add', {
        cookie: family.cookie,
        body: { name: `Load-item-${family.index}-${batchIndex}`, quantity: 1 },
      });
    }

    if (family.choreId != null) {
      await call('PUT', '/api/chores/complete', {
        cookie: family.cookie,
        body: { choreId: family.choreId },
      });
    }
  }

  try {
    for (let i = 0; i < FAMILY_COUNT; i += 1) {
      families.push(await createFamily(i));
    }

    const jobs = [];
    for (const family of families) {
      if (!family.cookie) continue;
      for (let b = 0; b < BATCHES_PER_FAMILY; b += 1) {
        jobs.push(oneBatch(family, b));
      }
    }
    await Promise.all(jobs);
  } finally {
    if (close) await close();
  }

  const summary = {
    families: families.filter((f) => f.cookie).length,
    requests,
    errors,
  };
  console.log(JSON.stringify(summary));

  if (exitOnError && errors > 0) {
    process.exit(1);
  }
  return summary;
}

module.exports = { run, FAMILY_COUNT, BATCHES_PER_FAMILY };

if (require.main === module) {
  run({ exitOnError: true }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
