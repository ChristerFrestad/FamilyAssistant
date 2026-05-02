// @ts-check
// State snapshot: persist in-memory state (primarily metrics) across
// restarts so that Prometheus counters do not reset on deploys.
//
// Design:
//   - One table (state_snapshots) with { type, data_json, created_at }
//   - Retention: at most 2 rows per type, oldest deleted first
//   - Freshness guarantee: if the latest row is older than STALE_MS, it is
//     considered "too old" by restore() and is not returned. On a
//     snapshot() writes a fresh row regardless (even if data is unchanged),
//     so this requirement always holds.
//   - Only "metrics" is registered for now. Rate limit is NOT persisted
//     (deliberate choice: reset-on-restart is the default and gives better UX for
//     legitimate users; see memory/feedback_state_snapshot.md).
//
// Lifecycle hooks are called from server/index.js:
//   1. At boot (after createRepositories, before createServer):
//        restoreAll(repos)
//   2. Daily cron at 03:30:
//        snapshotAll(repos)
//   3. On SIGTERM/SIGINT (graceful shutdown):
//        snapshotAll(repos)
//
// All errors are non-fatal — an error in snapshot/restore must never
// prevent the server from starting or stopping. They are logged via ctx.log.

const metrics = require('./http/metrics');
const { logger } = require('./logger');

// 72 hours = freshness limit for a "valid" snapshot
const STALE_MS = 72 * 3600 * 1000;

// Max number of rows to keep per type
const KEEP_PER_TYPE = 2;

// Registered serialize/hydrate pairs. We keep it open so we can later
// add more types (e.g. response-cache warmup) without touching
// lifecycle-hooks.
const registrations = new Map();

function register(type, { serialize, hydrate }) {
  if (typeof serialize !== 'function' || typeof hydrate !== 'function') {
    throw new Error(`state-snapshot.register(${type}): serialize and hydrate must be functions`);
  }
  registrations.set(type, { serialize, hydrate });
}

// Default registration: metrics is always included.
register('metrics', {
  serialize: () => metrics.serialize(),
  hydrate: (data) => metrics.hydrate(data),
});

function isStale(createdAt) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > STALE_MS;
}

/**
 * Write a snapshot of the given type to DB. Regardless of whether
 * the data actually changed — this guarantees freshness.
 */
function snapshotOne(repos, type) {
  const reg = registrations.get(type);
  if (!reg) {
    logger.warn({ type }, 'state-snapshot: no registration for type');
    return false;
  }
  try {
    const data = reg.serialize();
    const json = JSON.stringify(data);
    repos.stateSnapshots.insert(type, json);
    const trimmed = repos.stateSnapshots.trimToLast(type, KEEP_PER_TYPE);
    logger.info({ type, bytes: json.length, trimmed }, 'state-snapshot: saved');
    return true;
  } catch (err) {
    logger.error(
      { err: { message: err.message, stack: err.stack }, type },
      'state-snapshot: snapshot failed'
    );
    return false;
  }
}

/**
 * Get the latest snapshot from DB and call hydrate if it is not too old.
 * Returns true if hydration happened, false otherwise.
 */
function restoreOne(repos, type) {
  const reg = registrations.get(type);
  if (!reg) return false;
  try {
    const row = repos.stateSnapshots.getLatest(type);
    if (!row) {
      logger.info({ type }, 'state-snapshot: no previous snapshot found');
      return false;
    }
    if (isStale(row.createdAt)) {
      logger.warn(
        { type, createdAt: row.createdAt },
        'state-snapshot: too old, skipping hydration'
      );
      return false;
    }
    let data;
    try {
      data = JSON.parse(row.dataJson);
    } catch (err) {
      logger.error({ err: { message: err.message }, type }, 'state-snapshot: JSON parse failed');
      return false;
    }
    const ok = reg.hydrate(data);
    if (ok) {
      logger.info({ type, createdAt: row.createdAt }, 'state-snapshot: hydrated');
      return true;
    }
    logger.warn({ type }, 'state-snapshot: hydrate returned false');
    return false;
  } catch (err) {
    logger.error(
      { err: { message: err.message, stack: err.stack }, type },
      'state-snapshot: restore failed'
    );
    return false;
  }
}

function snapshotAll(repos) {
  const results = {};
  for (const type of registrations.keys()) {
    results[type] = snapshotOne(repos, type);
  }
  return results;
}

function restoreAll(repos) {
  const results = {};
  for (const type of registrations.keys()) {
    results[type] = restoreOne(repos, type);
  }
  return results;
}

// ============================================================
// Cron scheduling (daily at 03:30)
// ============================================================
// Between backup (03:00) and LLM cache cleanup (04:00). Own scheduler
// so the module is self-contained and does not require changes to cron.js.

let snapshotTimer = null;

function msUntilDaily(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function startSnapshotScheduler(repos, { hour = 3, minute = 30 } = {}) {
  function runAndReschedule() {
    snapshotAll(repos);
    snapshotTimer = setTimeout(runAndReschedule, 24 * 3600 * 1000);
    snapshotTimer.unref?.();
  }
  const ms = msUntilDaily(hour, minute);
  logger.info({ ms, hour, minute }, 'state-snapshot: daily scheduler started');
  snapshotTimer = setTimeout(runAndReschedule, ms);
  snapshotTimer.unref?.();
  return () => {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = null;
  };
}

function stopSnapshotScheduler() {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
}

module.exports = {
  register,
  snapshotOne,
  snapshotAll,
  restoreOne,
  restoreAll,
  startSnapshotScheduler,
  stopSnapshotScheduler,
  STALE_MS,
  KEEP_PER_TYPE,
};
