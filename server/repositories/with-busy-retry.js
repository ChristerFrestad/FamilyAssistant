'use strict';

/**
 * True when better-sqlite3 (or a compatible facade) reports a lock.
 * Matches SQLITE_BUSY and the "database is locked" message used by
 * some drivers / wrappers that omit a stable error code.
 * @param {unknown} err
 * @returns {boolean}
 */
function isSqliteBusy(err) {
  if (!err || typeof err !== 'object') return false;
  const code = /** @type {{ code?: unknown }} */ (err).code;
  if (code === 'SQLITE_BUSY') return true;
  const message = /** @type {{ message?: unknown }} */ (err).message;
  return typeof message === 'string' && /database is locked/i.test(message);
}

/**
 * Run `fn` once. If it throws SQLITE_BUSY / "database is locked",
 * retry exactly once. A second busy (or any other error) is rethrown.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function withBusyRetry(fn) {
  try {
    return fn();
  } catch (err) {
    if (!isSqliteBusy(err)) throw err;
    return fn();
  }
}

module.exports = { withBusyRetry, isSqliteBusy };
