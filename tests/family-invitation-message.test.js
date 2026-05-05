'use strict';

// Sprint 9 PR #119: invitation_message column on family_invitations.
//
// Verifies that the new optional personal-greeting field round-trips
// through createInvitation → findInvitationByToken → listActiveInvitations
// and that the repo enforces the 500-character cap independently of the
// route-layer cap (defence in depth).

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

describe('Family invitation · invitation_message', () => {
  let server;
  let repos;

  before(async () => {
    server = await startTestServer();
    repos = server.repos;
  });

  after(async () => {
    if (server) await server.close();
  });

  test('migration 029 adds invitation_message + locale columns', () => {
    const cols = repos._db.pragma(`table_info('family_invitations')`);
    const colNames = cols.map((c) => c.name);
    assert.ok(colNames.includes('invitation_message'), 'invitation_message column should exist');
    assert.ok(colNames.includes('locale'), 'locale column should exist');
  });

  test('createInvitation persists invitation_message + locale', () => {
    const fam = repos.family.createFamily('Frestad-msg', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('msg-owner@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    const inv = repos.family.createInvitation({
      familyId: fam.id,
      token: 'tok-msg',
      assignedRole: 'adult',
      invitedBy: userId,
      invitedEmail: 'invitee@test',
      invitationMessage: '  Velkommen kjære!  ',
      locale: 'no',
    });
    assert.strictEqual(inv.invitation_message, 'Velkommen kjære!');
    assert.strictEqual(inv.locale, 'no');
  });

  test('createInvitation accepts en locale', () => {
    const fam = repos.family.createFamily('Frestad-en', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('en-owner@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    const inv = repos.family.createInvitation({
      familyId: fam.id,
      token: 'tok-en',
      assignedRole: 'adult',
      invitedBy: userId,
      invitationMessage: 'Welcome!',
      locale: 'en',
    });
    assert.strictEqual(inv.locale, 'en');
    assert.strictEqual(inv.invitation_message, 'Welcome!');
  });

  test('createInvitation rejects unknown locale', () => {
    const fam = repos.family.createFamily('Frestad-bad', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('bad-owner@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    assert.throws(
      () =>
        repos.family.createInvitation({
          familyId: fam.id,
          token: 'tok-bad',
          assignedRole: 'adult',
          invitedBy: userId,
          locale: 'fr',
        }),
      /invalid locale/i
    );
  });

  test('createInvitation enforces 500-char cap on invitation_message', () => {
    const fam = repos.family.createFamily('Frestad-long', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('long-owner@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    const tooLong = 'x'.repeat(501);
    assert.throws(
      () =>
        repos.family.createInvitation({
          familyId: fam.id,
          token: 'tok-long',
          assignedRole: 'adult',
          invitedBy: userId,
          invitationMessage: tooLong,
        }),
      /exceeds 500 chars/i
    );
  });

  test('createInvitation defaults to no when locale not supplied', () => {
    const fam = repos.family.createFamily('Frestad-default', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('default-owner@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    const inv = repos.family.createInvitation({
      familyId: fam.id,
      token: 'tok-default',
      assignedRole: 'adult',
      invitedBy: userId,
    });
    assert.strictEqual(inv.locale, 'no');
    assert.strictEqual(inv.invitation_message, null);
  });

  test('listActiveInvitations surfaces invitation_message + locale + invited_email', () => {
    const fam = repos.family.createFamily('Frestad-list', 1);
    const userId = repos._db
      .prepare(
        `INSERT INTO users (email, family_id, role)
         VALUES ('list-owner@test.no', ?, 'owner') RETURNING id`
      )
      .get(fam.id).id;
    repos.family.createInvitation({
      familyId: fam.id,
      token: 'tok-list',
      assignedRole: 'adult',
      invitedBy: userId,
      invitedEmail: 'list-invitee@test',
      invitationMessage: 'Hi there',
      locale: 'en',
    });
    const list = repos.family.listActiveInvitations(fam.id);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].invitedEmail, 'list-invitee@test');
    assert.strictEqual(list[0].invitationMessage, 'Hi there');
    assert.strictEqual(list[0].locale, 'en');
  });
});
