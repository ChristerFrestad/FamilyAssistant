'use strict';

// Sprint 9 PR #119 hardening: per-family create-rate-limit (20/h) and
// per-invitation resend cooldown (60 s). Both return 429 with a
// Retry-After header so the UI can disable the action and surface a
// countdown instead of a hard error.

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

describe('Family invitation · per-family create-rate-limit', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('20 invitations within an hour pass; 21st returns 429 + Retry-After', async () => {
    const owner = createOwner(server, 'rl-create@test.no', 'RL Create');

    // Seed 20 rows directly via the repo so we don't generate
    // 20 emails through the route. created_at defaults to
    // datetime('now'), so all 20 fall inside the 60-min window.
    for (let i = 0; i < 20; i += 1) {
      server.repos.family.createInvitation({
        familyId: owner.familyId,
        token: `seed-${i}`,
        assignedRole: 'adult',
        invitedBy: owner.userId,
        invitedEmail: `seed-${i}@test.no`,
      });
    }

    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'one-too-many@test.no', locale: 'no' },
    });
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.headers['retry-after'], '3600');
    assert.match(r.body.detail, /20/);
  });

  test('cross-family count is isolated (DEL 14)', async () => {
    const ownerA = createOwner(server, 'rl-a@test.no', 'RL-A');
    const ownerB = createOwner(server, 'rl-b@test.no', 'RL-B');

    // Saturate family A
    for (let i = 0; i < 20; i += 1) {
      server.repos.family.createInvitation({
        familyId: ownerA.familyId,
        token: `iso-a-${i}`,
        assignedRole: 'adult',
        invitedBy: ownerA.userId,
        invitedEmail: `iso-a-${i}@test.no`,
      });
    }

    const aBlocked = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: ownerA.cookie },
      body: { role: 'adult', email: 'overflow@test.no', locale: 'no' },
    });
    assert.strictEqual(aBlocked.status, 429);

    const bAccepted = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: ownerB.cookie },
      body: { role: 'adult', email: 'b-still-fine@test.no', locale: 'no' },
    });
    assert.strictEqual(bAccepted.status, 200);
  });

  test('expired-window rows do not count toward the limit', async () => {
    const owner = createOwner(server, 'rl-window@test.no', 'RL Window');

    // 20 rows with created_at backdated 2 hours so they fall outside
    // the 60-min sliding window; the next create should still pass.
    //
    // Migration 030: column is token_hash; hash the fixture tokens so
    // direct INSERTs are storage-shape-correct (this test doesn't
    // exercise lookup-by-token, but the column constraint still applies).
    const { hashInvitationToken } = require('../server/repositories/family.repo');
    const past = new Date(Date.now() - 2 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    const ins = server.repos._db.prepare(
      `INSERT INTO family_invitations
         (family_id, token_hash, assigned_role, invited_by, expires_at, invited_email, locale, created_at)
       VALUES (?, ?, 'adult', ?, datetime('now', '+7 days'), ?, 'no', ?)`
    );
    for (let i = 0; i < 20; i += 1) {
      ins.run(
        owner.familyId,
        hashInvitationToken(`old-${i}`),
        owner.userId,
        `old-${i}@test.no`,
        past
      );
    }

    const r = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'fresh@test.no', locale: 'no' },
    });
    assert.strictEqual(r.status, 200);
  });
});

describe('Family invitation · resend cooldown (60 s per invitation)', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('second resend within 60 s returns 429 + Retry-After', async () => {
    const owner = createOwner(server, 'cd-1@test.no', 'CD One');
    const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'cd-1-target@test.no', locale: 'no' },
    });
    assert.strictEqual(create.status, 200);
    const invId = create.body.invitation.id;

    // First resend immediately after create — cooldown window is
    // anchored on created_at as well, so even the first resend is
    // expected to trip the cooldown until ≥ 60 s have passed.
    const first = await request(server.baseUrl, 'POST', `/api/family/invitations/${invId}/resend`, {
      headers: { Cookie: owner.cookie },
    });
    assert.strictEqual(first.status, 429);
    assert.match(first.headers['retry-after'], /^\d+$/);
    const retryAfter = Number(first.headers['retry-after']);
    assert.ok(retryAfter > 0 && retryAfter <= 60, `expected 1..60 s, got ${retryAfter}`);
  });

  test('resend succeeds once the cooldown has elapsed', async () => {
    const owner = createOwner(server, 'cd-2@test.no', 'CD Two');
    const create = await request(server.baseUrl, 'POST', '/api/family/invitations', {
      headers: { Cookie: owner.cookie },
      body: { role: 'adult', email: 'cd-2-target@test.no', locale: 'no' },
    });
    assert.strictEqual(create.status, 200);
    const invId = create.body.invitation.id;

    // Force the row's expires_at backwards by 7 days minus 1 second so
    // expires_at - INVITE_TTL_DAYS lands ~61 s in the past, putting us
    // outside the 60 s cooldown.
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
  });
});
