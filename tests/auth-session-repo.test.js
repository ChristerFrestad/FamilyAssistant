'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer } = require('./helpers');

let server;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

function createUser(repos, email, extras = {}) {
  return repos.auth.createUser({ email, ...extras });
}

test('createSession stores row and returns it', () => {
  const user = createUser(server.repos, 't1@example.com');
  const sid = require('node:crypto').randomBytes(16).toString('hex');
  const row = server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 1 });
  assert.strictEqual(row.id, sid);
  assert.strictEqual(row.user_id, user.id);
  assert.ok(row.expires_at);
});

test('getValidSession returns the row when not expired', () => {
  const user = createUser(server.repos, 't2@example.com');
  const sid = require('node:crypto').randomBytes(16).toString('hex');
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: 30 });
  const found = server.repos.auth.getValidSession(sid);
  assert.ok(found);
  assert.strictEqual(found.user_id, user.id);
});

test('getValidSession returns null and removes expired rows', () => {
  const user = createUser(server.repos, 't3@example.com');
  const sid = require('node:crypto').randomBytes(16).toString('hex');
  // TTL=-1 days -> already expired
  server.repos.auth.createSession({ id: sid, userId: user.id, ttlDays: -1 });
  const found = server.repos.auth.getValidSession(sid);
  assert.strictEqual(found, null);
  // Lazy cleanup should have removed it
  const list = server.repos.auth.listForUser(user.id);
  assert.strictEqual(list.length, 0);
});

test('deleteAllForUser removes every session for that user', () => {
  const user = createUser(server.repos, 't4@example.com');
  for (let i = 0; i < 3; i++) {
    server.repos.auth.createSession({
      id: require('node:crypto').randomBytes(16).toString('hex'),
      userId: user.id,
      ttlDays: 30,
    });
  }
  assert.strictEqual(server.repos.auth.listForUser(user.id).length, 3);
  server.repos.auth.deleteAllForUser(user.id);
  assert.strictEqual(server.repos.auth.listForUser(user.id).length, 0);
});

test('deleteOthersForUser keeps the specified session and deletes others', () => {
  const user = createUser(server.repos, 't5@example.com');
  const keepId = require('node:crypto').randomBytes(16).toString('hex');
  server.repos.auth.createSession({ id: keepId, userId: user.id, ttlDays: 30 });
  for (let i = 0; i < 2; i++) {
    server.repos.auth.createSession({
      id: require('node:crypto').randomBytes(16).toString('hex'),
      userId: user.id,
      ttlDays: 30,
    });
  }
  server.repos.auth.deleteOthersForUser(user.id, keepId);
  const remaining = server.repos.auth.listForUser(user.id);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].id, keepId);
});

test('cleanupExpired removes only expired rows', () => {
  const user = createUser(server.repos, 't6@example.com');
  const liveId = require('node:crypto').randomBytes(16).toString('hex');
  const deadId = require('node:crypto').randomBytes(16).toString('hex');
  server.repos.auth.createSession({ id: liveId, userId: user.id, ttlDays: 30 });
  server.repos.auth.createSession({ id: deadId, userId: user.id, ttlDays: -1 });
  const removed = server.repos.auth.cleanupExpired();
  assert.ok(removed >= 1);
  assert.ok(server.repos.auth.getValidSession(liveId));
  assert.strictEqual(server.repos.auth.getValidSession(deadId), null);
});

// Sprint 3 / Fase 1e — repo callers always pass the SHA-256 hash of
// the plain token to createMagicLink/findMagicLinkByHash/
// markMagicLinkUsed (migration 022). The plain token is never stored.
test('magic link tokens expire and can be marked used', () => {
  const { hashToken } = require('../server/auth/magic-link');
  const token = require('node:crypto').randomBytes(16).toString('hex');
  const tokenHash = hashToken(token);
  server.repos.auth.createMagicLink({ tokenHash, email: 'magic@example.com', ttlMinutes: 15 });
  const row = server.repos.auth.findMagicLinkByHash(tokenHash);
  assert.strictEqual(row.email, 'magic@example.com');
  assert.strictEqual(row.used_at, null);
  server.repos.auth.markMagicLinkUsed(tokenHash);
  const after = server.repos.auth.findMagicLinkByHash(tokenHash);
  assert.ok(after.used_at);
});

test('cleanupExpiredMagicLinks removes expired tokens', () => {
  const { hashToken } = require('../server/auth/magic-link');
  const token = require('node:crypto').randomBytes(16).toString('hex');
  const tokenHash = hashToken(token);
  server.repos.auth.createMagicLink({ tokenHash, email: 'old@example.com', ttlMinutes: -1 });
  const removed = server.repos.auth.cleanupExpiredMagicLinks();
  assert.ok(removed >= 1);
  assert.strictEqual(server.repos.auth.findMagicLinkByHash(tokenHash), null);
});
