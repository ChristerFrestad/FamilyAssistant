// Repository for users and sessions.
//
// The db handle is provided by createRepositories() in server/repositories.js.
// All methods operate on the `users` and `sessions` tables created by
// migration 014. Soft-deleted users (deleted_at IS NOT NULL) are hidden by
// every read helper here — callers never need to filter manually.

// Format a timestamp in SQLite's native datetime form ("YYYY-MM-DD HH:MM:SS")
// so string comparison against datetime('now') behaves correctly. ISO-8601
// with the 'T' separator sorts *after* that format even when the moment is
// earlier, which would break expiry comparisons.
function toSqliteDatetime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function createAuthRepo(db) {
  // ============================================================
  // Users
  // ============================================================

  const findUserByEmailStmt = db.prepare(
    'SELECT * FROM users WHERE email = ? COLLATE NOCASE AND deleted_at IS NULL'
  );
  const findUserByGoogleSubStmt = db.prepare(
    'SELECT * FROM users WHERE google_sub = ? AND deleted_at IS NULL'
  );
  const findUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL');
  const insertUserStmt = db.prepare(
    `INSERT INTO users (email, google_sub, name, avatar_url, family_id, role)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const updateLastSeenStmt = db.prepare(
    "UPDATE users SET last_seen_at = datetime('now') WHERE id = ?"
  );
  const updateProfileStmt = db.prepare(
    'UPDATE users SET name = ?, avatar_url = ?, google_sub = COALESCE(?, google_sub) WHERE id = ?'
  );
  const setFamilyStmt = db.prepare(
    'UPDATE users SET family_id = ?, role = ?, profile_member_id = ? WHERE id = ?'
  );
  const setRoleStmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
  const softDeleteStmt = db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?");

  function findByEmail(email) {
    if (!email) return null;
    return findUserByEmailStmt.get(email) || null;
  }

  function findByGoogleSub(sub) {
    if (!sub) return null;
    return findUserByGoogleSubStmt.get(sub) || null;
  }

  function findById(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return findUserByIdStmt.get(id) || null;
  }

  function createUser({ email, googleSub = null, name = null, avatarUrl = null }) {
    if (!email) throw new Error('createUser: email is required');
    const info = insertUserStmt.run(email, googleSub, name, avatarUrl, null, 'adult');
    return findById(Number(info.lastInsertRowid));
  }

  function touchLastSeen(userId) {
    updateLastSeenStmt.run(userId);
  }

  function updateProfile(userId, { name, avatarUrl, googleSub }) {
    updateProfileStmt.run(name ?? null, avatarUrl ?? null, googleSub ?? null, userId);
    return findById(userId);
  }

  function setFamily(userId, familyId, role, profileMemberId = null) {
    setFamilyStmt.run(familyId, role, profileMemberId, userId);
    return findById(userId);
  }

  function setRole(userId, role) {
    setRoleStmt.run(role, userId);
    return findById(userId);
  }

  function softDelete(userId) {
    softDeleteStmt.run(userId);
  }

  function listByFamily(familyId) {
    return db
      .prepare(
        `SELECT id, email, name, avatar_url, role, profile_member_id, last_seen_at, created_at
         FROM users WHERE family_id = ? AND deleted_at IS NULL ORDER BY id`
      )
      .all(familyId);
  }

  // ============================================================
  // Sessions
  // ============================================================

  const insertSessionStmt = db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?)`
  );
  const findSessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const touchSessionStmt = db.prepare(
    "UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?"
  );
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteUserSessionsStmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const deleteOtherUserSessionsStmt = db.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND id != ?'
  );
  const listUserSessionsStmt = db.prepare(
    `SELECT id, user_agent, expires_at, created_at, last_seen_at
     FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`
  );
  const deleteExpiredStmt = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')");

  function createSession({ id, userId, ttlDays = 30, userAgent = null, ipHash = null }) {
    if (!id) throw new Error('createSession: id is required');
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('createSession: userId must be a positive integer');
    }
    const expiresAt = toSqliteDatetime(Date.now() + ttlDays * 86400000);
    insertSessionStmt.run(id, userId, expiresAt, userAgent, ipHash);
    return findSessionStmt.get(id);
  }

  function getValidSession(id) {
    if (!id) return null;
    const row = findSessionStmt.get(id);
    if (!row) return null;
    // SQLite stores datetimes as "YYYY-MM-DD HH:MM:SS" (UTC). JS Date accepts
    // that format and treats it as UTC, so comparison with Date.now() works.
    const expiresMs = Date.parse(row.expires_at.replace(' ', 'T') + 'Z');
    if (expiresMs < Date.now()) {
      // Expired — clean up lazily.
      deleteSessionStmt.run(id);
      return null;
    }
    return row;
  }

  function touchSession(id) {
    touchSessionStmt.run(id);
  }

  function deleteSession(id) {
    deleteSessionStmt.run(id);
  }

  function deleteAllForUser(userId) {
    deleteUserSessionsStmt.run(userId);
  }

  function deleteOthersForUser(userId, keepId) {
    deleteOtherUserSessionsStmt.run(userId, keepId);
  }

  function listForUser(userId) {
    return listUserSessionsStmt.all(userId);
  }

  function cleanupExpired() {
    const info = deleteExpiredStmt.run();
    return info.changes;
  }

  // ============================================================
  // Magic link tokens
  // ============================================================

  const insertMagicLinkStmt = db.prepare(
    `INSERT INTO magic_link_tokens (token, email, expires_at) VALUES (?, ?, ?)`
  );
  const findMagicLinkStmt = db.prepare('SELECT * FROM magic_link_tokens WHERE token = ?');
  const markMagicLinkUsedStmt = db.prepare(
    "UPDATE magic_link_tokens SET used_at = datetime('now') WHERE token = ?"
  );
  const deleteExpiredMagicLinksStmt = db.prepare(
    "DELETE FROM magic_link_tokens WHERE expires_at < datetime('now')"
  );

  function createMagicLink({ token, email, ttlMinutes = 15 }) {
    const expiresAt = toSqliteDatetime(Date.now() + ttlMinutes * 60000);
    insertMagicLinkStmt.run(token, email, expiresAt);
    return findMagicLinkStmt.get(token);
  }

  function findMagicLink(token) {
    if (!token) return null;
    return findMagicLinkStmt.get(token) || null;
  }

  function markMagicLinkUsed(token) {
    markMagicLinkUsedStmt.run(token);
  }

  function cleanupExpiredMagicLinks() {
    const info = deleteExpiredMagicLinksStmt.run();
    return info.changes;
  }

  return {
    // users
    findByEmail,
    findByGoogleSub,
    findById,
    createUser,
    touchLastSeen,
    updateProfile,
    setFamily,
    setRole,
    softDelete,
    listByFamily,
    // sessions
    createSession,
    getValidSession,
    touchSession,
    deleteSession,
    deleteAllForUser,
    deleteOthersForUser,
    listForUser,
    cleanupExpired,
    // magic links
    createMagicLink,
    findMagicLink,
    markMagicLinkUsed,
    cleanupExpiredMagicLinks,
  };
}

module.exports = { createAuthRepo };
