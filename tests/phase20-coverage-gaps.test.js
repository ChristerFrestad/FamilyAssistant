'use strict';

// Phase 20 — final coverage-gap pass against plan §Verifikasjon §1.
//
// Existing suites cover the big rocks (tenant isolation, role
// enforcement, crypto tamper detection, magic-link expiry, invitation
// double-accept, owner-cannot-leave). This file closes two last gaps:
//
//   1. OAuth callback state-validation → 400 on every malformed branch
//   2. Portion-sum matrix [adult 1.0, teen 0.75, child 0.5] = 2.25
//      (the exact scenario called out in the plan)

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request } = require('./helpers');
const { runWithFamily } = require('../server/auth/family-context');
const { familyPortionSum } = require('../server/services/family.service');

// ============================================================
// Section 1 — OAuth callback guards
// ============================================================
describe('Phase 20 · Google OAuth callback — unknown/missing state → 400', () => {
  let server;

  before(async () => {
    // Bring Google config online so the callback runs past the
    // "not configured → 503" short-circuit and exercises the real
    // state-validation path. No network calls happen here — the guards
    // all fire before exchangeCodeForIdToken is reached.
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.APP_URL = 'https://test.example';
    process.env.SESSION_SECRET = 'a'.repeat(64);
    server = await startTestServer({ authToken: 'phase20-token-aaaaaaaaaaaaaaaa' });
  });

  after(async () => {
    await server.close();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.APP_URL;
    delete process.env.SESSION_SECRET;
  });

  test('callback without code or state → 400', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/auth/google/callback');
    assert.strictEqual(r.status, 400);
    assert.match(String(r.raw), /code|state/i);
  });

  test('callback with error= param → 400', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/auth/google/callback?error=access_denied');
    assert.strictEqual(r.status, 400);
    assert.match(String(r.raw), /Google returned error|access_denied/);
  });

  test('callback with code+state but no state cookie → 400', async () => {
    const r = await request(
      server.baseUrl,
      'GET',
      '/api/auth/google/callback?code=abc&state=unknown'
    );
    assert.strictEqual(r.status, 400);
    assert.match(String(r.raw), /state cookie missing|start the flow/i);
  });

  test('callback with mismatched/garbage state cookie → 400', async () => {
    const r = await request(server.baseUrl, 'GET', '/api/auth/google/callback?code=abc&state=xyz', {
      headers: { Cookie: 'fa_oauth_state=not-a-signed-payload' },
    });
    assert.strictEqual(r.status, 400);
    assert.match(String(r.raw), /state cookie is invalid|state mismatch/i);
  });
});

// ============================================================
// Section 2 — Portion-sum matrix
// ============================================================
describe('Phase 20 · Portion-sum matrix [adult 1.0, teen 0.75, child 0.5] = 2.25', () => {
  let server;

  before(async () => {
    server = await startTestServer({ authToken: 'phase20-portion-aaaaaaaaaaaaaaaa' });
  });

  after(async () => {
    await server.close();
  });

  test('familyPortionSum returns 2.25 for the canonical 3-person roster', () => {
    const fid = Number(
      server.repos._db.prepare('INSERT INTO families(name) VALUES(?)').run('Portion Matrix Fam')
        .lastInsertRowid
    );
    runWithFamily(fid, () => {
      server.repos.family.addMember(fid, {
        name: 'Adult',
        category: 'adult',
        portionFactor: 1.0,
      });
      server.repos.family.addMember(fid, {
        name: 'Teen',
        category: 'teen',
        portionFactor: 0.75,
      });
      server.repos.family.addMember(fid, {
        name: 'Child',
        category: 'child',
        portionFactor: 0.5,
      });
    });
    const sum = familyPortionSum(server.repos, fid);
    // Floating-point safe: exact to the cent.
    assert.ok(Math.abs(sum - 2.25) < 1e-9, `expected 2.25, got ${sum}`);
  });
});
