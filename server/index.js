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
const sentry = require('./observability/sentry');

// ============================================================
// Global error handlers
// ============================================================

process.on('uncaughtException', (err) => {
  logger.fatal({ err: { message: err.message, stack: err.stack } }, 'uncaughtException');
  sentry.captureException(err);
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
  sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
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
  logger.info('Starting FamilyAssistant...');

  // Phase 22: loud signal when the server is in bootstrap mode so
  // operators can tell at a glance whether the setup wizard will pick
  // up, instead of wondering why AUTH_TOKEN "went missing". This is
  // the *only* time a missing AUTH_TOKEN is acceptable in production.
  if (config.BOOTSTRAP_MODE) {
    logger.warn(
      { setupUrl: `/setup.html`, port: config.PORT },
      `🔧 BOOTSTRAP MODE ACTIVE — open http://<host>:${config.PORT}/setup.html to finish setup. No AUTH_TOKEN required until the wizard completes.`
    );
  }

  // Phase 17: initialize Sentry as early as possible so startup failures
  // (seed, migration) can be captured too. No-op if SENTRY_DSN is unset
  // or @sentry/node is not installed.
  sentry.initSentry(config, logger);

  // 1. Initialise database
  dbHandle = await initDB();
  serverState.driver = dbHandle.driver;
  repos = createRepositories(dbHandle.db);

  // 2. Seed and ensure current week
  try {
    seedIfEmpty(repos);
  } catch (e) {
    throw new Error(`Seed failed — DB may be corrupt: ${e.message}`, { cause: e });
  }
  ensureCurrentWeek(repos);

  // 2b. Hydrate persisted state (metrics) from previous run
  try {
    stateSnapshot.restoreAll(repos);
  } catch (e) {
    logger.warn({ err: e.message }, 'state-snapshot restore failed');
  }

  // 3. Build router + register routes
  const router = createRouter();
  registerRoutes(router, { repos, serverState });

  // 4. Build HTTP server with authentication middleware
  const authenticate = createAuthenticate(repos);
  server = createServer(router, { authenticate });

  // 5. Start listening
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

  // 7. Check LLM/STT availability (non-blocking)
  isLLMAvailable()
    .then((status) => {
      if (status.available) {
        logger.info({ backend: status.backend, models: status.models }, 'LLM available');
      } else {
        logger.warn({ backend: status.backend }, 'LLM not available — chat is disabled');
      }
    })
    .catch((err) => logger.warn({ err: err.message }, 'LLM availability check failed'));
  isSTTAvailable()
    .then((status) => {
      if (status.available) {
        logger.info({ backend: status.backend }, 'STT available');
      } else {
        logger.info('STT not installed — using browser Web Speech API');
      }
    })
    .catch((err) => logger.warn({ err: err.message }, 'STT availability check failed'));
}

// ============================================================
// Graceful shutdown
// ============================================================

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  serverState.ready = false;
  logger.info({ signal }, 'Starting graceful shutdown');

  // M2.2: notify systemd that we are shutting down — otherwise systemd may
  // interpret a long shutdown as a hung process and SIGKILL it.
  try {
    sdNotify.stopping();
  } catch {}
  try {
    stopWatchdog?.();
  } catch {}

  if (server) {
    server.close((err) => {
      if (err) logger.error({ err }, 'Error during HTTP server close');
      else logger.info('HTTP server closed');
    });
  }

  try {
    stopCronJobs();
  } catch (e) {
    logger.error({ err: e }, 'Cron stop failed');
  }
  try {
    stopBackupScheduler();
  } catch (e) {
    logger.error({ err: e }, 'Backup stop failed');
  }
  try {
    stopRateLimitCleanup?.();
  } catch (e) {
    logger.error({ err: e }, 'RL cleanup stop failed');
  }
  try {
    stopStateSnapshot?.();
  } catch (e) {
    logger.error({ err: e }, 'State-snapshot stop failed');
  }

  // Persist in-memory state (metrics) before DB closes
  try {
    if (repos) stateSnapshot.snapshotAll(repos);
  } catch (e) {
    logger.warn({ err: e.message }, 'State-snapshot ved shutdown feilet');
  }

  // Flush any pending writes (sql.js adapter) before backup
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
