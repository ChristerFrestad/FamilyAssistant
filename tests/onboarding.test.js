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

function createUnboundUser(email) {
  const user = server.repos.auth.createUser({ email, name: email });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { userId: user.id, cookie: cookieHeader(sid) };
}

before(async () => {
  server = await startTestServer({ authToken: 'onboarding-test-token-012345678901' });
});

after(async () => {
  await server.close();
});

// ============================================================
// POST /api/onboarding/create-family
// ============================================================

test('POST /api/onboarding/create-family requires authentication', async () => {
  const r = await request(server.baseUrl, 'POST', '/api/onboarding/create-family', {
    body: { name: 'X' },
  });
  assert.strictEqual(r.status, 401);
});

test('POST /api/onboarding/create-family rejects empty name', async () => {
  const u = createUnboundUser('empty-name@onboarding.test');
  const r = await request(server.baseUrl, 'POST', '/api/onboarding/create-family', {
    headers: { Cookie: u.cookie },
    body: { name: '' },
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/onboarding/create-family creates family + owner', async () => {
  const u = createUnboundUser('create-fam@onboarding.test');
  const r = await request(server.baseUrl, 'POST', '/api/onboarding/create-family', {
    headers: { Cookie: u.cookie },
    body: { name: 'Familien Test' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.family.name, 'Familien Test');
  assert.strictEqual(r.body.family.ownerUserId, u.userId);

  const updated = server.repos.auth.findById(u.userId);
  assert.strictEqual(updated.family_id, r.body.family.id);
  assert.strictEqual(updated.role, 'owner');

  const family = server.repos.family.findFamilyById(r.body.family.id);
  assert.strictEqual(family.owner_user_id, u.userId);
});

test('POST /api/onboarding/create-family is 409 when already in a family', async () => {
  const u = createUnboundUser('already-fam@onboarding.test');
  await request(server.baseUrl, 'POST', '/api/onboarding/create-family', {
    headers: { Cookie: u.cookie },
    body: { name: 'Første' },
  });
  const r = await request(server.baseUrl, 'POST', '/api/onboarding/create-family', {
    headers: { Cookie: u.cookie },
    body: { name: 'Andre' },
  });
  assert.strictEqual(r.status, 409);
});

// ============================================================
// Static assets served in phase 13
// ============================================================

test('GET /onboarding.html is served to authenticated users', async () => {
  const u = createUnboundUser('ob-html@onboarding.test');
  const r = await request(server.baseUrl, 'GET', '/onboarding.html', {
    headers: { Cookie: u.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /Opprett familien din/);
  assert.match(r.raw, /Familiemedlemmer/);
  assert.match(r.raw, /AI-motor/);
  assert.match(r.raw, /dobbeltsjekk/i);
});

test('GET /onboarding.html is 401 for anonymous (server-side gate)', async () => {
  const r = await request(server.baseUrl, 'GET', '/onboarding.html');
  assert.strictEqual(r.status, 401);
});

test('GET /invite.html is public', async () => {
  const r = await request(server.baseUrl, 'GET', '/invite.html');
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /Invitasjon/);
  assert.match(r.raw, /\/api\/invitations\//);
});

test('GET /js/family-onboarding.js references the onboarding endpoints', async () => {
  const u = createUnboundUser('ob-js@onboarding.test');
  const r = await request(server.baseUrl, 'GET', '/js/family-onboarding.js', {
    headers: { Cookie: u.cookie },
  });
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /\/api\/onboarding\/create-family/);
  assert.match(r.raw, /\/api\/family\/members/);
  assert.match(r.raw, /\/api\/family\/llm/);
  assert.match(r.raw, /PROVIDER_OPTIONS/);
  assert.match(r.raw, /ALLERGY_OPTIONS/);
});

// ============================================================
// Accept-flow triggered from /invite.html
// ============================================================

test('Invite peek + accept works through the public endpoints', async () => {
  // Owner creates invitation.
  const ownerFid = Number(
    server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Invite Accept Fam')
      .lastInsertRowid
  );
  const owner = server.repos.auth.createUser({ email: 'ownr@onboarding.test', name: 'Owner' });
  server.repos.auth.setFamily(owner.id, ownerFid, 'owner');
  server.repos.family.setOwner(ownerFid, owner.id);
  const ownerSid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: ownerSid, userId: owner.id, ttlDays: 30 });

  const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
    headers: { Cookie: cookieHeader(ownerSid) },
    body: { role: 'adult' },
  });
  const token = create.body.invitation.token;

  // Peek is public.
  const peek = await request(server.baseUrl, 'GET', `/api/invitations/${token}`);
  assert.strictEqual(peek.status, 200);
  assert.strictEqual(peek.body.familyName, 'Invite Accept Fam');

  // Accept requires the invitee to be logged in.
  const joiner = createUnboundUser('joinr@onboarding.test');
  const accept = await request(server.baseUrl, 'POST', `/api/invitations/${token}/accept`, {
    headers: { Cookie: joiner.cookie },
  });
  assert.strictEqual(accept.status, 200);
  assert.strictEqual(accept.body.user.familyId, ownerFid);
  assert.strictEqual(accept.body.user.role, 'adult');
});
