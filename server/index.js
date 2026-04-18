// Familieassistenten \u2014 Backend Server (Fase 2 refaktor)
//
// Denne filen er n\u00e5 kun bootstrap. All logikk er fordelt p\u00e5:
//   config.js, logger.js, db.js, repositories.js
//   http/server.js, http/router.js, http/errors.js, http/middleware.js
//   services/*, routes.js, schemas.js

const { config } = require('./config');
const { logger } = require('./logger');
const { initDB, closeDB } = require('./db');
const { createRepositories } = require('./repositories');
const { seedIfEmpty, ensureCurrentWeek } = require('./services/seed.service');
const { startCronJobs, stopCronJobs } = require('./cron');
const { scheduleDailyBackup, stopBackupScheduler, backupNow } = require('./backup');
const { isLLMAvailable } = require('./llm');
const { isSTTAvailable } = require('./stt');

const { createRouter } = require('./http/router');
const { createServer } = require('./http/server');
const { registerRoutes } = require('./routes');
const { startRateLimitCleanup } = require('./http/security');
const { createAuthenticate } = require('./auth/middleware');
const stateSnapshot = require('./state-snapshot');
const sdNotify = require('./sd-notify');
const alerting = require('./alerting');

// ============================================================
// Global error handlers
// ============================================================

process.on('uncaughtException', (err) => {
  logger.fatal({ err: { message: err.message, stack: err.stack } }, 'uncaughtException');
  // M4.3: fire-and-forget alert. shouldThrottle hindrer spam.
  alerting
    .fatal('uncaughtException', {
      detail: err.message,
      context: { stack: err.stack?.split('\n').slice(0, 10).join('\n') },
      key: 'uncaughtException',
    })
    .catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandledRejection');
  alerting
    .fatal('unhandledRejection', {
      detail: String(reason?.message || reason).slice(0, 500),
      key: 'unhandledRejection',
    })
    .catch(() => {});
});

// ============================================================
// State
// ============================================================

const serverState = {
  startedAt: Date.now(),
  ready: false,
  driver: 'none',
};

let dbHandle = null;
let repos = null;
let server = null;
let stopRateLimitCleanup = null;
let stopStateSnapshot = null;
let stopWatchdog = null;

// ============================================================
// Startup
// ============================================================

async function startServer() {
  logger.info('Starter Familieassistenten...');

  // 1. Initialiser database
  dbHandle = await initDB();
  serverState.driver = dbHandle.driver;
  repos = createRepositories(dbHandle.db);

  // 2. Seed og sikre current week
  try {
    seedIfEmpty(repos);
  } catch (e) {
    throw new Error(`Seed feilet — DB kan være korrupt: ${e.message}`, { cause: e });
  }
  ensureCurrentWeek(repos);

  // 2b. Hydratiser persistert state (metrics) fra forrige run
  try {
    stateSnapshot.restoreAll(repos);
  } catch (e) {
    logger.warn({ err: e.message }, 'state-snapshot restore feilet');
  }

  // 3. Bygg router + registrer ruter
  const router = createRouter();
  registerRoutes(router, { repos, serverState });

  // 4. Lag HTTP-server med authentication middleware
  const authenticate = createAuthenticate(repos);
  server = createServer(router, { authenticate });

  // 5. Start lytting
  await new Promise((resolve) => {
    server.listen(config.PORT, '0.0.0.0', resolve);
  });

  serverState.ready = true;
  logger.info(
    {
      port: config.PORT,
      driver: dbHandle.driver,
      fts5: repos.hasFTS,
      nodeEnv: config.NODE_ENV,
      routes: router.routes.length,
      sdNotifyActive: sdNotify.isActive(),
    },
    `Familieassistenten kj\u00f8rer p\u00e5 http://localhost:${config.PORT}`
  );

  // M2.2: signaliser READY til systemd + start watchdog
  sdNotify.ready();
  sdNotify.status(`Ready on :${config.PORT} (driver=${dbHandle.driver})`);
  stopWatchdog = sdNotify.startWatchdog();

  // 6. Start cron + backup + rate-limit cleanup + state-snapshot
  startCronJobs(repos);
  scheduleDailyBackup(dbHandle.db);
  stopRateLimitCleanup = startRateLimitCleanup();
  stopStateSnapshot = stateSnapshot.startSnapshotScheduler(repos);

  // 7. Sjekk LLM/STT-tilgjengelighet (ikke-blokkerende)
  isLLMAvailable()
    .then((status) => {
      if (status.available) {
        logger.info({ backend: status.backend, models: status.models }, 'LLM tilgjengelig');
      } else {
        logger.warn({ backend: status.backend }, 'LLM ikke tilgjengelig — chat er deaktivert');
      }
    })
    .catch((err) => logger.warn({ err: err.message }, 'LLM tilgjengelighetssjekk feilet'));
  isSTTAvailable()
    .then((status) => {
      if (status.available) {
        logger.info({ backend: status.backend }, 'STT tilgjengelig');
      } else {
        logger.info('STT ikke installert — bruker nettleser Web Speech API');
      }
    })
    .catch((err) => logger.warn({ err: err.message }, 'STT tilgjengelighetssjekk feilet'));
}

// ============================================================
// Graceful shutdown
// ============================================================

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  serverState.ready = false;
  logger.info({ signal }, 'Starter graceful shutdown');

  // M2.2: si ifra til systemd at vi er på vei ned — ellers kan systemd tolke
  // en lang shutdown som at prosessen har hengt og SIGKILLe den.
  try {
    sdNotify.stopping();
  } catch {}
  try {
    stopWatchdog?.();
  } catch {}

  if (server) {
    server.close((err) => {
      if (err) logger.error({ err }, 'Feil ved HTTP server close');
      else logger.info('HTTP-server lukket');
    });
  }

  try {
    stopCronJobs();
  } catch (e) {
    logger.error({ err: e }, 'Cron stop feilet');
  }
  try {
    stopBackupScheduler();
  } catch (e) {
    logger.error({ err: e }, 'Backup stop feilet');
  }
  try {
    stopRateLimitCleanup?.();
  } catch (e) {
    logger.error({ err: e }, 'RL cleanup stop feilet');
  }
  try {
    stopStateSnapshot?.();
  } catch (e) {
    logger.error({ err: e }, 'State-snapshot stop feilet');
  }

  // Persister in-memory state (metrics) før DB stenger
  try {
    if (repos) stateSnapshot.snapshotAll(repos);
  } catch (e) {
    logger.warn({ err: e.message }, 'State-snapshot ved shutdown feilet');
  }

  // Flush eventuelle pending writes (sql.js adapter) før backup
  try {
    if (dbHandle?.db?.flush) dbHandle.db.flush();
  } catch (e) {
    logger.warn({ err: e.message }, 'sql.js flush feilet');
  }

  try {
    if (dbHandle?.db) backupNow(dbHandle.db);
  } catch (e) {
    logger.warn({ err: e.message }, 'Avslutningsbackup feilet');
  }

  try {
    closeDB(dbHandle);
  } catch (e) {
    logger.error({ err: e }, 'DB close feilet');
  }

  const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS || 5000);
  setTimeout(() => {
    logger.info('Shutdown komplett');
    process.exit(0);
  }, shutdownTimeoutMs).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch((err) => {
  logger.fatal({ err: { message: err.message, stack: err.stack } }, 'Oppstartsfeil');
  process.exit(1);
});
