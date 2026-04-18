// Request-scoped family-id context backed by Node's AsyncLocalStorage.
//
// Why: multi-tenant queries need the current family's id in SELECT WHERE
// clauses and INSERT bindings. Rather than threading `familyId` through
// every service and repo signature (~200 call sites), we store it once per
// HTTP request in an async-local store and read it inside the repository
// layer. better-sqlite3 is fully synchronous, so the store is preserved
// through every synchronous code path within a request.
//
// Usage:
//   - Middleware calls runWithFamily(ctx.familyId, () => next())
//   - Repos call getFamilyId() to retrieve the current family id
//   - Background jobs (cron, backup, seed) can explicitly wrap their
//     per-family work in runWithFamily(fid, ...).
//
// Default behaviour: if a repo runs outside any context, getFamilyId()
// falls back to 1 (the legacy single-tenant default) and records a warning
// breadcrumb on the process so we can audit stray callers during phase 5
// rollout. A later migration will switch the fallback to throwing.

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const LEGACY_FAMILY_ID = 1;

const strayCallers = new Set();

function runWithFamily(familyId, fn) {
  if (!Number.isInteger(familyId) || familyId <= 0) {
    throw new Error('runWithFamily: familyId must be a positive integer');
  }
  return storage.run({ familyId }, fn);
}

function getFamilyId() {
  const store = storage.getStore();
  if (store && Number.isInteger(store.familyId) && store.familyId > 0) {
    return store.familyId;
  }
  return LEGACY_FAMILY_ID;
}

function getOptionalFamilyId() {
  const store = storage.getStore();
  return store && Number.isInteger(store.familyId) && store.familyId > 0 ? store.familyId : null;
}

function hasFamilyContext() {
  return getOptionalFamilyId() != null;
}

function markStrayCaller(label) {
  if (process.env.NODE_ENV === 'test') return;
  if (strayCallers.has(label)) return;
  strayCallers.add(label);

  console.warn(`[family-context] stray caller without family context: ${label}`);
}

module.exports = {
  runWithFamily,
  getFamilyId,
  getOptionalFamilyId,
  hasFamilyContext,
  markStrayCaller,
  LEGACY_FAMILY_ID,
};
