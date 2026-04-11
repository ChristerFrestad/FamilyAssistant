// Migrasjonssystem for Familieassistenten
// Leser server/migrations/NNN_*.sql i sortert rekkefølge og kjører de som
// ikke allerede er registrert i schema_migrations-tabellen.
//
// Design:
// - Én .sql-fil per migrasjon, nummerert tresifret (001_, 002_, 010_)
// - Hver migrasjon kjøres som én transaksjon. Krasjer den, rulles den tilbake.
// - Idempotent: kjøres hver oppstart, hopper over allerede applikerte.
// - FTS5 er optional: hvis modulen ikke finnes, hoppes 002 over med varsel.

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = __dirname;

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[MIGRATE ${ts}] ${msg}`);
}

function ensureSchemaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
}

function appliedMigrations(db) {
  const rows = db.prepare('SELECT version FROM schema_migrations').all();
  return new Set(rows.map((r) => r.version));
}

function hasFTS5(db) {
  try {
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS __fts5_probe USING fts5(x)');
    db.exec('DROP TABLE IF EXISTS __fts5_probe');
    return true;
  } catch {
    return false;
  }
}

/**
 * Kjør alle nye migrasjoner mot en better-sqlite3 Database-instans.
 * @param {object} db — better-sqlite3 Database
 * @returns {{applied: string[], skipped: string[]}}
 */
function runMigrations(db) {
  ensureSchemaTable(db);
  const applied = appliedMigrations(db);
  const files = listMigrationFiles();
  const result = { applied: [], skipped: [] };

  const fts5Available = hasFTS5(db);

  for (const file of files) {
    const version = file.slice(0, 3);
    if (applied.has(version)) {
      result.skipped.push(version);
      continue;
    }

    // Hopp over FTS5-migrasjoner hvis modulen ikke er tilgjengelig
    if (!fts5Available && /fts5/i.test(file)) {
      log(`⚠ Hopper over ${file} — FTS5-modulen er ikke kompilert i din SQLite`);
      result.skipped.push(version);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    try {
      const run = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      });
      run();
      log(`✓ Applikert ${file}`);
      result.applied.push(version);
    } catch (err) {
      log(`✗ FEIL i ${file}: ${err.message}`);
      throw err;
    }
  }

  if (result.applied.length === 0) {
    log(`Ingen nye migrasjoner (${result.skipped.length} allerede applikert)`);
  }
  return result;
}

module.exports = { runMigrations };
