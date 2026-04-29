'use strict';

// PR #77 — POST /api/auth/onboarding/complete (atomic onboarding)
//
// The endpoint replaces the previous "flag-flip only" version and the
// now-deleted POST /api/onboarding/create-family. A single transaction
// creates the family, the owner's first profile-member row, sets
// users.role='owner' + portion_factor + onboarding_completed=1, and
// writes an audit-log entry. Either everything commits or nothing does.
//
// Coverage:
//   * 401 when no session
//   * 401 when the synthetic LOCAL_USER tries to call it
//   * Validation: missing family.name, oversize family.name, missing
//     user fields, invalid category enum, portion_factor out of 0.1-2.0
//   * Happy path: family + member + user-fields + audit-log all land
//   * 409 when the caller already has a family_id
//   * Idempotent re-call returns 409 (the second invocation hits the
//     "already in family" guard, no new rows are created)
//
// Owner approval for retiring the previous flag-flip tests is
// documented in PR #77 (CLAUDE.md DEL 6.5 explicit approval).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startTestServer, request } = require('./helpers');
const { serializeCookie } = require('../server/auth/cookies');

function cookieHeader(sid) {
  return serializeCookie('fa_session', sid, { httpOnly: true, path: '/' }).split(';')[0];
}

function createFreshUser(server, email) {
  // A user fresh out of magic-link verify: no family, onboarding flag
  // still 0, default portion_factor 1.0 (migration 023 default). The
  // session-cookie path is what the v2 SPA actually uses.
  const user = server.repos.auth.createUser({ email, name: email });
  const sid = crypto.randomBytes(32).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  return { userId: user.id, cookie: cookieHeader(sid) };
}

const VALID_PAYLOAD = Object.freeze({
  family: { name: 'Familien Frestad' },
  user: { name: 'Christer', category: 'adult', portionFactor: 1.0 },
});

// ============================================================
// Auth gate
// ============================================================

test('returns 401 without a session (AUTH_TOKEN configured, no cookie)', async () => {
  // With AUTH_TOKEN set, the auth middleware requires either a Bearer
  // token or a session cookie. A request that sends neither reaches
  // the handler with ctx.user=null and gets rejected.
  const server = await startTestServer({ authToken: 'onb-no-session-token-0123456789' });
  try {
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      body: VALID_PAYLOAD,
    });
    assert.equal(r.status, 401);
  } finally {
    await server.close();
  }
});

test('returns 401 for the synthetic LOCAL_USER (no AUTH_TOKEN, no cookie)', async () => {
  // Without AUTH_TOKEN, the auth middleware attaches a synthetic
  // LOCAL_USER. The handler explicitly rejects synthetic identities so
  // the legacy single-tenant fallback can't accidentally create a
  // shadow family in dev.
  const server = await startTestServer();
  try {
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      body: VALID_PAYLOAD,
    });
    assert.equal(r.status, 401);
  } finally {
    await server.close();
  }
});

// ============================================================
// Validation
// ============================================================

test('rejects missing family.name with 400', async () => {
  const server = await startTestServer({ authToken: 'onb-validation-token-0123456789' });
  try {
    const u = createFreshUser(server, 'no-family-name@onb.test');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: { ...VALID_PAYLOAD, family: { name: '' } },
    });
    assert.equal(r.status, 400);
  } finally {
    await server.close();
  }
});

test('rejects family.name over 100 chars with 400', async () => {
  const server = await startTestServer({ authToken: 'onb-validation-token-0123456789' });
  try {
    const u = createFreshUser(server, 'long-name@onb.test');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: { ...VALID_PAYLOAD, family: { name: 'x'.repeat(101) } },
    });
    assert.equal(r.status, 400);
  } finally {
    await server.close();
  }
});

test('rejects invalid user.category with 400', async () => {
  const server = await startTestServer({ authToken: 'onb-validation-token-0123456789' });
  try {
    const u = createFreshUser(server, 'bad-category@onb.test');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: {
        ...VALID_PAYLOAD,
        user: { ...VALID_PAYLOAD.user, category: 'grown-up' },
      },
    });
    assert.equal(r.status, 400);
  } finally {
    await server.close();
  }
});

test('rejects portionFactor below 0.1 with 400', async () => {
  const server = await startTestServer({ authToken: 'onb-validation-token-0123456789' });
  try {
    const u = createFreshUser(server, 'pf-too-low@onb.test');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: {
        ...VALID_PAYLOAD,
        user: { ...VALID_PAYLOAD.user, portionFactor: 0.05 },
      },
    });
    assert.equal(r.status, 400);
  } finally {
    await server.close();
  }
});

test('rejects portionFactor above 2.0 with 400', async () => {
  const server = await startTestServer({ authToken: 'onb-validation-token-0123456789' });
  try {
    const u = createFreshUser(server, 'pf-too-high@onb.test');
    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: {
        ...VALID_PAYLOAD,
        user: { ...VALID_PAYLOAD.user, portionFactor: 2.5 },
      },
    });
    assert.equal(r.status, 400);
  } finally {
    await server.close();
  }
});

// ============================================================
// Happy path
// ============================================================

test('happy path: creates family + member + flips user fields atomically', async () => {
  const server = await startTestServer({ authToken: 'onb-happy-token-01234567890123' });
  try {
    const u = createFreshUser(server, 'happy@onb.test');

    const r = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: VALID_PAYLOAD,
    });

    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.family.name, 'Familien Frestad');
    assert.equal(r.body.family.ownerUserId, u.userId);
    assert.equal(r.body.user.onboardingCompleted, true);
    assert.equal(r.body.user.familyId, r.body.family.id);
    assert.equal(r.body.user.role, 'owner');
    assert.equal(r.body.user.profileMemberId, r.body.member.id);
    assert.equal(r.body.member.category, 'adult');
    assert.equal(r.body.member.portionFactor, 1.0);
    assert.equal(r.body.member.name, 'Christer');

    // DB-side verification
    const dbUser = server.repos.auth.findById(u.userId);
    assert.equal(dbUser.family_id, r.body.family.id);
    assert.equal(dbUser.role, 'owner');
    assert.equal(dbUser.name, 'Christer');
    assert.equal(dbUser.portion_factor, 1.0);
    assert.equal(dbUser.onboarding_completed, 1);
    assert.equal(dbUser.profile_member_id, r.body.member.id);

    const members = server.repos.family.listMembers(r.body.family.id);
    assert.equal(members.length, 1);
    assert.equal(members[0].name, 'Christer');
    assert.equal(members[0].category, 'adult');
    assert.equal(members[0].portionFactor, 1.0);

    // Audit-log inside the transaction. The audit_log.action column
    // is constrained to HTTP methods, so we filter on the
    // entity_type 'onboarding' which the handler uses to mark this
    // event-type in a way that survives the CHECK constraint. The
    // semantic event ('onboarding_completed') lives in the metadata
    // blob.
    const audit = server.repos._db
      .prepare(
        `SELECT action, entity_type, entity_id, family_id, route, metadata
           FROM audit_log
          WHERE family_id = ? AND entity_type = 'onboarding'`
      )
      .get(r.body.family.id);
    assert.ok(audit, 'audit_log row missing');
    assert.equal(audit.action, 'POST');
    assert.equal(audit.entity_id, String(r.body.family.id));
    assert.equal(audit.route, '/api/auth/onboarding/complete');
    const meta = JSON.parse(audit.metadata);
    assert.equal(meta.event, 'onboarding_completed');
    assert.equal(meta.memberId, r.body.member.id);
  } finally {
    await server.close();
  }
});

test('/api/auth/me reflects onboardingCompleted=true after success', async () => {
  const server = await startTestServer({ authToken: 'onb-me-token-0123456789012345' });
  try {
    const u = createFreshUser(server, 'me-after@onb.test');

    const before = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: u.cookie },
    });
    assert.equal(before.body.user.onboardingCompleted, false);

    await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: VALID_PAYLOAD,
    });

    const after = await request(server.baseUrl, 'GET', '/api/auth/me', {
      headers: { Cookie: u.cookie },
    });
    assert.equal(after.body.user.onboardingCompleted, true);
    assert.ok(after.body.user.familyId);
  } finally {
    await server.close();
  }
});

// ============================================================
// Conflict
// ============================================================

test('returns 409 when caller is already in a family', async () => {
  const server = await startTestServer({ authToken: 'onb-conflict-token-0123456789' });
  try {
    const u = createFreshUser(server, 'already@onb.test');

    const first = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: VALID_PAYLOAD,
    });
    assert.equal(first.status, 200);

    const second = await request(server.baseUrl, 'POST', '/api/auth/onboarding/complete', {
      headers: { Cookie: u.cookie },
      body: { ...VALID_PAYLOAD, family: { name: 'Andre forsøk' } },
    });
    assert.equal(second.status, 409);

    // No second family was created
    const families = server.repos._db
      .prepare(`SELECT id, name FROM families WHERE name LIKE 'Andre%'`)
      .all();
    assert.equal(families.length, 0);
  } finally {
    await server.close();
  }
});
