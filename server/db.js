// Database-lag (Fase 1: rent relasjonelt, ingen KV-blobs)
//
// Prim\u00e6rt: better-sqlite3 (synkron, rask p\u00e5 RPI5)
// Fallback: sql.js via adapter (pure JS, fungerer p\u00e5 Windows uten VS Build Tools)
//
// Eksporterer:
//   initDB()      \u2192 returnerer Promise<database-handle>
//   closeDB(h)    \u2192 lukker tilkobling ved nedstengning

const fs = require('fs');
const path = require('path');
const { runMigrations } = require('./migrations');

// DB_PATH kan overrides via env (brukes av integrasjonstester for isolert DB).
// Ellers brukes standardplasseringen under ./data/.
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DATA_DIR, 'familieassistenten.db');
const DATA_DIR = path.dirname(DB_PATH);
// BACKUP_DIR kan overrides via env (Dockerfile setter /app/data/backups).
// Faller tilbake til DATA_DIR/backups for bare-metal / dev.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');

function ensureWritableDir(dir, label) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS') {
      throw new Error(
        `Kan ikke opprette ${label} (${dir}): ${err.code}. ` +
          `Prosessen mangler skrivetilgang. Sjekk at:\n` +
          `  1. A persistent volume is mounted at ${DATA_DIR} ` +
          `(Docker: 'volumes: - ./data:/app/data'; Portainer: legg til volume i stack-config).\n` +
          `  2. Volumet eies av container-brukeren (distroless 'nonroot' = UID 65532). ` +
          `Fix: 'chown -R 65532:65532 <host-path>' on host, eller bygg imaget ` +
          `slik at ${DATA_DIR} pre-eksisterer med riktig ownership.\n` +
          `  3. Alternativt: sett DB_PATH og BACKUP_DIR til en skrivbar path via env.`,
        { cause: err }
      );
    }
    throw err;
  }
}

function ensureDataDir() {
  ensureWritableDir(DATA_DIR, 'datakatalog');
  ensureWritableDir(BACKUP_DIR, 'backup-katalog');
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[DB ${ts}] ${msg}`);
}

// ============================================================
// SQLite-initialisering
// ============================================================

function tryBetterSqlite3() {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    log(`better-sqlite3 ikke tilgjengelig (${err.code || err.message})`);
    return null;
  }

  try {
    const db = new Database(DB_PATH);
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('temp_store = MEMORY');
    log('better-sqlite3 tilkoblet (WAL, FK=ON)');
    runMigrations(db);
    return { driver: 'better-sqlite3', db };
  } catch (err) {
    log(`better-sqlite3 kunne ikke \u00e5pne DB: ${err.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { openSqlJsDatabase } = require('./db-sqljs-adapter');
    const db = await openSqlJsDatabase(DB_PATH);
    db.pragma('foreign_keys = ON');
    log('sql.js tilkoblet (pure JS fallback)');
    runMigrations(db);
    return { driver: 'sql.js', db };
  } catch (err) {
    log(`sql.js heller ikke tilgjengelig: ${err.message}`);
    return null;
  }
}

// ============================================================
// Public init
// ============================================================

async function initDB() {
  ensureDataDir();

  // 1. Pr\u00f8v better-sqlite3 (foretrukket p\u00e5 RPI5)
  const better = tryBetterSqlite3();
  if (better) return better;

  // 2. Fallback: sql.js (pure JS) — ADVARSEL: ikke anbefalt for produksjon
  const sqljs = await trySqlJs();
  if (sqljs) {
    if (process.env.NODE_ENV === 'production') {
      log(
        '⚠ sql.js in production: transactions are not thread-safe and data can be lost on crash. Install better-sqlite3.'
      );
    }
    return sqljs;
  }

  // 3. Ingen SQLite tilgjengelig
  throw new Error(
    'Ingen SQLite-driver tilgjengelig. Installer med:\n' +
      '  npm install better-sqlite3       (foretrukket, krever build-tools)\n' +
      '  npm install sql.js               (pure JS fallback)'
  );
}

function closeDB(handle) {
  try {
    if (handle?.db?.close) {
      handle.db.close();
      log(`${handle.driver} lukket`);
    }
  } catch (err) {
    log(`Feil ved lukking: ${err.message}`);
  }
}

module.exports = {
  initDB,
  closeDB,
  DB_PATH,
  DATA_DIR,
  BACKUP_DIR,
};
