// Automatic SQLite backup via VACUUM INTO
// - Daily backup at 03:00
// - Keeps the last 14 backups, deletes older ones
// - Atomic: VACUUM INTO gives a consistent snapshot even while the DB is
//   being written to
// - M2.1: Off-site sync via rsync or plain file copy if BACKUP_REMOTE_PATH
//   is set. BACKUP_REMOTE_PATH can be:
//     - /mnt/nas/familyassistant               → fs.copyFile to mount
//     - rsync://host/module/path               → rsync daemon mode
//     - user@host:/remote/path                 → rsync over SSH
//   Remote failure never affects server startup or the main backup —
//   only logged.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// BACKUP_DIR can be overridden via env (Dockerfile sets /app/data/backups).
// Must match the resolution in db.js so /ready and the backup scheduler
// read/write the same directory.
const BACKUP_DIR =
  process.env.BACKUP_DIR ||
  path.join(
    path.dirname(
      process.env.DB_PATH || path.join(__dirname, '..', 'data', 'familieassistenten.db')
    ),
    'backups'
  );
const KEEP_DAYS = 14;
const REMOTE_PATH = process.env.BACKUP_REMOTE_PATH || '';
const REMOTE_TIMEOUT_MS = Number(process.env.BACKUP_REMOTE_TIMEOUT_MS || 60_000);

// Lazy-load to avoid circular dependency during testing
let _alerting = null;
function alerting() {
  if (!_alerting) _alerting = require('./alerting');
  return _alerting;
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[BACKUP ${ts}] ${msg}`);
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupNow(db) {
  if (!db || typeof db.prepare !== 'function') {
    log('Cannot take backup \u2014 db reference missing');
    return null;
  }
  ensureBackupDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `familieassistenten-${stamp}.db`);
  try {
    if (db._isSqlJs) {
      // sql.js st\u00f8tter ikke VACUUM INTO; kopi\u00e9r hele .db-filen i stedet
      const { DB_PATH } = require('./db');
      db._persist(); // sikre at nyeste endringer er p\u00e5 disk
      fs.copyFileSync(DB_PATH, target);
    } else {
      // better-sqlite3: VACUUM INTO er atomisk og kan kj\u00f8res mot en live DB
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    }
    log(
      `\u2713 Backup skrevet: ${path.basename(target)} (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`
    );
    pruneOldBackups();

    // M2.1: off-site sync — errors are logged but do not block local backup
    if (REMOTE_PATH) {
      syncToRemote(target).catch((err) => {
        log(`\u2717 Off-site sync feilet: ${err.message}`);
        // M4.3: notify operator when off-site backup fails
        alerting()
          .warning('Off-site backup failed', {
            detail: err.message,
            context: { remote: REMOTE_PATH.replace(/:.*@/, ':***@') },
            key: 'backup_remote_failed',
          })
          .catch(() => {});
      });
    }

    return target;
  } catch (err) {
    log(`\u2717 Backup feilet: ${err.message}`);
    // M4.3: notify operator — critical because it means no recovery point
    alerting()
      .critical('Local backup failed', {
        detail: err.message,
        key: 'backup_local_failed',
      })
      .catch(() => {});
    return null;
  }
}

// ============================================================
// Off-site sync (M2.1)
// ============================================================

/**
 * Classify the remote-path type.
 * - "/mnt/nas/dir" eller "C:\\nas\\dir" → 'mount' (fs.copyFile)
 * - "user@host:/path" → 'ssh' (rsync over ssh)
 * - "rsync://host/module" → 'rsync' (rsync daemon)
 * - alt annet behandles som mount-path
 */
function classifyRemote(remotePath) {
  if (/^rsync:\/\//i.test(remotePath)) return 'rsync';
  if (/^[\w.-]+@[\w.-]+:/.test(remotePath)) return 'ssh';
  return 'mount';
}

async function syncToRemote(localFile) {
  const kind = classifyRemote(REMOTE_PATH);
  const startedAt = Date.now();

  if (kind === 'mount') {
    // Plain file copy to the mount point. Caller ensures mount is mounted.
    if (!fs.existsSync(REMOTE_PATH)) {
      throw new Error(`Remote mount does not exist: ${REMOTE_PATH}`);
    }
    if (!fs.statSync(REMOTE_PATH).isDirectory()) {
      throw new Error(`Remote mount is not a directory: ${REMOTE_PATH}`);
    }
    const target = path.join(REMOTE_PATH, path.basename(localFile));
    const tmp = target + '.tmp';
    fs.copyFileSync(localFile, tmp);
    fs.renameSync(tmp, target);
    const dur = Date.now() - startedAt;
    log(`\u2713 Off-site (mount) OK: ${target} (${dur} ms)`);
    return target;
  }

  // ssh or rsync daemon — use the rsync command
  return new Promise((resolve, reject) => {
    const args = ['-a', '--timeout=30', '--partial', localFile, REMOTE_PATH];
    // Forcing strict host key checking off is DANGEROUS — we require admin to have
    // configured known hosts in advance (first-use, ssh-keyscan).
    const proc = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.stdout.on('data', () => {
      /* drain */
    });

    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      reject(new Error(`rsync timeout after ${REMOTE_TIMEOUT_MS} ms`));
    }, REMOTE_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        reject(new Error('rsync is not installed — `sudo apt install rsync`'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      const dur = Date.now() - startedAt;
      if (code === 0) {
        log(`\u2713 Off-site (${kind}) OK: ${REMOTE_PATH} (${dur} ms)`);
        resolve(REMOTE_PATH);
      } else {
        reject(new Error(`rsync exit ${code}: ${stderr.trim().slice(0, 200)}`));
      }
    });
  });
}

function pruneOldBackups() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^familieassistenten-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .map((f) => ({
        file: f,
        full: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    const toRemove = files.slice(KEEP_DAYS);
    for (const f of toRemove) {
      fs.unlinkSync(f.full);
      log(`Deleted old backup: ${f.file}`);
    }
  } catch (err) {
    log(`Prune failed: ${err.message}`);
  }
}

// Schedule daily backup at 03:00
let backupTimer = null;
function scheduleDailyBackup(db) {
  function nextRunMs() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(3, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  function runAndReschedule() {
    backupNow(db);
    backupTimer = setTimeout(runAndReschedule, nextRunMs());
    backupTimer.unref?.();
  }

  const ms = nextRunMs();
  log(`Daily backup scheduled in ${Math.round(ms / 3600000)} hours (03:00)`);
  backupTimer = setTimeout(runAndReschedule, ms);
  backupTimer.unref?.();
}

function stopBackupScheduler() {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
}

module.exports = {
  backupNow,
  scheduleDailyBackup,
  stopBackupScheduler,
  BACKUP_DIR,
  // Test-eksponerte helpers
  _classifyRemote: classifyRemote,
  _syncToRemote: syncToRemote,
};
