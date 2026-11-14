'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { runWithFamily, getFamilyId } = require('../server/auth/family-context');
const { resolvePantryInput } = require('../server/services/pantry-resolver.service');
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
