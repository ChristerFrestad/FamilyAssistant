'use strict';

// Tests for /api/family/export — the dedicated family-only GDPR
// data-portability endpoint added in PR C5. Existing /api/me/export
// already covers user + family in one payload; this endpoint is the
// owner-scoped equivalent for the post-pilot admin UI.
//
// Cross-tenant tests hit the HTTP endpoint with two cookie sessions
// and assert family A's export never contains family B's unique rows.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createUser(server, email, role, familyName) {
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

function addUserToFamily(server, email, role, familyId) {
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, role);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId, userId: user.id, sid, cookie: cookieHeader(sid), email };
}

function seedFamilyExportData(server, familyId, { recipe, event, member }) {
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

describe('/api/family/export', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('returns 401/403 without auth', async () => {
    const r = await request(baseUrl, 'GET', '/api/family/export');
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403 anonymous, got ${r.status}`);
  });

  test('handler module exports the endpoint registration', () => {
    const gdpr = require('../server/auth/gdpr-routes');
    assert.ok(typeof gdpr.registerGdprRoutes === 'function');
  });

  test('HTTP dual-family: owner A export does not contain family B data', async () => {
    const a = createUser(server, 'g02-fam-owner-a@iso.test', 'owner', 'G02-FamExp-A-c4d8');
    const b = createUser(server, 'g02-fam-owner-b@iso.test', 'owner', 'G02-FamExp-B-e5f1');
    seedFamilyExportData(server, a.familyId, {
      recipe: 'G02-FamExp-Recipe-A-c4d8',
      event: 'G02-FamExp-Event-A-c4d8',
      member: 'G02-FamExp-Member-A-c4d8',
    });
    seedFamilyExportData(server, b.familyId, {
      recipe: 'G02-FamExp-Recipe-B-e5f1',
      event: 'G02-FamExp-Event-B-e5f1',
      member: 'G02-FamExp-Member-B-e5f1',
    });

    const ra = await request(baseUrl, 'GET', '/api/family/export', {
      headers: { Cookie: a.cookie },
    });
    assert.equal(ra.status, 200);
    assertExportIncludes(ra.body, [
      'G02-FamExp-A-c4d8',
      'G02-FamExp-Recipe-A-c4d8',
      'G02-FamExp-Event-A-c4d8',
      'g02-fam-owner-a@iso.test',
    ]);
    assertExportExcludes(ra.body, [
      'G02-FamExp-B-e5f1',
      'G02-FamExp-Recipe-B-e5f1',
      'G02-FamExp-Event-B-e5f1',
      'g02-fam-owner-b@iso.test',
      'G02-FamExp-Member-B-e5f1',
    ]);

    const rb = await request(baseUrl, 'GET', '/api/family/export', {
      headers: { Cookie: b.cookie },
    });
    assert.equal(rb.status, 200);
    assertExportIncludes(rb.body, [
      'G02-FamExp-B-e5f1',
      'G02-FamExp-Recipe-B-e5f1',
      'G02-FamExp-Event-B-e5f1',
      'g02-fam-owner-b@iso.test',
    ]);
    assertExportExcludes(rb.body, [
      'G02-FamExp-A-c4d8',
      'G02-FamExp-Recipe-A-c4d8',
      'G02-FamExp-Event-A-c4d8',
      'g02-fam-owner-a@iso.test',
      'G02-FamExp-Member-A-c4d8',
    ]);
  });

  // Owner-only contract — non-owners still use /api/me/export.
  test('GET /api/family/export as non-owner adult returns 403', async () => {
    const owner = createUser(server, 'g02-fam-adult-owner@iso.test', 'owner', 'G02-FamAdult-A');
    const adult = addUserToFamily(server, 'g02-fam-adult@iso.test', 'adult', owner.familyId);
    const r = await request(baseUrl, 'GET', '/api/family/export', {
      headers: { Cookie: adult.cookie },
    });
    assert.equal(r.status, 403);
  });
});
