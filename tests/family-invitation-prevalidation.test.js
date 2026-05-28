'use strict';

// Sprint 9 PR #119: pre-validation at create-time.
//
// Two new 409 cases:
//   - EMAIL_ALREADY_MEMBER: invited email already attached to a user
//     in the same family
//   - EMAIL_ALREADY_INVITED: invited email already has a pending
//     (non-accepted, non-revoked, non-expired) invitation in the same
//     family
//
// Cross-tenant: a duplicate in family B must NOT block family A.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createOwner(server, email, familyName) {
  const fid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, fid, 'owner');
  server.repos.family.setOwner(fid, user.id);
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

function attachMember(server, familyId, email) {
  const user = server.repos.auth.createUser({ email, name: email });
  server.repos.auth.setFamily(user.id, familyId, 'adult');
  return user.id;
}

describe('Family invitation · pre-validation', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('rejects email already member of family with EMAIL_ALREADY_MEMBER', async () => {
    const owner = createOwner(server, 'pv-owner-1@test', 'Prevalidation One');
    attachMember(server, owner.familyId, 'existing@test.no');

    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'existing@test.no', locale: 'no' },
    });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'EMAIL_ALREADY_MEMBER');
  });

  test('case-insensitive email comparison for already-member check', async () => {
    const owner = createOwner(server, 'pv-owner-case@test', 'Prevalidation Case');
    attachMember(server, owner.familyId, 'mixed@Test.NO');

    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'MIXED@TEST.NO' },
    });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'EMAIL_ALREADY_MEMBER');
  });

  test('rejects duplicate pending invitation with EMAIL_ALREADY_INVITED', async () => {
    const owner = createOwner(server, 'pv-owner-2@test', 'Prevalidation Two');

    const first = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'pending@test.no', locale: 'no' },
    });
    assert.strictEqual(first.status, 200);

    const dup = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'pending@test.no', locale: 'no' },
    });
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.code, 'EMAIL_ALREADY_INVITED');
  });

  test('cross-family duplicate does NOT block (DEL 14 isolation)', async () => {
    const ownerA = createOwner(server, 'pv-a@test', 'PV-A');
    const ownerB = createOwner(server, 'pv-b@test', 'PV-B');

    const first = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: ownerA.cookie },
      body: { role: 'adult', email: 'shared@test.no', locale: 'no' },
    });
    assert.strictEqual(first.status, 200);

    const second = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: ownerB.cookie },
      body: { role: 'adult', email: 'shared@test.no', locale: 'no' },
    });
    assert.strictEqual(second.status, 200);
  });

  test('returns 400 when invitationMessage exceeds 500 chars', async () => {
    const owner = createOwner(server, 'pv-msg@test', 'PV-msg');
    const longMsg = 'x'.repeat(501);
    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: {
        role: 'adult',
        email: 'long-msg@test.no',
        invitationMessage: longMsg,
      },
    });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.detail, /500/);
  });

  test('returns 400 for unsupported locale', async () => {
    const owner = createOwner(server, 'pv-locale@test', 'PV-locale');
    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'fr@test.no', locale: 'fr' },
    });
    assert.strictEqual(r.status, 400);
  });

  test('accepts valid create with message + locale', async () => {
    const owner = createOwner(server, 'pv-ok@test', 'PV-ok');
    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: {
        role: 'adult',
        email: 'NEW@example.no',
        invitationMessage: 'Velkommen!',
        locale: 'no',
      },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.invitation.invitationMessage, 'Velkommen!');
    assert.strictEqual(r.body.invitation.locale, 'no');
    assert.strictEqual(r.body.invitation.invitedEmail, 'new@example.no');
  });

  test('expired invitation is not counted as pending duplicate', () => {
    const owner = createOwner(server, 'pv-expired@test', 'PV-expired');
    const past = '2020-01-01 00:00:00';
    // Migration 030: column is token_hash (SHA-256). Direct INSERT
    // bypasses createInvitation()'s hashing, so we hash the test
    // fixture token here. This row's lookup-via-token is not exercised
    // by this test (only findActiveInvitationByEmail), so any 64-hex
    // string would do — we hash for correctness.
    const { hashInvitationToken } = require('../server/repositories/family.repo');
    server.repos._db
      .prepare(
        `INSERT INTO family_invitations
           (family_id, token_hash, assigned_role, invited_by, expires_at, invited_email, locale)
         VALUES (?, ?, 'adult', ?, ?, 'expired@test.no', 'no')`
      )
      .run(owner.familyId, hashInvitationToken('expired-tok'), owner.userId, past);
    const found = server.repos.family.findActiveInvitationByEmail(
      owner.familyId,
      'expired@test.no'
    );
    assert.strictEqual(found, null);
  });
});
