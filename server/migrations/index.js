// Migration system for FamilyAssistant.
// Reads server/migrations/NNN_*.sql in sorted order and runs the ones not
// yet registered in schema_migrations.
//
// Design:
// - One .sql file per migration, three-digit prefix (001_, 002_, 010_).
// - Each migration runs in its own transaction. On failure: rollback.
// - Idempotent: re-running on startup skips already-applied migrations.
// - FTS5 is optional. If the module is missing, FTS5 migrations are skipped.
//
// FK-aware execution (per https://sqlite.org/lang_altertable.html#otheralter):
//   For each migration we run:
//     PRAGMA foreign_keys = OFF;     -- outside transaction
//     BEGIN TRANSACTION;
//       <migration SQL>
//       PRAGMA foreign_key_check;    -- throws on violation, triggers rollback
//       INSERT schema_migrations;
//     COMMIT;
//     PRAGMA foreign_keys = ON;      -- outside transaction
//
// Why: SQLite blocks DROP TABLE on a parent that has incoming FK references,
// even when the rebuild dance immediately recreates the table with the same
// IDs (RENAME __new -> orig). The canonical fix is to drop FK enforcement
// during the migration window, then verify with foreign_key_check before
// commit. This catches genuine data violations (orphan rows) while allowing
// table rebuilds to proceed.

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

function runForeignKeyCheck(db, version) {
  let violations;
  try {
    violations = db.prepare('PRAGMA foreign_key_check').all();
  } catch (err) {
    // sql.js fallback: pragma may not be queryable as a prepared statement.
    // Best-effort skip — better-sqlite3 (the production driver on RPi) does
    // support it and is where this matters.
    log(`(foreign_key_check unavailable on this driver: ${err.message})`);
    return;
  }
  if (violations && violations.length > 0) {
    const summary = violations
      .slice(0, 10)
      .map((v) => `${v.table}.rowid=${v.rowid} -> ${v.parent} (fkid=${v.fkid})`)
      .join('; ');
    throw new Error(
      `Migration ${version} produced ${violations.length} foreign-key ` +
        `violation(s): ${summary}${violations.length > 10 ? ' ...' : ''}`
    );
  }
}

/**
 * Run pending migrations against a better-sqlite3-compatible database handle.
 * @param {object} db — better-sqlite3 Database (or sql.js adapter)
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

    if (!fts5Available && /fts5/i.test(file)) {
      log(`⚠ Skipping ${file} — FTS5 module is not compiled into your SQLite`);
      result.skipped.push(version);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

    // PRAGMA foreign_keys cannot be toggled inside a transaction — SQLite
    // silently ignores the change. Toggle it around the transaction block.
    db.pragma('foreign_keys = OFF');
    try {
      const run = db.transaction(() => {
        db.exec(sql);
        runForeignKeyCheck(db, version);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      });
      try {
        run();
        log(`✓ Applied ${file}`);
        result.applied.push(version);
      } catch (err) {
        log(`✗ Failed in ${file}: ${err.message}`);
        throw err;
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  if (result.applied.length === 0) {
    log(`No pending migrations (${result.skipped.length} already applied)`);
  }
  return result;
}

module.exports = { runMigrations };
