// Integration- og unit-tester for iterasjon 2 (kvittering-ingest).
//
// OCR + LLM er mockable — disse testene hopper over den delen av flyten
// og tester repositories, matching, confirm-flyt og HTTP-ruter direkte.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { startTestServer, request } = require('./helpers');

let server;

before(async () => {
  // Plasser receipts-katalog i tmp så testen ikke skriver til prosjektets data/
  process.env.RECEIPTS_DIR = path.join(os.tmpdir(), 'famtest-receipts-' + Date.now());
  server = await startTestServer();
});

after(async () => {
  if (server) await server.close();
  try {
    fs.rmSync(process.env.RECEIPTS_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ============================================================
// Repositories
// ============================================================

describe('receipts repository', () => {
  test('insert + getBySha er idempotent via UNIQUE', () => {
    const { repos } = server;
    const fakeSha = crypto.createHash('sha256').update('dummy').digest('hex');
    const id = repos.receipts.insert({
      filePath: '/tmp/a.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 100,
      sha256: fakeSha,
      status: 'pending',
    });
    assert.ok(id > 0);
    const fetched = repos.receipts.getBySha(fakeSha);
    assert.ok(fetched);
    assert.equal(fetched.filePath, '/tmp/a.jpg');
  });

  test('updateParsed setter merchant og total', () => {
    const { repos } = server;
    const sha = crypto.createHash('sha256').update('b').digest('hex');
    const id = repos.receipts.insert({
      filePath: '/tmp/b.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 50,
      sha256: sha,
      status: 'pending',
    });
    repos.receipts.updateParsed(id, {
      merchant: 'Kiwi Test',
      purchasedAt: '2026-04-05',
      totalNok: 432.5,
      rawText: 'linjer...',
      llmModel: 'qwen2.5:3b',
      status: 'pending',
    });
    const got = repos.receipts.getById(id);
    assert.equal(got.merchant, 'Kiwi Test');
    assert.equal(got.totalNok, 432.5);
  });

  test('receiptItems.insertMany + getByReceipt', () => {
    const { repos } = server;
    const sha = crypto.createHash('sha256').update('c').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/c.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
    });
    repos.receiptItems.insertMany(rid, [
      { lineText: 'Tine melk 1l', productName: 'Tine melk', qty: 2, unit: 'l', totalPrice: 42.8 },
      { lineText: 'Loff 750g', productName: 'Loff', qty: 1, unit: 'stk', totalPrice: 29.9 },
    ]);
    const items = repos.receiptItems.getByReceipt(rid);
    assert.equal(items.length, 2);
    assert.equal(items[0].productName, 'Tine melk');
    assert.equal(items[1].qty, 1);
  });

  test('markStatus + stats', () => {
    const { repos } = server;
    const sha = crypto.createHash('sha256').update('d').digest('hex');
    const id = repos.receipts.insert({
      filePath: '/tmp/d.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
    });
    repos.receipts.markStatus(id, 'confirmed');
    const got = repos.receipts.getById(id);
    assert.equal(got.status, 'confirmed');
    assert.ok(got.confirmedAt);

    const stats = repos.receipts.stats();
    assert.ok(stats.total >= 1);
    assert.ok(stats.confirmed >= 1);
  });
});

// ============================================================
// Service-utilities (uten LLM/OCR)
// ============================================================

describe('receipt.service utilities', () => {
  test('saveFile er idempotent for samme buffer', () => {
    const { saveFile } = require('../server/services/receipt.service');
    const buf = Buffer.from('hello world');
    const a = saveFile(buf, 'image/jpeg');
    const b = saveFile(buf, 'image/jpeg');
    assert.equal(a.sha256, b.sha256);
    assert.equal(a.filePath, b.filePath);
    assert.ok(fs.existsSync(a.filePath));
  });

  test('matchProductByName finner beste treff', () => {
    const { matchProductByName } = require('../server/services/receipt.service');
    const { repos } = server;
    // Seed-data inneholder f.eks. "melk" — bør matche "Tine lettmelk 1l"
    const match = matchProductByName(repos, 'Tine lettmelk 1l');
    // Kan være null hvis seeden ikke har "melk", men skal ikke kaste.
    assert.ok(typeof match === 'object');
    assert.ok('productKey' in match);
    assert.ok('confidence' in match);
  });

  test('flagSuspiciousItem returnerer unknown_product for manglende key', () => {
    const { flagSuspiciousItem } = require('../server/services/receipt.service');
    const { repos } = server;
    const flagged = flagSuspiciousItem(repos, {
      productKey: null,
      productName: 'Mystisk vare',
      qty: 1,
      totalPrice: 99,
    });
    assert.ok(flagged && flagged.includes('unknown_product'));
  });

  test('flagSuspiciousItem flagger price_mismatch ved eksessiv pris', () => {
    const { flagSuspiciousItem } = require('../server/services/receipt.service');
    const { repos } = server;
    repos.priceReferences.upsert({
      productKey: 'ref-kaffe',
      productName: 'Kaffe 250g',
      currentPrice: 50,
      store: 'Kiwi',
      source: 'seed',
      confidence: 1.0,
    });
    const flagged = flagSuspiciousItem(repos, {
      productKey: 'ref-kaffe',
      productName: 'Kaffe',
      qty: 1,
      totalPrice: 200,
    });
    assert.ok(flagged && flagged.includes('price_mismatch'));
  });
});

// ============================================================
// confirmReceipt flyt
// ============================================================

describe('confirmReceipt', () => {
  test('oppdaterer inventory og markerer items confirmed', () => {
    const { confirmReceipt } = require('../server/services/receipt.service');
    const { repos } = server;

    // 1. Opprett kvittering + items (stub LLM/OCR)
    const sha = crypto.createHash('sha256').update('confirm-test').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/x.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
      merchant: 'Rema 1000',
      purchasedAt: '2026-04-05',
      totalNok: 72.7,
      status: 'pending',
    });
    repos.receiptItems.insertMany(rid, [
      {
        lineText: 'Conf-test ost',
        productKey: 'conf-test-ost',
        productName: 'Ost 500g',
        qty: 1,
        unit: 'stk',
        totalPrice: 72.7,
        confidence: 0.9,
      },
    ]);

    const prevInv = repos.inventory.getByKey('conf-test-ost');
    assert.equal(prevInv, null);

    const result = confirmReceipt(repos, rid);
    assert.equal(result.alreadyConfirmed, false);
    assert.equal(result.inventoryUpdates, 1);
    assert.equal(result.skipped, 0);

    const inv = repos.inventory.getByKey('conf-test-ost');
    assert.ok(inv);
    assert.equal(inv.qtyRemaining, 1);

    const log = repos.inventoryLog.getByKey('conf-test-ost');
    assert.ok(log.some((l) => l.reason === 'receipt'));

    const receipt = repos.receipts.getById(rid);
    assert.equal(receipt.status, 'confirmed');

    // Prisreferansen skal være oppdatert fra kvittering
    const ref = repos.priceReferences.getBest('conf-test-ost');
    assert.ok(ref);
    assert.equal(ref.source, 'receipt');
    assert.ok(Math.abs(ref.currentPrice - 72.7) < 0.01);
  });

  test('hopper over items uten productKey', () => {
    const { confirmReceipt } = require('../server/services/receipt.service');
    const { repos } = server;

    const sha = crypto.createHash('sha256').update('skip-test').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/y.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
      status: 'pending',
    });
    repos.receiptItems.insertMany(rid, [
      { lineText: 'Ukjent', productKey: null, productName: 'Ukjent vare', qty: 1, totalPrice: 10 },
    ]);

    const result = confirmReceipt(repos, rid);
    assert.equal(result.inventoryUpdates, 0);
    assert.equal(result.skipped, 1);
  });

  test('idempotent: repeat confirm returnerer alreadyConfirmed', () => {
    const { confirmReceipt } = require('../server/services/receipt.service');
    const { repos } = server;

    const sha = crypto.createHash('sha256').update('idempotent-test').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/z.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
      status: 'pending',
    });
    repos.receiptItems.insertMany(rid, [
      { lineText: 'A', productKey: 'idem-a', productName: 'A', qty: 1, totalPrice: 5 },
    ]);
    confirmReceipt(repos, rid);
    const second = confirmReceipt(repos, rid);
    assert.equal(second.alreadyConfirmed, true);
  });
});

// ============================================================
// HTTP-ruter
// ============================================================

describe('HTTP: /api/receipts/*', () => {
  test('POST /api/receipts/upload avviser ugyldig MIME', async () => {
    const http = require('http');
    const res = await new Promise((resolve, reject) => {
      const url = new URL(server.baseUrl + '/api/receipts/upload');
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
        },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () =>
            resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() })
          );
        }
      );
      req.on('error', reject);
      req.end('not an image');
    });
    assert.equal(res.status, 400);
  });

  test('GET /api/receipts returnerer listen', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/receipts');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.receipts));
    assert.ok(typeof res.body.stats === 'object');
  });

  test('GET /api/receipts/:id returnerer receipt + items', async () => {
    const { repos } = server;
    const sha = crypto.createHash('sha256').update('http-get').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/http.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
      status: 'pending',
    });
    repos.receiptItems.insertMany(rid, [
      { lineText: 'X', productName: 'X', qty: 1, totalPrice: 10 },
    ]);

    const res = await request(server.baseUrl, 'GET', `/api/receipts/${rid}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.receipt.id, rid);
    assert.equal(res.body.items.length, 1);
  });

  test('GET /api/receipts/:id 404 for ukjent id', async () => {
    const res = await request(server.baseUrl, 'GET', '/api/receipts/999999');
    assert.equal(res.status, 404);
  });

  test('PUT /api/receipts/confirm oppdaterer inventory', async () => {
    const { repos } = server;
    const sha = crypto.createHash('sha256').update('http-confirm').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/httpconf.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
      status: 'pending',
    });
    repos.receiptItems.insertMany(rid, [
      {
        lineText: 'Conf-http',
        productKey: 'conf-http',
        productName: 'Conf',
        qty: 2,
        unit: 'stk',
        totalPrice: 40,
      },
    ]);

    const res = await request(server.baseUrl, 'PUT', '/api/receipts/confirm', {
      body: { receiptId: rid },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.inventoryUpdates, 1);

    const inv = repos.inventory.getByKey('conf-http');
    assert.ok(inv);
    assert.equal(inv.qtyRemaining, 2);
  });

  test('DELETE /api/receipts/:id markerer rejected', async () => {
    const { repos } = server;
    const sha = crypto.createHash('sha256').update('http-delete').digest('hex');
    const rid = repos.receipts.insert({
      filePath: '/tmp/del.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      sha256: sha,
      status: 'pending',
    });
    const res = await request(server.baseUrl, 'DELETE', `/api/receipts/${rid}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'rejected');
    const after = repos.receipts.getById(rid);
    assert.equal(after.status, 'rejected');
  });
});
