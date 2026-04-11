// State-snapshot: persist in-memory state (primært metrics) på tvers av
// restarts slik at Prometheus-tellere ikke resetter ved deploys.
//
// Design:
//   - Én tabell (state_snapshots) med { type, data_json, created_at }
//   - Retention: maks 2 rader per type, eldste slettes først
//   - Ferskhetsgaranti: hvis seneste rad er eldre enn STALE_MS, betraktes
//     den som "for gammel" ved restore() og returneres ikke. Ved en
//     snapshot() skrives en fersk uansett (også hvis data er uendret),
//     slik at dette kravet alltid holder.
//   - Kun "metrics" er registrert per nå. Rate limit persisteres IKKE
//     (bevisst valg: reset-ved-restart er standard og gir bedre UX for
//     legitime brukere; se memory/feedback_state_snapshot.md).
//
// Livssyklus-hooks kalles fra server/index.js:
//   1. Ved boot (etter createRepositories, før createServer):
//        restoreAll(repos)
//   2. Daglig cron kl. 03:30:
//        snapshotAll(repos)
//   3. Ved SIGTERM/SIGINT (graceful shutdown):
//        snapshotAll(repos)
//
// Alle feil er ikke-fatale — en feil i snapshot/restore skal aldri
// hindre serveren fra å starte eller stoppe. De logges via ctx.log.

const metrics = require('./http/metrics');
const { logger } = require('./logger');

// 72 timer = ferskhetsgrense for "gyldig" snapshot
const STALE_MS = 72 * 3600 * 1000;

// Maks antall rader å beholde per type
const KEEP_PER_TYPE = 2;

// Registrerte serialize/hydrate-par. Holder det åpent slik at vi senere
// kan legge til flere typer (f.eks. response-cache-warmup) uten å røre
// lifecycle-hooks.
const registrations = new Map();

function register(type, { serialize, hydrate }) {
  if (typeof serialize !== 'function' || typeof hydrate !== 'function') {
    throw new Error(`state-snapshot.register(${type}): serialize og hydrate må være funksjoner`);
  }
  registrations.set(type, { serialize, hydrate });
}

// Default-registrering: metrics er alltid med.
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
 * Skriv en snapshot av gitt type til DB. Uavhengig av om dataen
 * faktisk har endret seg — dette garanterer ferskhet.
 */
function snapshotOne(repos, type) {
  const reg = registrations.get(type);
  if (!reg) {
    logger.warn({ type }, 'state-snapshot: ingen registrering for type');
    return false;
  }
  try {
    const data = reg.serialize();
    const json = JSON.stringify(data);
    repos.stateSnapshots.insert(type, json);
    const trimmed = repos.stateSnapshots.trimToLast(type, KEEP_PER_TYPE);
    logger.info({ type, bytes: json.length, trimmed }, 'state-snapshot: lagret');
    return true;
  } catch (err) {
    logger.error(
      { err: { message: err.message, stack: err.stack }, type },
      'state-snapshot: snapshot feilet'
    );
    return false;
  }
}

/**
 * Hent nyeste snapshot fra DB og kall hydrate hvis den ikke er for gammel.
 * Returnerer true hvis hydratisering skjedde, false ellers.
 */
function restoreOne(repos, type) {
  const reg = registrations.get(type);
  if (!reg) return false;
  try {
    const row = repos.stateSnapshots.getLatest(type);
    if (!row) {
      logger.info({ type }, 'state-snapshot: ingen tidligere snapshot funnet');
      return false;
    }
    if (isStale(row.createdAt)) {
      logger.warn(
        { type, createdAt: row.createdAt },
        'state-snapshot: for gammel, hopper over hydratisering'
      );
      return false;
    }
    let data;
    try {
      data = JSON.parse(row.dataJson);
    } catch (err) {
      logger.error({ err: { message: err.message }, type }, 'state-snapshot: JSON-parse feilet');
      return false;
    }
    const ok = reg.hydrate(data);
    if (ok) {
      logger.info({ type, createdAt: row.createdAt }, 'state-snapshot: hydratisert');
      return true;
    }
    logger.warn({ type }, 'state-snapshot: hydrate returnerte false');
    return false;
  } catch (err) {
    logger.error(
      { err: { message: err.message, stack: err.stack }, type },
      'state-snapshot: restore feilet'
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
// Cron-scheduling (daglig kl. 03:30)
// ============================================================
// Mellom backup (03:00) og LLM-cache-cleanup (04:00). Egen scheduler
// slik at modulen er selvstendig og ikke krever endringer i cron.js.

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
  logger.info({ ms, hour, minute }, 'state-snapshot: daglig scheduler startet');
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
