'use strict';

// Tests for PR C4: family invitation extension (invited_email column +
// email-delivery best-effort hook).
//
// Existing invitation flow tests live in:
//   - tests/multi-tenant-isolation.test.js
//   - tests/tenant-isolation.test.js
// This file focuses on the new behaviour:
//   - invited_email persists when supplied
//   - invited_email is normalised (trim + lowercase)
//   - createInvitation accepts null email (legacy URL-share flow)
//   - migration 028 column added
//   - cross-tenant: family A's invitation is invisible to family B

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

describe('Family invitation · invited_email column', () => {
  let server;
  let repos;

  before(async () => {
    server = await startTestServer();
    repos = server.repos;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('migration 028 adds invited_email column', () => {
    const cols = repos._db.pragma(`table_info('family_invitations')`);
    const colNames = cols.map((c) => c.name);
    assert.ok(colNames.includes('invited_email'), 'invited_email column should exist');
  });

  test('createInvitation persists invitedEmail when provided', () => {
    const fam = repos.family.createFamily('Frestad-A', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('owner-a@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    const inv = repos.family.createInvitation({
      familyId: fam.id,
      token: 'tok-with-email',
      assignedRole: 'adult',
      invitedBy: userId,
      invitedEmail: '  Member@Example.NO  ',
    });
    assert.strictEqual(inv.invited_email, 'member@example.no');
  });

  test('createInvitation accepts null invitedEmail (legacy flow)', () => {
    const fam = repos.family.createFamily('Frestad-B', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('owner-b@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    const inv = repos.family.createInvitation({
      familyId: fam.id,
      token: 'tok-no-email',
      assignedRole: 'adult',
      invitedBy: userId,
    });
    assert.strictEqual(inv.invited_email, null);
  });
});

describe('Family invitation · cross-tenant isolation (DEL 14)', () => {
  let server;
  let repos;

  before(async () => {
    server = await startTestServer();
    repos = server.repos;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('family A cannot list family B invitations', () => {
    const famA = repos.family.createFamily('FamilyA', 1);
    const famB = repos.family.createFamily('FamilyB', 1);
    const ownerA = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role) VALUES ('a@test', ?, 'owner') RETURNING id`
      )
      .get(famA.id).id;
    const ownerB = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role) VALUES ('b@test', ?, 'owner') RETURNING id`
      )
      .get(famB.id).id;

    repos.family.createInvitation({
      familyId: famA.id,
      token: 'tok-a',
      assignedRole: 'adult',
      invitedBy: ownerA,
      invitedEmail: 'invited-a@test',
    });
    repos.family.createInvitation({
      familyId: famB.id,
      token: 'tok-b',
      assignedRole: 'adult',
      invitedBy: ownerB,
      invitedEmail: 'invited-b@test',
    });

    const aInvites = repos.family.listActiveInvitations(famA.id);
    const bInvites = repos.family.listActiveInvitations(famB.id);

    assert.ok(aInvites.every((i) => i.token === 'tok-a'));
    assert.ok(bInvites.every((i) => i.token === 'tok-b'));
    assert.strictEqual(aInvites.length, 1);
    assert.strictEqual(bInvites.length, 1);
  });

  test('revokeInvitation rejects cross-family revoke attempts', () => {
    const famA = repos.family.createFamily('FamilyA-rev', 1);
    const famB = repos.family.createFamily('FamilyB-rev', 1);
    const ownerA = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role) VALUES ('a-rev@test', ?, 'owner') RETURNING id`
      )
      .get(famA.id).id;
    const inv = repos.family.createInvitation({
      familyId: famA.id,
      token: 'tok-rev',
      assignedRole: 'adult',
      invitedBy: ownerA,
    });
    // Family B tries to revoke family A's invitation
    const ok = repos.family.revokeInvitation(famB.id, inv.id);
    assert.strictEqual(ok, false, 'cross-family revoke should fail');
    // Verify still active for family A
    const aActive = repos.family.listActiveInvitations(famA.id);
    assert.ok(aActive.some((i) => i.token === 'tok-rev'));
  });
});
