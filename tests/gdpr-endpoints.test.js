'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');
const { purgeSoftDeletedUsers } = require('../server/auth/gdpr-routes');

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

function seedFamilyExportData(familyId, { recipe, event, member }) {
  runWithFamily(familyId, () => {
    server.repos.family.addMember(familyId, { name: member, category: 'adult' });
    server.repos.recipes.insert({
      name: recipe,
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Salt', qty: 1, unit: 'ts' }],
    });
    server.repos.calendar.insert({
      title: event,
      date: '2026-08-14',
      allDay: true,
    });
  });
}

function assertExportIncludes(body, needles) {
  const raw = JSON.stringify(body);
  for (const n of needles) {
    assert.ok(raw.includes(n), `export should contain ${n}`);
  }
}

function assertExportExcludes(body, needles) {
  const raw = JSON.stringify(body);
  for (const n of needles) {
    assert.ok(!raw.includes(n), `export must not contain ${n}`);
  }
}

before(async () => {
  server = await startTestServer({ authToken: 'gdpr-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

// ============================================================
// GET /api/me/export
// ============================================================

test('GET /api/me/export requires authentication', async () => {
  const r = await request(server.baseUrl, 'GET', '/api/me/export');
  assert.strictEqual(r.status, 401);
});

test('GET /api/me/export returns user + family payload', async () => {
  const owner = createUser('exp-owner@gdpr.test', 'owner', 'Export Fam');
  // Seed a couple of rows so the export has real data to serialise.
  runWithFamily(owner.familyId, () => {
    server.repos.family.addMember(owner.familyId, { name: 'Anna', category: 'adult' });
    server.repos.recipes.insert({
      name: 'GDPR Test Recipe',
      category: 'rask',
      servings: 2,
      ingredients: [{ name: 'Salt', qty: 1, unit: 'ts' }],
    });
  });

  const r = await request(server.baseUrl, 'GET', '/api/me/export', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.exportVersion, 1);
  assert.strictEqual(r.body.user.email, 'exp-owner@gdpr.test');
  assert.strictEqual(r.body.user.role, 'owner');
  assert.strictEqual(r.body.family.family.name, 'Export Fam');
  assert.ok(r.body.family.profileMembers.some((m) => m.name === 'Anna'));
  assert.ok(r.body.family.recipes.some((x) => x.name === 'GDPR Test Recipe'));
});

test('GET /api/me/export masks session ids', async () => {
  const owner = createUser('exp-mask@gdpr.test', 'owner', 'Mask Fam');
  const r = await request(server.baseUrl, 'GET', '/api/me/export', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  const session = r.body.sessions.find(Boolean);
  assert.ok(session);
  assert.ok(session.id.includes('…'), 'session id should be masked');
  assert.ok(!session.id.includes(owner.sid), 'raw session id must not leak');
});

test('GET /api/me/export for user without a family returns only personal data', async () => {
  const user = server.repos.auth.createUser({ email: 'no-fam@gdpr.test', name: 'Nofam' });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  const r = await request(server.baseUrl, 'GET', '/api/me/export', {
    headers: { Cookie: cookieHeader(sid) },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.email, 'no-fam@gdpr.test');
  assert.strictEqual(r.body.family, undefined);
});

test('GET /api/me/export isolates two families over HTTP cookies', async () => {
  const a = createUser('g02-owner-a@iso.test', 'owner', 'G02-Iso-Fam-A-7f3c');
  const b = createUser('g02-owner-b@iso.test', 'owner', 'G02-Iso-Fam-B-9e1d');
  seedFamilyExportData(a.familyId, {
    recipe: 'G02-Iso-Recipe-A-7f3c',
    event: 'G02-Iso-Event-A-7f3c',
    member: 'G02-Iso-Member-A-7f3c',
  });
  seedFamilyExportData(b.familyId, {
    recipe: 'G02-Iso-Recipe-B-9e1d',
    event: 'G02-Iso-Event-B-9e1d',
    member: 'G02-Iso-Member-B-9e1d',
  });

  const ra = await request(server.baseUrl, 'GET', '/api/me/export', {
    headers: { Cookie: a.cookie },
  });
  assert.strictEqual(ra.status, 200);
  assertExportIncludes(ra.body, [
    'G02-Iso-Fam-A-7f3c',
    'G02-Iso-Recipe-A-7f3c',
    'G02-Iso-Event-A-7f3c',
    'g02-owner-a@iso.test',
  ]);
  assertExportExcludes(ra.body, [
    'G02-Iso-Fam-B-9e1d',
    'G02-Iso-Recipe-B-9e1d',
    'G02-Iso-Event-B-9e1d',
    'g02-owner-b@iso.test',
    'G02-Iso-Member-B-9e1d',
  ]);

  const rb = await request(server.baseUrl, 'GET', '/api/me/export', {
    headers: { Cookie: b.cookie },
  });
  assert.strictEqual(rb.status, 200);
  assertExportIncludes(rb.body, [
    'G02-Iso-Fam-B-9e1d',
    'G02-Iso-Recipe-B-9e1d',
    'G02-Iso-Event-B-9e1d',
    'g02-owner-b@iso.test',
  ]);
  assertExportExcludes(rb.body, [
    'G02-Iso-Fam-A-7f3c',
    'G02-Iso-Recipe-A-7f3c',
    'G02-Iso-Event-A-7f3c',
    'g02-owner-a@iso.test',
    'G02-Iso-Member-A-7f3c',
  ]);
});

// Contract: any authenticated family member, including role===child,
// receives the full family payload via /api/me/export (other members'
// emails included). Isolation is family-scoped, not per-child. Tightening
// child scope is residual risk for G4 — do not change here.
test('GET /api/me/export as child stays inside own family (full-family contract)', async () => {
  const a = createUser('g02-child-owner-a@iso.test', 'owner', 'G02-Child-Fam-A-aa11');
  const b = createUser('g02-child-owner-b@iso.test', 'owner', 'G02-Child-Fam-B-bb22');
  seedFamilyExportData(a.familyId, {
    recipe: 'G02-Child-Recipe-A-aa11',
    event: 'G02-Child-Event-A-aa11',
    member: 'G02-Child-Member-A-aa11',
  });
  seedFamilyExportData(b.familyId, {
    recipe: 'G02-Child-Recipe-B-bb22',
    event: 'G02-Child-Event-B-bb22',
    member: 'G02-Child-Member-B-bb22',
  });
  const child = addUserToFamily('g02-child-a@iso.test', 'child', a.familyId);

  const r = await request(server.baseUrl, 'GET', '/api/me/export', {
    headers: { Cookie: child.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.role, 'child');
  assert.strictEqual(r.body.user.email, 'g02-child-a@iso.test');
  assertExportIncludes(r.body, [
    'G02-Child-Fam-A-aa11',
    'G02-Child-Recipe-A-aa11',
    'g02-child-owner-a@iso.test',
  ]);
  assertExportExcludes(r.body, [
    'G02-Child-Fam-B-bb22',
    'G02-Child-Recipe-B-bb22',
    'G02-Child-Event-B-bb22',
    'g02-child-owner-b@iso.test',
    'G02-Child-Member-B-bb22',
  ]);
});

// ============================================================
// DELETE /api/me
// ============================================================

test('DELETE /api/me requires authentication', async () => {
  const r = await request(server.baseUrl, 'DELETE', '/api/me');
  assert.strictEqual(r.status, 401);
});

test('DELETE /api/me blocks owners still attached to a family', async () => {
  const owner = createUser('del-owner@gdpr.test', 'owner', 'Cannot Delete Fam');
  const r = await request(server.baseUrl, 'DELETE', '/api/me', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 403);
  const stillAlive = server.repos.auth.findById(owner.userId);
  assert.ok(stillAlive, 'user must not be soft-deleted when blocked');
});

test('DELETE /api/me soft-deletes adult and drops sessions', async () => {
  const adult = createUser('del-adult@gdpr.test', 'adult', 'Delete Adult Fam');
  const r = await request(server.baseUrl, 'DELETE', '/api/me', {
    headers: { Cookie: adult.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.ok(r.body.hardDeleteAt);
  assert.strictEqual(r.body.graceDays, 30);

  // findById hides soft-deleted users.
  assert.strictEqual(server.repos.auth.findById(adult.userId), null);
  // The row still exists until the purge cron; check via raw DB.
  const row = server.repos._db
    .prepare('SELECT deleted_at FROM users WHERE id = ?')
    .get(adult.userId);
  assert.ok(row.deleted_at);

  // Further requests with the old session are unauthenticated.
  const after = await request(server.baseUrl, 'GET', '/api/auth/me', {
    headers: { Cookie: adult.cookie },
  });
  assert.strictEqual(after.body.authenticated, false);
});

// ============================================================
// Soft-delete purge cron
// ============================================================

test('purgeSoftDeletedUsers hard-deletes after grace window', () => {
  const adult = createUser('purge@gdpr.test', 'adult', 'Purge Fam');
  server.repos.auth.softDelete(adult.userId);
  // Back-date the deleted_at so it is older than the grace window.
  server.repos._db
    .prepare("UPDATE users SET deleted_at = datetime('now', '-60 days') WHERE id = ?")
    .run(adult.userId);

  const result = purgeSoftDeletedUsers(server.repos);
  assert.ok(result.purged >= 1);
  assert.ok(result.ids.includes(adult.userId));

  // Row is gone.
  const row = server.repos._db.prepare('SELECT id FROM users WHERE id = ?').get(adult.userId);
  assert.strictEqual(row, undefined);
});

test('purgeSoftDeletedUsers leaves recently soft-deleted users alone', () => {
  const adult = createUser('recent@gdpr.test', 'adult', 'Recent Fam');
  server.repos.auth.softDelete(adult.userId);
  // deleted_at is "now" — inside the 30-day grace window.
  const before = server.repos._db.prepare('SELECT 1 FROM users WHERE id = ?').get(adult.userId);
  assert.ok(before);

  purgeSoftDeletedUsers(server.repos);

  const after = server.repos._db.prepare('SELECT 1 FROM users WHERE id = ?').get(adult.userId);
  assert.ok(after, 'recently soft-deleted user must survive the purge');
});

// ============================================================
// Privacy policy static file
// ============================================================

test('GET /privacy.html serves the static privacy policy', async () => {
  const r = await request(server.baseUrl, 'GET', '/privacy.html');
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /Personvernerklæring/);
  assert.match(r.raw, /DELETE \/api\/me/);
});
