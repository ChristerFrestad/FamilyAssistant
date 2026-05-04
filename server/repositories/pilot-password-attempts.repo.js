'use strict';

// Repository for pilot_password_attempts (audit log).
//
// Schema: server/migrations/025_pilot_password_attempts.sql
// Used by server/services/pilot-password.service.js to record every gate
// attempt (success or failure). The table is small (5 attempts/IP/10min
// max, plus normal traffic) and pruning is left to a future cron — for
// pilot scope (5 days, single user) it cannot grow large enough to
// matter.

function createPilotPasswordAttemptsRepo(db) {
  const insertStmt = db.prepare(
    `INSERT INTO pilot_password_attempts (ip_address, user_agent, success)
     VALUES (?, ?, ?)`
  );
  const countByIpSinceStmt = db.prepare(
    `SELECT COUNT(*) AS cnt FROM pilot_password_attempts
     WHERE ip_address = ? AND attempted_at >= ?`
  );
  const recentStmt = db.prepare(
    `SELECT id, ip_address, attempted_at, success, user_agent
     FROM pilot_password_attempts
     ORDER BY attempted_at DESC LIMIT ?`
  );

  function insert({ ip_address, user_agent, success }) {
    const result = insertStmt.run(ip_address, user_agent, success ? 1 : 0);
    return { id: result.lastInsertRowid };
  }

  function countByIpSince(ip, sinceIsoTimestamp) {
    const row = countByIpSinceStmt.get(ip, sinceIsoTimestamp);
    return row?.cnt || 0;
  }

  function recent(limit = 50) {
    return recentStmt.all(limit);
  }

  return { insert, countByIpSince, recent };
}

module.exports = { createPilotPasswordAttemptsRepo };
