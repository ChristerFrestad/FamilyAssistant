'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily, getFamilyId } = require('../server/auth/family-context');
const {
  resolvePantryInput,
  resolveOrCreate,
} = require('../server/services/pantry-resolver.service');
const { shoppingEnrichmentJob } = require('../server/cron');

let server;

function createFamily(name) {
  return Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('inventory-log suggestions stay inside the family and use logged_at', () => {
  const other = createFamily('Log other');
  const key = 'history-only-item';
  runWithFamily(1, () => {
    server.repos.inventoryLog.insert({
      productKey: key,
      qtyDelta: 1,
      newQty: 1,
      unit: 'stk',
      reason: 'correction',
      notes: 'home',
    });
  });
  runWithFamily(other, () => {
    server.repos.inventoryLog.insert({
      productKey: key,
      qtyDelta: 1,
      newQty: 1,
      unit: 'stk',
      reason: 'correction',
      notes: 'other',
    });
    server.repos.inventoryLog.insert({
      productKey: key,
      qtyDelta: 1,
      newQty: 2,
      unit: 'stk',
      reason: 'correction',
      notes: 'other-again',
    });
  });

  const mine = runWithFamily(1, () => resolvePantryInput(server.repos, key));
  const hit = mine.find((row) => row.productKey === key);
  assert.ok(hit, 'family 1 should see its own log row');
  assert.equal(hit.frequency, 1);

  const theirs = runWithFamily(other, () => resolvePantryInput(server.repos, key));
  const theirHit = theirs.find((row) => row.productKey === key);
  assert.ok(theirHit);
  assert.equal(theirHit.frequency, 2);
});

test('løk is not resolved to hvitløk from a history substring', async () => {
  runWithFamily(1, () => {
    server.repos.inventoryLog.insert({
      productKey: 'hvitløk',
      qtyDelta: 1,
      newQty: 1,
      unit: 'stk',
      reason: 'correction',
      notes: 'garlic',
    });
    server.repos.inventoryLog.insert({
      productKey: 'hvitlok',
      qtyDelta: 1,
      newQty: 1,
      unit: 'stk',
      reason: 'correction',
      notes: 'garlic-slug',
    });
  });

  const suggestions = runWithFamily(1, () => resolvePantryInput(server.repos, 'løk'));
  assert.ok(
    suggestions.some((row) => row.productKey === 'hvitløk'),
    'history still offers hvitløk as a suggestion'
  );

  const exact = runWithFamily(1, () => resolveOrCreate(server.repos, 'løk'));
  assert.equal(exact.productKey, 'løk');
  assert.notEqual(exact.productKey, 'hvitløk');

  // The log search matches %lok% inside hvitlok and ranks it above
  // "create new". Saving must still create lok.
  const slugSuggestions = runWithFamily(1, () => resolvePantryInput(server.repos, 'lok'));
  const slugNew = slugSuggestions.find((row) => row.source === 'ny');
  const slugGarlic = slugSuggestions.find((row) => row.productKey === 'hvitlok');
  assert.ok(slugNew);
  assert.ok(slugGarlic);
  assert.ok(slugSuggestions.indexOf(slugGarlic) < slugSuggestions.indexOf(slugNew));

  const slug = runWithFamily(1, () => resolveOrCreate(server.repos, 'lok'));
  assert.equal(slug.source, 'ny');
  assert.equal(slug.productKey, 'lok');
  assert.notEqual(slug.productKey, 'hvitlok');

  const added = await request(server.baseUrl, 'POST', '/api/pantry/add', {
    body: { query: 'lok', qty: 1, total: 1 },
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.resolved.productKey, 'lok');
  assert.notEqual(added.body.resolved.productKey, 'hvitlok');
  assert.equal(added.body.item.productKey, 'lok');
});

test('shopping enrichment visits families one after another', async () => {
  createFamily('Enrich B');
  const ids = server.repos.family.listIds();
  let inFlight = 0;
  let maxInFlight = 0;
  const seen = [];
  await shoppingEnrichmentJob(server.repos, {
    enrich: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(getFamilyId());
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return [];
    },
  });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(seen, ids);
});

test('shopping enrichment logs when family.listIds is missing', async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await shoppingEnrichmentJob({ family: {} });
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((line) => line.includes('listIds')));
});

test('shopping enrichment does not start a second run while the first is in progress', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let overlapped = 0;
  const first = shoppingEnrichmentJob(server.repos, {
    enrich: async () => {
      await gate;
      return [];
    },
  });
  await shoppingEnrichmentJob(server.repos, {
    enrich: async () => {
      overlapped += 1;
      return [];
    },
  });
  assert.equal(overlapped, 0);
  release();
  await first;
  assert.equal(overlapped, 0);
});
