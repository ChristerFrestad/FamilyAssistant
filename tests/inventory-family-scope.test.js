'use strict';

// Inventory writes must name family_id. The primary key is (family, product),
// so an update on product_key alone zeroes or edits every family.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { correctQty, removeExpired } = require('../server/services/pantry.service');
const { pantryExpiredJob, shoppingEnrichmentJob, recipeSourcesSyncJob } = require('../server/cron');

let server;

function createFamily(name) {
  return Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(name).lastInsertRowid
  );
}

function qtyOf(familyId, key) {
  const row = server.repos._db
    .prepare(
      'SELECT qty_remaining as qty, expires_est as expires FROM inventory WHERE family_id = ? AND product_key = ?'
    )
    .get(familyId, key);
  return row;
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('correctQty and removeExpired change only the calling family', () => {
  const other = createFamily('Scope Other');
  const key = 'shared-milk';
  runWithFamily(1, () => {
    server.repos.inventory.addPurchase(key, { packSize: 5, unit: 'l' });
  });
  runWithFamily(other, () => {
    server.repos.inventory.addPurchase(key, { packSize: 5, unit: 'l' });
  });
  server.repos._db
    .prepare(`UPDATE inventory SET expires_est = '2000-01-01' WHERE product_key = ?`)
    .run(key);

  runWithFamily(1, () => {
    correctQty(server.repos, { productKey: key, newQty: 1 });
  });
  assert.equal(qtyOf(1, key).qty, 1);
  assert.equal(qtyOf(other, key).qty, 5);

  runWithFamily(1, () => {
    removeExpired(server.repos);
  });
  assert.equal(qtyOf(1, key).qty, 0);
  assert.equal(qtyOf(other, key).qty, 5);
});

test('PUT /api/pantry/expiry does not rewrite another family', async () => {
  const other = createFamily('Expiry Other');
  const key = 'shared-milk';
  runWithFamily(other, () => {
    server.repos.inventory.addPurchase(key, { packSize: 2, unit: 'l' });
  });
  const before = qtyOf(other, key).expires;

  const res = await request(server.baseUrl, 'PUT', '/api/pantry/expiry', {
    body: { productKey: key, expiresAt: '2026-12-01', purchasedAt: '2026-11-01' },
  });
  assert.equal(res.status, 200);
  assert.equal(qtyOf(1, key).expires, '2026-12-01');
  assert.equal(qtyOf(other, key).expires, before);
});

test('pantry expiry job visits every family and logs a missing listIds', async () => {
  const other = createFamily('Expired Job');
  const key = 'shared-milk';
  runWithFamily(other, () => {
    server.repos.inventory.addPurchase(key, { packSize: 4, unit: 'l' });
  });
  server.repos._db
    .prepare(
      `UPDATE inventory SET qty_remaining = 4, expires_est = '2000-01-01' WHERE family_id = ? AND product_key = ?`
    )
    .run(other, key);

  pantryExpiredJob(server.repos);
  assert.equal(qtyOf(other, key).qty, 0);
  assert.equal(qtyOf(1, key).qty, 0);

  const lines = [];
  const orig = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    pantryExpiredJob({ family: {} });
    shoppingEnrichmentJob({ family: null });
    await recipeSourcesSyncJob({ family: {} });
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((line) => line.includes('Pantry-expired') && line.includes('listIds')));
  assert.ok(lines.some((line) => line.includes('Enrichment') && line.includes('listIds')));
  assert.ok(lines.some((line) => line.includes('Recipe-library') && line.includes('off')));
});
