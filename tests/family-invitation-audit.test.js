'use strict';

// Sprint 9 PR #119 hardening: audit-log entries for the four invitation
// state-changes (sent / accepted / revoked / resent). Each one writes a
// row to audit_log via repos.auditLog.record() with metadata.event set
// to the discriminator the dashboard / oncall view can split on.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');
const { runWithFamily } = require('../server/auth/family-context');

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

function createUnboundUser(server, email) {
  const user = server.repos.auth.createUser({ email, name: email });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { userId: user.id, sid, cookie: cookieHeader(sid) };
}

function readAuditEvents(server, familyId) {
  return runWithFamily(familyId, () => server.repos.auditLog.getRecent(100));
}

describe('Family invitation · audit-log', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('invitation_sent is written when create succeeds', async () => {
    const owner = createOwner(server, 'audit-sent@test.no', 'Audit Sent');
    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'sent-target@test.no', locale: 'no' },
    });
    assert.strictEqual(r.status, 200);
    const events = readAuditEvents(server, owner.familyId);
    const sent = events.find(
      (e) => e.entityType === 'family_invitation' && e.metadata?.event === 'invitation_sent'
    );
    assert.ok(sent, 'expected invitation_sent audit row');
    assert.strictEqual(sent.metadata.event, 'invitation_sent');
    assert.strictEqual(sent.metadata.invitedEmail, 'sent-target@test.no');
    assert.strictEqual(sent.metadata.locale, 'no');
  });

  test('invitation_revoked is written when revoke succeeds', async () => {
    const owner = createOwner(server, 'audit-rev@test.no', 'Audit Rev');
    const created = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'rev-target@test.no', locale: 'no' },
    });
    const invId = created.body.invitation.id;

    const r = await request(server.baseUrl, 'DELETE', `/api/family/invitations/${invId}`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 200);

    const events = readAuditEvents(server, owner.familyId);
    const revoked = events.find(
      (e) => e.entityType === 'family_invitation' && e.metadata?.event === 'invitation_revoked'
    );
    assert.ok(revoked, 'expected invitation_revoked audit row');
    assert.strictEqual(revoked.metadata.event, 'invitation_revoked');
    assert.strictEqual(String(revoked.entityId), String(invId));
  });

  test('invitation_resent is written when resend succeeds', async () => {
    const owner = createOwner(server, 'audit-res@test.no', 'Audit Res');
    const created = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'res-target@test.no', locale: 'no' },
    });
    const invId = created.body.invitation.id;

    // Push expires_at backwards so the cooldown window has elapsed.
    const past = new Date(Date.now() - 61_000).toISOString().replace('T', ' ').slice(0, 19);
    const newExpires = new Date(Date.parse(`${past}Z`) + 7 * 86400_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    server.repos._db
      .prepare('UPDATE family_invitations SET expires_at = ? WHERE id = ?')
      .run(newExpires, invId);

    const r = await request(server.baseUrl, 'POST', `/api/family/invitations/${invId}/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(r.status, 200);

    const events = readAuditEvents(server, owner.familyId);
    const resent = events.find(
      (e) => e.entityType === 'family_invitation' && e.metadata?.event === 'invitation_resent'
    );
    assert.ok(resent, 'expected invitation_resent audit row');
  });

  test('invitation_accepted is written when accept succeeds', async () => {
    const owner = createOwner(server, 'audit-acc@test.no', 'Audit Acc');
    const created = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'acc-target@test.no', locale: 'no' },
    });
    const token = created.body.invitation.token;

    const joiner = createUnboundUser(server, 'acc-target@test.no');
    const r = await request(server.baseUrl, 'POST', `/api/invitations/${token}/accept`, {
      headers: { Cookie: joiner.cookie },
    });
    assert.strictEqual(r.status, 200);

    const events = readAuditEvents(server, owner.familyId);
    const accepted = events.find(
      (e) => e.entityType === 'family_invitation' && e.metadata?.event === 'invitation_accepted'
    );
    assert.ok(accepted, 'expected invitation_accepted audit row');
    assert.strictEqual(accepted.metadata.event, 'invitation_accepted');
    assert.strictEqual(accepted.metadata.acceptedByUserId, joiner.userId);
  });

  test('failed create (validation) does not write an audit row', async () => {
    const owner = createOwner(server, 'audit-fail@test.no', 'Audit Fail');
    const before = readAuditEvents(server, owner.familyId).length;

    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'not-an-email', locale: 'no' },
    });
    assert.strictEqual(r.status, 400);

    const after = readAuditEvents(server, owner.familyId).length;
    assert.strictEqual(after, before, 'failed create must not produce audit rows');
  });
});
