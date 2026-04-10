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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
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

  // 2. Fallback: sql.js (pure JS)
  const sqljs = await trySqlJs();
  if (sqljs) return sqljs;

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
};
