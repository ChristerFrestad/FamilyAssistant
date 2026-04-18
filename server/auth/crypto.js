// AES-256-GCM symmetric encryption for secrets stored at rest.
//
// Used to protect per-family LLM API keys in family_llm_config.api_key_encrypted.
// The key is derived from the ENCRYPTION_KEY environment variable (32 bytes hex).
//
// Ciphertext format (base64-encoded): iv (12 bytes) || authTag (16 bytes) || ciphertext
//
// Rotation: if ENCRYPTION_KEY changes, existing ciphertexts become unreadable.
// A separate scripts/rotate-encryption-key.js is expected to re-encrypt all rows
// using the old key first and the new key second.

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function resolveKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`.');
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars).`);
  }
  return buf;
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(ciphertext) {
  if (ciphertext == null || ciphertext === '') return null;
  const key = resolveKey();
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Ciphertext is too short to be valid.');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

module.exports = { encrypt, decrypt, randomToken, sha256 };
