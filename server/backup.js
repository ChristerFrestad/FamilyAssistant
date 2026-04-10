// Automatisk SQLite-backup via VACUUM INTO
// - Daglig backup kl. 03:00
// - Beholder siste 14 backups, sletter eldre
// - Atomisk: VACUUM INTO gir en konsistent snapshot selv mens DB skrives til

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const KEEP_DAYS = 14;

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
    log(`\u2713 Backup skrevet: ${path.basename(target)} (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
    pruneOldBackups();
    return target;
  } catch (err) {
    log(`\u2717 Backup feilet: ${err.message}`);
    return null;
  }
}

function pruneOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^familieassistenten-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .map(f => ({ file: f, full: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
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
  }

  const ms = nextRunMs();
  log(`Daglig backup planlagt om ${Math.round(ms / 3600000)} timer (03:00)`);
  backupTimer = setTimeout(runAndReschedule, ms);
}

function stopBackupScheduler() {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
}

module.exports = { backupNow, scheduleDailyBackup, stopBackupScheduler, BACKUP_DIR };
