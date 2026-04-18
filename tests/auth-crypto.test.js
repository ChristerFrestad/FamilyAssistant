'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// ENCRYPTION_KEY must be set before requiring the module.
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const { encrypt, decrypt, randomToken, sha256 } = require('../server/auth/crypto');

test('encrypt/decrypt roundtrip returns the same plaintext', () => {
  const plaintext = 'sk-abcdef-1234-apitoken';
  const ciphertext = encrypt(plaintext);
  assert.ok(typeof ciphertext === 'string' && ciphertext.length > 0);
  assert.notStrictEqual(ciphertext, plaintext);
  assert.strictEqual(decrypt(ciphertext), plaintext);
});

test('encrypt produces different ciphertexts for identical plaintext (random IV)', () => {
  const a = encrypt('hello');
  const b = encrypt('hello');
  assert.notStrictEqual(a, b);
  assert.strictEqual(decrypt(a), 'hello');
  assert.strictEqual(decrypt(b), 'hello');
});

test('encrypt returns null for null or empty input', () => {
  assert.strictEqual(encrypt(null), null);
  assert.strictEqual(encrypt(''), null);
  assert.strictEqual(encrypt(undefined), null);
});

test('decrypt returns null for null or empty input', () => {
  assert.strictEqual(decrypt(null), null);
  assert.strictEqual(decrypt(''), null);
});

test('decrypt throws on tampered ciphertext', () => {
  const ciphertext = encrypt('secret');
  const buf = Buffer.from(ciphertext, 'base64');
  buf[buf.length - 1] ^= 0xff; // flip a bit in the actual ciphertext
  const tampered = buf.toString('base64');
  assert.throws(() => decrypt(tampered));
});

test('decrypt throws on too-short ciphertext', () => {
  assert.throws(() => decrypt('short'), /too short/);
});

test('randomToken produces hex string of expected length', () => {
  const t = randomToken(32);
  assert.match(t, /^[0-9a-f]{64}$/);
  const short = randomToken(8);
  assert.match(short, /^[0-9a-f]{16}$/);
});

test('sha256 produces stable hex digest', () => {
  assert.strictEqual(sha256('foo'), sha256('foo'));
  assert.notStrictEqual(sha256('foo'), sha256('bar'));
  assert.match(sha256('anything'), /^[0-9a-f]{64}$/);
});
