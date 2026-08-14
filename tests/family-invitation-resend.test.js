'use strict';

// Sprint 9 PR #119: POST /api/family/invitations/:id/resend.
//
// Resend rotates the token (so the previous link stops working) and
// extends expires_at. invited_email, invitation_message and locale are
// reused — owner intent is "send the same invite again".

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

async function createInvitation(server, owner, body) {
  const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
    body: { role: 'adult', locale: 'no', ...body },
  });
  assert.strictEqual(r.status, 200, `create returned ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.invitation;
}

// PR #119 introduced a 60-second resend cooldown anchored on
// expires_at - INVITE_TTL_DAYS (which equals create-or-last-resend
// time). Tests that exercise resend right after create must push
// expires_at backwards so cooldown has elapsed.
function bypassResendCooldown(server, invitationId) {
  const past = new Date(Date.now() - 61_000).toISOString().replace('T', ' ').slice(0, 19);
  const newExpires = new Date(Date.parse(`${past}Z`) + 7 * 86400_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  server.repos._db
    .prepare('UPDATE family_invitations SET expires_at = ? WHERE id = ?')
    .run(newExpires, invitationId);
}

describe('Family invitation · resend', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('resend rotates the token and returns the new URL', async () => {
    const owner = createOwner(server, 'rs-1@test.no', 'Resend One');
    const inv = await createInvitation(server, owner, {
      email: 'rs-target-1@test.no',
      invitationMessage: 'Velkommen!',
    });
    bypassResendCooldown(server, inv.id);

    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 200);
    assert.notStrictEqual(r.body.invitation.token, inv.token);
    assert.match(r.body.invitation.url, /\/invite\//);
    assert.strictEqual(r.body.invitation.invitationMessage, 'Velkommen!');
    assert.strictEqual(r.body.invitation.locale, 'no');
  });

  test('old token stops resolving after resend', async () => {
    const owner = createOwner(server, 'rs-2@test.no', 'Resend Two');
    const inv = await createInvitation(server, owner, { email: 'rs-target-2@test.no' });
    const oldToken = inv.token;
    bypassResendCooldown(server, inv.id);

    await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: owner.cookie },
    });

    const before = server.repos.family.findInvitationByToken(oldToken);
    assert.strictEqual(before, null, 'old token should no longer resolve');
  });

  test('resend extends expires_at forward', async () => {
    const owner = createOwner(server, 'rs-3@test.no', 'Resend Three');
    const inv = await createInvitation(server, owner, { email: 'rs-target-3@test.no' });

    // Walk the row's expires_at backwards by 6 days so we can detect
    // that resend pushes it forward.
    const past = new Date(Date.now() - 6 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    server.repos._db
      .prepare('UPDATE family_invitations SET expires_at = ? WHERE id = ?')
      .run(past, inv.id);

    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 200);
    const newExpiresAt = r.body.invitation.expiresAt;
    assert.ok(
      Date.parse(`${newExpiresAt.replace(' ', 'T')}Z`) > Date.now() + 5 * 86400000,
      'expires_at should be at least 5 days in the future after resend'
    );
  });

  test('resend rejected on accepted invitation (409 INVITATION_ACCEPTED)', async () => {
    const owner = createOwner(server, 'rs-4@test.no', 'Resend Four');
    const inv = await createInvitation(server, owner, { email: 'rs-target-4@test.no' });
    server.repos._db
      .prepare(
        `UPDATE family_invitations SET accepted_at = datetime('now'), accepted_by = ? WHERE id = ?`
      )
      .run(owner.userId, inv.id);

    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'INVITATION_ACCEPTED');
  });

  test('resend rejected on revoked invitation (409 INVITATION_REVOKED)', async () => {
    const owner = createOwner(server, 'rs-5@test.no', 'Resend Five');
    const inv = await createInvitation(server, owner, { email: 'rs-target-5@test.no' });
    await request(server.baseUrl, 'DELETE', `/api/family/invitations/${inv.id}`, {
      headers: { Cookie: owner.cookie },
    });
    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'INVITATION_REVOKED');
  });

  test('cross-family resend returns 404 (DEL 14 isolation)', async () => {
    const ownerA = createOwner(server, 'rs-a@test.no', 'Resend-A');
    const ownerB = createOwner(server, 'rs-b@test.no', 'Resend-B');
    const inv = await createInvitation(server, ownerA, { email: 'rs-cross@test.no' });

    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: ownerB.cookie },
    });
    assert.strictEqual(r.status, 404);
    // Verify A's invitation is untouched
    const aList = await request(server.baseUrl, 'GET', '/api/family/invitations', {
      headers: { Cookie: ownerA.cookie },
    });
    assert.strictEqual(aList.status, 200);
    const aInv = aList.body.invitations.find((i) => i.id === inv.id);
    assert.ok(aInv, 'A still owns the invitation');
    // Migration 030: listActive no longer exposes `token` (sha256-
    // hashed at rest). The "B did not rotate A's token" guarantee is
    // instead enforced by the resend route returning 404 to B above
    // — if B's resend had succeeded the route would have returned
    // the rotated token in its 200 response.
    assert.strictEqual(aInv.token, undefined, 'token must not leak in listing');
  });

  test('non-owner adult cannot resend', async () => {
    const owner = createOwner(server, 'rs-owner-7@test.no', 'Resend Seven');
    const inv = await createInvitation(server, owner, { email: 'rs-target-7@test.no' });

    // Add an adult member to the same family
    const adult = server.repos.auth.createUser({ email: 'rs-adult-7@test.no', name: 'Adult' });
    server.repos.auth.setFamily(adult.id, owner.familyId, 'adult');
    const sid = crypto.randomBytes(32).toString('hex');
    server.repos.auth.createSession({ id: sid, userId: adult.id, ttlDays: 30 });
    const adultCookie = cookieHeader(sid);

    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${inv.id}/resend`, {
      headers: { Cookie: adultCookie },
    });
    assert.strictEqual(r.status, 403);
  });

  test('returns 404 for non-existent invitation id', async () => {
    const owner = createOwner(server, 'rs-404@test.no', 'Resend 404');
    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/999999/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 404);
  });

  test('returns 400 for invalid invitation id', async () => {
    const owner = createOwner(server, 'rs-bad@test.no', 'Resend Bad');
    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/abc/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 400);
  });
});
