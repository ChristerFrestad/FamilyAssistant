'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

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
  return { familyId: fid, userId: user.id, sid, cookie: cookieHeader(sid) };
}

function createUnboundUser(email) {
  const user = server.repos.auth.createUser({ email, name: email });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { userId: user.id, sid, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'family-test-token-abcdef0123456789' });
});

after(async () => {
  await server.close();
});

// ============================================================
// GET /api/family
// ============================================================

test('GET /api/family returns family + profile members + users', async () => {
  const owner = createUser('fam-owner@test', 'owner', 'Get Family');
  // Add two roster members
  server.repos.family.addMember(owner.familyId, { name: 'Kari', category: 'adult' });
  server.repos.family.addMember(owner.familyId, { name: 'Lars', category: 'child' });

  const r = await request(server.baseUrl, 'GET', '/api/family', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.family.name, 'Get Family');
  assert.strictEqual(r.body.profileMembers.length, 2);
  assert.strictEqual(r.body.users.length, 1);
  assert.strictEqual(r.body.users[0].email, 'fam-owner@test');
});

// ============================================================
// PUT /api/family (owner only)
// ============================================================

test('PUT /api/family renames family (owner)', async () => {
  const owner = createUser('rename-owner@test', 'owner', 'Old Name');
  const r = await request(server.baseUrl, 'PUT', '/api/family', {
    headers: { Cookie: owner.cookie },
    body: { name: 'New Name' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.family.name, 'New Name');
});

test('PUT /api/family rejects empty name', async () => {
  const owner = createUser('rename-empty@test', 'owner', 'Old Name');
  const r = await request(server.baseUrl, 'PUT', '/api/family', {
    headers: { Cookie: owner.cookie },
    body: { name: '' },
  });
  assert.strictEqual(r.status, 400);
});

test('PUT /api/family rejects adult (owner-only)', async () => {
  const adult = createUser('rename-adult@test', 'adult', 'Adult Family');
  const r = await request(server.baseUrl, 'PUT', '/api/family', {
    headers: { Cookie: adult.cookie },
    body: { name: 'Nope' },
  });
  assert.strictEqual(r.status, 403);
});

// ============================================================
// Profile members CRUD
// ============================================================

test('POST /api/family/members adds a roster row', async () => {
  const owner = createUser('member-add@test', 'owner', 'Member Add');
  const r = await request(server.baseUrl, 'POST', '/api/family/members', {
    headers: { Cookie: owner.cookie },
    body: { name: 'Anna', category: 'teen', portionFactor: 0.75 },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.member.name, 'Anna');
  assert.strictEqual(r.body.member.category, 'teen');
  assert.strictEqual(r.body.member.portionFactor, 0.75);
});

test('POST /api/family/members rejects child role', async () => {
  const child = createUser('member-child@test', 'child', 'Child Fam');
  const r = await request(server.baseUrl, 'POST', '/api/family/members', {
    headers: { Cookie: child.cookie },
    body: { name: 'Extra' },
  });
  assert.strictEqual(r.status, 403);
});

test('POST /api/family/members rejects invalid category', async () => {
  const owner = createUser('member-badcat@test', 'owner', 'BadCat');
  const r = await request(server.baseUrl, 'POST', '/api/family/members', {
    headers: { Cookie: owner.cookie },
    body: { name: 'X', category: 'alien' },
  });
  assert.strictEqual(r.status, 400);
});

test('PUT /api/family/members/:id updates the row', async () => {
  const owner = createUser('member-update@test', 'owner', 'Upd Fam');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Old', category: 'adult' });
  const r = await request(server.baseUrl, 'PUT', `/api/family/members/${m.id}`, {
    headers: { Cookie: owner.cookie },
    body: { name: 'New', portionFactor: 1.25 },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.member.name, 'New');
  assert.strictEqual(r.body.member.portionFactor, 1.25);
});

test('DELETE /api/family/members/:id removes the row (owner only)', async () => {
  const owner = createUser('member-delete@test', 'owner', 'Del Fam');
  const m = server.repos.family.addMember(owner.familyId, { name: 'Gone' });
  const r = await request(server.baseUrl, 'DELETE', `/api/family/members/${m.id}`, {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
});

test('DELETE /api/family/members/:id rejects adult (owner-only)', async () => {
  const adult = createUser('member-del-adult@test', 'adult', 'Del Adult');
  const m = server.repos.family.addMember(adult.familyId, { name: 'X' });
  const r = await request(server.baseUrl, 'DELETE', `/api/family/members/${m.id}`, {
    headers: { Cookie: adult.cookie },
  });
  assert.strictEqual(r.status, 403);
});

// ============================================================
// Invitations: create / list / revoke
// ============================================================

test('POST /api/family/invitations mints a token + URL (owner)', async () => {
  const owner = createUser('invite-create@test', 'owner', 'Invite Fam');
  const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
    body: { role: 'adult' },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.invitation.token);
  assert.match(r.body.invitation.url, /\/invite\//);
  assert.strictEqual(r.body.invitation.assignedRole, 'adult');
});

test('POST /api/family/invitations rejects adult (owner-only)', async () => {
  const adult = createUser('invite-adult@test', 'adult', 'Invite Adult');
  const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: adult.cookie },
    body: { role: 'adult' },
  });
  assert.strictEqual(r.status, 403);
});

test('GET /api/family/invitations lists active invitations', async () => {
  const owner = createUser('invite-list@test', 'owner', 'List Fam');
  await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
    body: { role: 'adult' },
  });
  const r = await request(server.baseUrl, 'GET', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.invitations.length, 1);
});

test('DELETE /api/family/invitations/:id revokes the token', async () => {
  const owner = createUser('invite-revoke@test', 'owner', 'Revoke Fam');
  const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
    body: { role: 'adult' },
  });
  const id = create.body.invitation.id;
  const r = await request(server.baseUrl, 'DELETE', `/api/family/invitations/${id}`, {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  const list = await request(server.baseUrl, 'GET', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(list.body.invitations.length, 0);
});

// ============================================================
// Invitation peek / accept
// ============================================================

test('GET /api/invitations/:token peek is public and returns family name', async () => {
  const owner = createUser('peek-owner@test', 'owner', 'Peek Family');
  const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
    body: { role: 'child' },
  });
  const token = create.body.invitation.token;

  // No cookie, no bearer → still allowed (soft-auth prefix).
  const r = await request(server.baseUrl, 'GET', `/api/invitations/${token}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.familyName, 'Peek Family');
  assert.strictEqual(r.body.assignedRole, 'child');
  assert.strictEqual(r.body.inviterEmail, 'peek-owner@test');
});

test('POST /api/invitations/:token/accept joins unbound user to family', async () => {
  const owner = createUser('accept-owner@test', 'owner', 'Accept Family');
  const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: owner.cookie },
    body: { role: 'adult' },
  });
  const token = create.body.invitation.token;

  const joiner = createUnboundUser('joiner@test');
  const r = await request(server.baseUrl, 'POST', `/api/invitations/${token}/accept`, {
    headers: { Cookie: joiner.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.familyId, owner.familyId);
  assert.strictEqual(r.body.user.role, 'adult');

  // Second accept must 409
  const second = await request(server.baseUrl, 'POST', `/api/invitations/${token}/accept`, {
    headers: { Cookie: joiner.cookie },
  });
  assert.strictEqual(second.status, 409);
});

test('POST /api/invitations/:token/accept rejects expired token (410)', async () => {
  // Sprint 9 PR #119: expired invitations now return 410 Gone with
  // code INVITATION_EXPIRED so the v2 accept-page state-5 dispatcher
  // can branch on the machine-readable code instead of message text.
  const owner = createUser('accept-exp-owner@test', 'owner', 'Expired Family');
  // Create an invitation with 0-day TTL so it is immediately expired.
  const token = crypto.randomBytes(16).toString('hex');
  server.repos.family.createInvitation({
    familyId: owner.familyId,
    token,
    assignedRole: 'adult',
    invitedBy: owner.userId,
    ttlDays: -1,
  });

  const joiner = createUnboundUser('accept-exp-joiner@test');
  const r = await request(server.baseUrl, 'POST', `/api/invitations/${token}/accept`, {
    headers: { Cookie: joiner.cookie },
  });
  assert.strictEqual(r.status, 410);
  assert.strictEqual(r.body.code, 'INVITATION_EXPIRED');
});

test('POST /api/invitations/:token/accept rejects unknown token (404)', async () => {
  const joiner = createUnboundUser('unknown-accept@test');
  const r = await request(server.baseUrl, 'POST', '/api/invitations/nonexistent/accept', {
    headers: { Cookie: joiner.cookie },
  });
  assert.strictEqual(r.status, 404);
});

test('POST /api/invitations/:token/accept rejects user already in another family', async () => {
  const ownerA = createUser('cross-owner-a@test', 'owner', 'Cross A');
  const ownerB = createUser('cross-owner-b@test', 'owner', 'Cross B');
  const member = createUser('cross-member@test', 'adult', 'Cross Member');
  // member is in their own family; now owner A invites them.
  const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: ownerA.cookie },
    body: { role: 'adult' },
  });
  const r = await request(
    server.baseUrl,
    'POST',
    `/api/invitations/${create.body.invitation.token}/accept`,
    { headers: { Cookie: member.cookie } }
  );
  assert.strictEqual(r.status, 409);

  // Use ownerB variable so ESLint does not complain and to assert the setup
  // produced three distinct families.
  assert.notStrictEqual(ownerA.familyId, ownerB.familyId);
  assert.notStrictEqual(ownerA.familyId, member.familyId);
});

// ============================================================
// Leave / remove / transfer-ownership / change-role
// ============================================================

test('POST /api/family/leave works for adult but not owner', async () => {
  const owner = createUser('leave-owner@test', 'owner', 'Leave Fam');
  const leave = await request(server.baseUrl, 'POST', '/api/family/leave', {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(leave.status, 403);

  const adult = createUser('leave-adult@test', 'adult', 'Leave Adult');
  const r = await request(server.baseUrl, 'POST', '/api/family/leave', {
    headers: { Cookie: adult.cookie },
  });
  assert.strictEqual(r.status, 200);
  const after = server.repos.auth.findById(adult.userId);
  assert.strictEqual(after.family_id, null);
});

test('DELETE /api/family/members/users/:userId removes a user (owner only)', async () => {
  const owner = createUser('rm-owner@test', 'owner', 'RM Family');
  const victim = server.repos.auth.createUser({ email: 'victim@test', name: 'V' });
  server.repos.auth.setFamily(victim.id, owner.familyId, 'adult');
  const r = await request(server.baseUrl, 'DELETE', `/api/family/members/users/${victim.id}`, {
    headers: { Cookie: owner.cookie },
  });
  assert.strictEqual(r.status, 200);
  const after = server.repos.auth.findById(victim.id);
  assert.strictEqual(after.family_id, null);
});

test('POST /api/family/transfer-ownership swaps roles', async () => {
  const owner = createUser('xfer-owner@test', 'owner', 'Xfer Family');
  const adult = server.repos.auth.createUser({ email: 'xfer-adult@test', name: 'A' });
  server.repos.auth.setFamily(adult.id, owner.familyId, 'adult');

  const r = await request(server.baseUrl, 'POST', '/api/family/transfer-ownership', {
    headers: { Cookie: owner.cookie },
    body: { userId: adult.id },
  });
  assert.strictEqual(r.status, 200);

  const ex = server.repos.auth.findById(owner.userId);
  const neo = server.repos.auth.findById(adult.id);
  assert.strictEqual(ex.role, 'adult');
  assert.strictEqual(neo.role, 'owner');
  const fam = server.repos.family.findFamilyById(owner.familyId);
  assert.strictEqual(fam.owner_user_id, adult.id);
});

test('POST /api/family/transfer-ownership rejects transferring to a child', async () => {
  const owner = createUser('xfer-child-owner@test', 'owner', 'Xfer Child Fam');
  const kid = server.repos.auth.createUser({ email: 'xfer-kid@test', name: 'K' });
  server.repos.auth.setFamily(kid.id, owner.familyId, 'child');

  const r = await request(server.baseUrl, 'POST', '/api/family/transfer-ownership', {
    headers: { Cookie: owner.cookie },
    body: { userId: kid.id },
  });
  assert.strictEqual(r.status, 403);
});

test('PUT /api/family/members/users/:userId/role changes role (owner only)', async () => {
  const owner = createUser('role-owner@test', 'owner', 'Role Family');
  const adult = server.repos.auth.createUser({ email: 'role-adult@test', name: 'A' });
  server.repos.auth.setFamily(adult.id, owner.familyId, 'adult');

  const r = await request(server.baseUrl, 'PUT', `/api/family/members/users/${adult.id}/role`, {
    headers: { Cookie: owner.cookie },
    body: { role: 'child' },
  });
  assert.strictEqual(r.status, 200);
  const updated = server.repos.auth.findById(adult.id);
  assert.strictEqual(updated.role, 'child');
});

test('PUT /api/family/members/users/:userId/role rejects changing owner role', async () => {
  const owner = createUser('role-owner-self@test', 'owner', 'Role Self');
  const r = await request(server.baseUrl, 'PUT', `/api/family/members/users/${owner.userId}/role`, {
    headers: { Cookie: owner.cookie },
    body: { role: 'adult' },
  });
  assert.strictEqual(r.status, 403);
});

// ============================================================
// DELETE /api/family
// ============================================================

test('DELETE /api/family requires confirmation-name match', async () => {
  const owner = createUser('del-owner@test', 'owner', 'Del Fam');
  const wrong = await request(server.baseUrl, 'DELETE', '/api/family', {
    headers: { Cookie: owner.cookie },
    body: { confirmationName: 'wrong' },
  });
  assert.strictEqual(wrong.status, 400);
});

test('DELETE /api/family deletes the family on confirmation', async () => {
  const owner = createUser('del-ok-owner@test', 'owner', 'Del OK');
  const r = await request(server.baseUrl, 'DELETE', '/api/family', {
    headers: { Cookie: owner.cookie },
    body: { confirmationName: 'Del OK' },
  });
  assert.strictEqual(r.status, 200);
  const after = server.repos.family.findFamilyById(owner.familyId);
  assert.strictEqual(after, null);
});
