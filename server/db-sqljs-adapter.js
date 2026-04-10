// sql.js-adapter som eksponerer samme API som better-sqlite3 bruker i
// repositories.js: db.prepare(sql).{run, get, all}, db.exec(sql), db.transaction(fn), db.pragma()
//
// Form\u00e5l: gj\u00f8re det mulig \u00e5 teste/kj\u00f8re Familieassistenten p\u00e5 maskiner uten
// native build-tools (f.eks. Windows uten VS Build Tools). P\u00e5 RPi5 brukes
// vanligvis better-sqlite3 for bedre ytelse.

const fs = require('fs');

/**
 * Lag en better-sqlite3-kompatibel facade over en sql.js Database-instans.
 * @param {object} rawDb \u2014 sql.js Database
 * @param {string} filePath \u2014 hvor vi skal persistere .db
 */
function createAdapter(rawDb, filePath) {
  let pendingWrite = false;
  let closed = false;
  let txDepth = 0;
  function persist() {
    if (closed) return;
    try {
      const data = rawDb.export();
      fs.writeFileSync(filePath, Buffer.from(data));
    } catch (err) {
      if (!closed) console.error('[sql.js] persist feilet:', err.message);
    }
  }
  function schedulePersist() {
    if (pendingWrite || closed) return;
    pendingWrite = true;
    // Debounced persist \u2014 batcher skrivinger innen samme tick
    setImmediate(() => {
      pendingWrite = false;
      persist();
    });
  }

  function exec(sql) {
    rawDb.exec(sql);
    schedulePersist();
  }

  function prepare(sql) {
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)/i.test(sql);
    const isSelect = /^\s*SELECT/i.test(sql);

    return {
      run(...params) {
        // Flat params hvis eneste argument er en array
        const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const stmt = rawDb.prepare(sql);
        try {
          stmt.bind(p);
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = rawDb.getRowsModified();
        const lastRowRes = rawDb.exec('SELECT last_insert_rowid() as id');
        const lastInsertRowid = lastRowRes[0]?.values?.[0]?.[0] || 0;
        if (isWrite) schedulePersist();
        return { changes, lastInsertRowid };
      },
      get(...params) {
        const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const stmt = rawDb.prepare(sql);
        try {
          stmt.bind(p);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...params) {
        const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const stmt = rawDb.prepare(sql);
        const rows = [];
        try {
          stmt.bind(p);
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return rows;
      },
    };
  }

  function transaction(fn) {
    // sql.js st\u00f8tter transactions via exec('BEGIN') / exec('COMMIT').
    // For nestede transaksjoner bruker vi SAVEPOINT slik better-sqlite3 gj\u00f8r,
    // ellers ville en ytre BEGIN + en indre BEGIN kastet "cannot start a
    // transaction within a transaction".
    return (...args) => {
      const isOuter = txDepth === 0;
      const spName = isOuter ? null : `sp_${txDepth}`;
      if (isOuter) rawDb.exec('BEGIN');
      else rawDb.exec(`SAVEPOINT ${spName}`);
      txDepth++;
      try {
        const result = fn(...args);
        if (isOuter) {
          rawDb.exec('COMMIT');
          schedulePersist();
        } else {
          rawDb.exec(`RELEASE ${spName}`);
        }
        txDepth--;
        return result;
      } catch (err) {
        if (isOuter) rawDb.exec('ROLLBACK');
        else rawDb.exec(`ROLLBACK TO ${spName}; RELEASE ${spName}`);
        txDepth--;
        throw err;
      }
    };
  }

  function pragma(stmt) {
    // sql.js st\u00f8tter ikke alle pragmas (spesielt ikke WAL), men ignorerer trygt de fleste
    try {
      rawDb.exec(`PRAGMA ${stmt}`);
    } catch { /* ignore \u2014 sql.js mangler visse pragmas */ }
  }

  function close() {
    persist();
    closed = true;
    rawDb.close();
  }

  return {
    prepare,
    exec,
    transaction,
    pragma,
    close,
    _persist: persist,
    _isSqlJs: true,
  };
}

/**
 * \u00c5pne en SQLite-database via sql.js og returner en better-sqlite3-kompatibel
 * facade. Async fordi sql.js-initialisering er WASM-basert.
 */
async function openSqlJsDatabase(filePath) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }
  return createAdapter(rawDb, filePath);
}

module.exports = { openSqlJsDatabase, createAdapter };
