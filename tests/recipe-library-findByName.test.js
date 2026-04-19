'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startTestServer } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');

// Seeded recipes belong to the default family id 1 (see seed.service.js).
const SEED_FAMILY_ID = 1;

test('recipes.findByName returns exact match (case-insensitive)', async () => {
  const server = await startTestServer();
  try {
    await runWithFamily(SEED_FAMILY_ID, async () => {
      const all = server.repos.recipes.getAll();
      if (all.length === 0) return; // no seeded recipes in this build
      const target = all[0];
      const hit = server.repos.recipes.findByName(target.name.toUpperCase());
      assert.ok(hit, 'should find with uppercase query');
      assert.strictEqual(hit.id, target.id);
    });
  } finally {
    await server.close();
  }
});

test('recipes.findByName returns null for unknown query', async () => {
  const server = await startTestServer();
  try {
    await runWithFamily(SEED_FAMILY_ID, () => {
      const hit = server.repos.recipes.findByName('zzz-does-not-exist-' + Date.now());
      assert.strictEqual(hit, null);
    });
  } finally {
    await server.close();
  }
});

test('recipes.findByName returns null on empty input', async () => {
  const server = await startTestServer();
  try {
    await runWithFamily(SEED_FAMILY_ID, () => {
      assert.strictEqual(server.repos.recipes.findByName(''), null);
      assert.strictEqual(server.repos.recipes.findByName('   '), null);
      assert.strictEqual(server.repos.recipes.findByName(null), null);
    });
  } finally {
    await server.close();
  }
});

test('recipes.findByName does fuzzy LIKE match when exact miss', async () => {
  const server = await startTestServer();
  try {
    await runWithFamily(SEED_FAMILY_ID, () => {
      const all = server.repos.recipes.getAll();
      if (all.length === 0) return;
      const target = all[0];
      const firstWord = target.name.split(/\s+/)[0];
      if (firstWord.length < 3) return;
      const hit = server.repos.recipes.findByName(firstWord);
      assert.ok(hit, `should find via LIKE for first word "${firstWord}"`);
    });
  } finally {
    await server.close();
  }
});
