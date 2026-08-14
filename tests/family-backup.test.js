'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

let server;

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createUser(email, role, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, role);
  if (role === 'owner') server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid), email };
}

function addUserToFamily(email, role, familyId) {
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, role);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId, userId: user.id, sid, cookie: cookieHeader(sid), email };
}

before(async () => {
  server = await startTestServer({ authToken: 'g4-backup-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

test('GET /api/family/backup is owner-only JSON schemaVersion 2', async () => {
  const owner = createUser('backup-owner@g4.test', 'owner', 'Backup Owner Fam');
  runWithFamily(owner.familyId, () => {
    server.repos.family.addMember(owner.familyId, { name: 'Backup-Member-A', category: 'adult' });
    server.repos.recipes.insert({
      name: 'Backup-Recipe-A',
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Salt', qty: 1, unit: 'ts' }],
    });
  });

  const r = await request(server.baseUrl, 'GET', '/api/family/backup', {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.schemaVersion, 2);
  assert.equal(r.body.family.name, 'Backup Owner Fam');
  assert.equal(r.body.family.id, undefined);
  assert.ok(r.body.recipes.some((x) => x.name === 'Backup-Recipe-A'));
  assert.ok(r.body.members.some((m) => m.name === 'Backup-Member-A'));
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes('password_hash'));
  assert.ok(!raw.includes('llm'));
  assert.ok(!/session/i.test(raw) || !raw.includes(owner.sid));
});

test('GET /api/family/backup rejects child with 403', async () => {
  const owner = createUser('backup-child-owner@g4.test', 'owner', 'Backup Child Fam');
  const child = addUserToFamily('backup-child@g4.test', 'child', owner.familyId);
  const r = await request(server.baseUrl, 'GET', '/api/family/backup', {
    headers: { Cookie: child.cookie },
  });
  assert.equal(r.status, 403);
});

test('family A backup does not contain family B names', async () => {
  const a = createUser('backup-iso-a@g4.test', 'owner', 'Backup-Iso-Fam-A');
  const b = createUser('backup-iso-b@g4.test', 'owner', 'Backup-Iso-Fam-B');
  runWithFamily(a.familyId, () => {
    server.repos.family.addMember(a.familyId, { name: 'Iso-Member-A-only', category: 'adult' });
    server.repos.recipes.insert({
      name: 'Iso-Recipe-A-only',
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Salt', qty: 1, unit: 'ts' }],
    });
  });
  runWithFamily(b.familyId, () => {
    server.repos.family.addMember(b.familyId, { name: 'Iso-Member-B-secret', category: 'adult' });
    server.repos.recipes.insert({
      name: 'Iso-Recipe-B-secret',
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Pepper', qty: 1, unit: 'ts' }],
    });
  });

  const r = await request(server.baseUrl, 'GET', '/api/family/backup', {
    headers: { Cookie: a.cookie },
  });
  assert.equal(r.status, 200);
  const raw = JSON.stringify(r.body);
  assert.ok(raw.includes('Iso-Member-A-only'));
  assert.ok(raw.includes('Iso-Recipe-A-only'));
  assert.ok(!raw.includes('Iso-Member-B-secret'));
  assert.ok(!raw.includes('Iso-Recipe-B-secret'));
  assert.ok(!raw.includes('Backup-Iso-Fam-B'));
});

test('POST /api/family/backup/import merge remaps recipe ids', async () => {
  const source = createUser('backup-src@g4.test', 'owner', 'Backup Source Fam');
  const dest = createUser('backup-dst@g4.test', 'owner', 'Backup Dest Fam');

  const sourceRecipeId = runWithFamily(source.familyId, () =>
    Number(
      server.repos.recipes.insert({
        name: 'Remap-Me-Recipe',
        category: 'rask',
        servings: 2,
        ingredients: [{ name: 'Salt', qty: 1, unit: 'ts' }],
      })
    )
  );

  const downloaded = await request(server.baseUrl, 'GET', '/api/family/backup', {
    headers: { Cookie: source.cookie },
  });
  assert.equal(downloaded.status, 200);
  const payload = downloaded.body;
  const exported = payload.recipes.find((x) => x.name === 'Remap-Me-Recipe');
  assert.ok(exported);
  assert.equal(exported.id, sourceRecipeId);

  const rejected = await request(server.baseUrl, 'POST', '/api/family/backup/import', {
    headers: { Cookie: dest.cookie },
    body: {
      mode: 'merge',
      payload: {
        ...payload,
        family: { id: source.familyId, name: payload.family.name },
      },
    },
  });
  assert.equal(rejected.status, 400);

  const imported = await request(server.baseUrl, 'POST', '/api/family/backup/import', {
    headers: { Cookie: dest.cookie },
    body: { mode: 'merge', payload },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.ok, true);

  const destRecipes = runWithFamily(dest.familyId, () =>
    server.repos.recipes.getAll({ includeInactive: true })
  );
  const copy = destRecipes.find((x) => x.name === 'Remap-Me-Recipe');
  assert.ok(copy, 'imported recipe should exist in dest family');
  assert.notEqual(copy.id, sourceRecipeId, 'recipe id must be remapped');
});
