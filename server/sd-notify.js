// systemd sd_notify support (M2.2)
//
// systemd setter NOTIFY_SOCKET i environment til en Unix socket (AF_UNIX)
// when the service has Type=notify. We can then send READY=1, WATCHDOG=1 and
// STATUS=<tekst> som datagrammer.
//
// Pure-Node implementation — no external dependency. Works only on
// Linux (Windows har ingen NOTIFY_SOCKET, alle kall blir no-ops).
//
// Bruk:
//   const sd = require('./sd-notify');
//   sd.ready();                   // etter at serveren lytter og er klar
//   sd.status('Running');         // valgfritt, vises i systemctl status
//   sd.startWatchdog();           // hvis WATCHDOG_USEC er satt i env
//   sd.stopping();                // ved graceful shutdown start

const { logger } = require('./logger');

const NOTIFY_SOCKET = process.env.NOTIFY_SOCKET || '';
const WATCHDOG_USEC = Number(process.env.WATCHDOG_USEC || 0);

// Hvis socket-pathen starter med '@' er det en abstract-namespace socket
// (Linux-specific) — prefix with null-byte before send.
function socketAddress() {
  if (!NOTIFY_SOCKET) return null;
  if (NOTIFY_SOCKET.startsWith('@')) return '\u0000' + NOTIFY_SOCKET.slice(1);
  return NOTIFY_SOCKET;
}

function notify(message) {
  const addr = socketAddress();
  if (!addr) return false;

  // Use unix-dgram? Node has none built-in, so we use net.createConnection
  // med AF_UNIX SOCK_DGRAM — dette krever dgram.createSocket som _ikke_
  // supports unix. Solution: use an external command? No — use fs tricks?
  //
  // Simplest portable solution: spawn `systemd-notify` binary.
  // systemd-notify exists on all systems where NOTIFY_SOCKET is set.
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('systemd-notify', [message], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 2000,
    });
    if (result.status === 0) return true;
    // Fall-back: stille, men logg debug
    if (result.error && result.error.code !== 'ENOENT') {
      logger.debug({ err: result.error.message, message }, 'systemd-notify feilet');
    }
    return false;
  } catch (err) {
    logger.debug({ err: err.message }, 'sd-notify exception');
    return false;
  }
}

function ready() {
  return notify('READY=1');
}

function stopping() {
  return notify('STOPPING=1');
}

function status(text) {
  if (!text) return false;
  const safe = String(text).replace(/\n/g, ' ').slice(0, 200);
  return notify(`STATUS=${safe}`);
}

function watchdog() {
  return notify('WATCHDOG=1');
}

function reloading() {
  return notify('RELOADING=1');
}

// ============================================================
// Watchdog scheduler
// ============================================================
//
// Hvis systemd service har WatchdogSec=N settes WATCHDOG_USEC til N*1e6.
// We must send WATCHDOG=1 more often than half the interval,
// ellers restarter systemd prosessen.

let watchdogTimer = null;

function startWatchdog() {
  if (!NOTIFY_SOCKET || !WATCHDOG_USEC) return () => {};
  const intervalMs = Math.floor(WATCHDOG_USEC / 1000 / 2); // halvparten av timeout
  if (intervalMs < 500) {
    logger.warn({ WATCHDOG_USEC }, 'Watchdog-intervall er for lavt (<500ms), skipper');
    return () => {};
  }
  logger.info(
    { intervalMs, timeoutMs: Math.floor(WATCHDOG_USEC / 1000) },
    'sd-notify watchdog startet'
  );
  watchdogTimer = setInterval(() => {
    watchdog();
  }, intervalMs);
  watchdogTimer.unref();
  return stopWatchdog;
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function isActive() {
  return Boolean(NOTIFY_SOCKET);
}

module.exports = {
  ready,
  stopping,
  status,
  watchdog,
  reloading,
  startWatchdog,
  stopWatchdog,
  isActive,
};
