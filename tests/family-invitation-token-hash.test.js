'use strict';

// Migration 030: family_invitations.token is stored as SHA-256 hash.
//
// This test file proves three things that a future refactor must
// not break:
//
//   1. The DB column is `token_hash`, not `token`, and the stored
//      value is the SHA-256 of the plain token, not the plain token
//      itself.
//   2. `findInvitationByToken(plainToken)` still resolves the row
//      (lookup-by-token-via-hash works end-to-end).
//   3. `resendInvitation()` rotates the hash, and the previous
//      plain token can no longer resolve.
//
// The output-side covers what BR-INVITE-4 promises: plain tokens
// are returned one-shot from create/resend handlers via the route
// layer, and the listing endpoint never carries them.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startTestServer } = require('./helpers');
const { hashInvitationToken } = require('../server/repositories/family.repo');

let server;
let repos;

before(async () => {
  server = await startTestServer();
  repos = server.repos;
});

after(async () => {
  if (server) await server.close();
});

function createOwnerLite(email, familyName) {
  const fid = Number(
    repos._db.prepare('INSERT INTO families(name) VALUES(?)').run(familyName).lastInsertRowid
  );
  const userId = repos._db
    .prepare(`INSERT INTO users (email, family_id, role) VALUES (?, ?, 'owner') RETURNING id`)
    .get(email, fid).id;
  return { familyId: fid, userId };
}

describe('Invitation tokens · hashed at rest (migration 030 / BR-INVITE-4)', () => {
  test('stored column is `token_hash` and contains a SHA-256 digest, not the plain token', () => {
    const owner = createOwnerLite('hash-1@test.no', 'Hash Fam 1');
    const plainToken = crypto.randomBytes(32).toString('hex');

    repos.family.createInvitation({
      familyId: owner.familyId,
      token: plainToken,
      assignedRole: 'adult',
      invitedBy: owner.userId,
      invitedEmail: 'invitee-1@test.no',
    });

    // Read the raw column. The schema must NOT have `token` anymore.
    const cols = repos._db.prepare("PRAGMA table_info('family_invitations')").all();
    const names = cols.map((c) => c.name);
    assert.ok(names.includes('token_hash'), 'column token_hash must exist');
    assert.ok(!names.includes('token'), 'plain token column must be gone');

    const row = repos._db
      .prepare('SELECT token_hash FROM family_invitations WHERE family_id = ?')
      .get(owner.familyId);
    assert.ok(row, 'invitation row should exist');
    // SHA-256 hex is 64 characters
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
    // and it must NOT equal the plain token
    assert.notStrictEqual(row.token_hash, plainToken);
    // and it must equal sha256(plainToken)
    assert.strictEqual(row.token_hash, hashInvitationToken(plainToken));
  });

  test('findInvitationByToken(plain) resolves via internal hash lookup', () => {
    const owner = createOwnerLite('hash-2@test.no', 'Hash Fam 2');
    const plainToken = crypto.randomBytes(32).toString('hex');

    repos.family.createInvitation({
      familyId: owner.familyId,
      token: plainToken,
      assignedRole: 'adult',
      invitedBy: owner.userId,
      invitedEmail: 'invitee-2@test.no',
    });

    const found = repos.family.findInvitationByToken(plainToken);
    assert.ok(found, 'lookup by plain token must resolve');
    assert.strictEqual(found.invited_email, 'invitee-2@test.no');

    // Looking up by an arbitrary other 64-hex string must NOT resolve
    const wrong = crypto.randomBytes(32).toString('hex');
    assert.strictEqual(repos.family.findInvitationByToken(wrong), null);

    // Looking up by the hash itself must NOT resolve (handlers always
    // pass plain tokens — passing the hash would re-hash and miss)
    assert.strictEqual(repos.family.findInvitationByToken(found.token_hash), null);
  });

  test('resendInvitation rotates the stored hash; old plain token stops resolving', () => {
    const owner = createOwnerLite('hash-3@test.no', 'Hash Fam 3');
    const originalPlain = crypto.randomBytes(32).toString('hex');
    const created = repos.family.createInvitation({
      familyId: owner.familyId,
      token: originalPlain,
      assignedRole: 'adult',
      invitedBy: owner.userId,
      invitedEmail: 'invitee-3@test.no',
    });

    const originalHash = created.token_hash;

    const newPlain = crypto.randomBytes(32).toString('hex');
    const updated = repos.family.resendInvitation(owner.familyId, created.id, newPlain);
    assert.ok(updated, 'resend should succeed');
    assert.notStrictEqual(updated.token_hash, originalHash, 'hash must rotate');
    assert.strictEqual(updated.token_hash, hashInvitationToken(newPlain));

    // The original plain token must no longer resolve
    assert.strictEqual(
      repos.family.findInvitationByToken(originalPlain),
      null,
      'old plain token must stop resolving after resend'
    );
    // The new plain token must resolve
    const re = repos.family.findInvitationByToken(newPlain);
    assert.ok(re, 'new plain token must resolve after resend');
    assert.strictEqual(re.id, created.id);
  });

  test('hashInvitationToken is deterministic (same input → same output)', () => {
    const sample = 'fixed-plain-token';
    assert.strictEqual(hashInvitationToken(sample), hashInvitationToken(sample));
    // and matches a known SHA-256 of the same input
    const expected = crypto.createHash('sha256').update(sample, 'utf8').digest('hex');
    assert.strictEqual(hashInvitationToken(sample), expected);
  });
});
