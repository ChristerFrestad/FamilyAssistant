// Password hashing via Node crypto.scrypt — no extra npm dependency.
//
// Stored format:
//   scrypt$N$r$p$salt_b64$key_b64
//
// Parameters chosen for a self-host family app on RPi5: ~50–100 ms per
// hash on Pi-class hardware, still expensive for offline brute force.

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const N = 16384; // 2^14
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const PREFIX = 'scrypt';

// Fixed dummy hash used when the user row is missing so login timing
// does not leak account existence. Generated once at module load.
let DUMMY_HASH = null;

async function ensureDummy() {
  if (DUMMY_HASH) return DUMMY_HASH;
  DUMMY_HASH = await hashPassword('dummy-password-not-a-real-user');
  return DUMMY_HASH;
}

function parseHash(encoded) {
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return null;
  try {
    const salt = Buffer.from(parts[4], 'base64');
    const key = Buffer.from(parts[5], 'base64');
    if (salt.length < 8 || key.length < 16) return null;
    return { n, r, p, salt, key };
  } catch {
    return null;
  }
}

async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPassword: password required');
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await scryptAsync(plain, salt, KEY_LEN, { N, r: R, p: P });
  return [
    PREFIX,
    String(N),
    String(R),
    String(P),
    salt.toString('base64'),
    Buffer.from(key).toString('base64'),
  ].join('$');
}

async function verifyPassword(plain, encoded) {
  const parsed = parseHash(encoded);
  if (!parsed) {
    // Run a dummy scrypt so timing stays roughly constant.
    await ensureDummy();
    return false;
  }
  if (typeof plain !== 'string') return false;
  const key = await scryptAsync(plain, parsed.salt, parsed.key.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
  });
  const a = Buffer.from(key);
  const b = parsed.key;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Verify against a real hash, or against the dummy hash when missing. */
async function verifyPasswordOrDummy(plain, encoded) {
  if (encoded) return verifyPassword(plain, encoded);
  const dummy = await ensureDummy();
  await verifyPassword(plain, dummy);
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
  parseHash,
  // exported for tests
  N,
  R,
  P,
  KEY_LEN,
};
