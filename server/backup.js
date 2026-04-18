// Automatisk SQLite-backup via VACUUM INTO
// - Daglig backup kl. 03:00
// - Beholder siste 14 backups, sletter eldre
// - Atomisk: VACUUM INTO gir en konsistent snapshot selv mens DB skrives til
// - M2.1: Off-site sync via rsync eller ren fil-kopi hvis BACKUP_REMOTE_PATH er satt.
//   BACKUP_REMOTE_PATH kan være:
//     - /mnt/nas/familieassistenten            → fs.copyFile til mount
//     - rsync://host/module/path               → rsync daemon-mode
//     - user@host:/remote/path                 → rsync over SSH
//   Feiler remote aldri serverens oppstart eller hovedbackupen — bare logges.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// BACKUP_DIR kan overrides via env (Dockerfile setter /app/data/backups).
// Må stemme med resolveringen i db.js slik at /ready og backup-scheduler
// leser/skriver samme katalog.
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

// Lazy-load for å unngå sirkulær avhengighet ved testing
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
    log('Kan ikke ta backup \u2014 db-referanse mangler');
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

    // M2.1: off-site sync — feil logges men blokkerer ikke lokal backup
    if (REMOTE_PATH) {
      syncToRemote(target).catch((err) => {
        log(`\u2717 Off-site sync feilet: ${err.message}`);
        // M4.3: varsle operator om off-site backup feiler
        alerting()
          .warning('Off-site backup feilet', {
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
    // M4.3: varsle operator — kritisk siden det betyr ingen recovery-point
    alerting()
      .critical('Lokal backup feilet', {
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
 * Klassifiser remote-path-typen.
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
    // Ren filkopi til mount-punkt. Caller sikrer at mount er mounted.
    if (!fs.existsSync(REMOTE_PATH)) {
      throw new Error(`Remote mount finnes ikke: ${REMOTE_PATH}`);
    }
    if (!fs.statSync(REMOTE_PATH).isDirectory()) {
      throw new Error(`Remote mount er ikke en mappe: ${REMOTE_PATH}`);
    }
    const target = path.join(REMOTE_PATH, path.basename(localFile));
    const tmp = target + '.tmp';
    fs.copyFileSync(localFile, tmp);
    fs.renameSync(tmp, target);
    const dur = Date.now() - startedAt;
    log(`\u2713 Off-site (mount) OK: ${target} (${dur} ms)`);
    return target;
  }

  // ssh eller rsync daemon — bruk rsync-kommandoen
  return new Promise((resolve, reject) => {
    const args = ['-a', '--timeout=30', '--partial', localFile, REMOTE_PATH];
    // Tving strict host key checking off er FARLIG — vi krever at admin har
    // konfigurert kjente hosts på forhånd (first-use, ssh-keyscan).
    const proc = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.stdout.on('data', () => {
      /* suge */
    });

    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      reject(new Error(`rsync timeout etter ${REMOTE_TIMEOUT_MS} ms`));
    }, REMOTE_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        reject(new Error('rsync er ikke installert — `sudo apt install rsync`'));
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
      log(`Slettet gammel backup: ${f.file}`);
    }
  } catch (err) {
    log(`Prune feilet: ${err.message}`);
  }
}

// Schedule daglig backup kl. 03:00
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
  log(`Daglig backup planlagt om ${Math.round(ms / 3600000)} timer (03:00)`);
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
