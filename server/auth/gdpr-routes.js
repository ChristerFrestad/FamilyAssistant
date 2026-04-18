// GDPR endpoints (Art. 15 Dataportability, Art. 17 Right to Erasure).
//
//   GET    /api/me/export    authenticated — returns a JSON blob with
//                             everything the caller's family has stored.
//                             Streaming is not required at MVP scale.
//
//   DELETE /api/me            authenticated — soft-deletes the caller's
//                             user row (users.deleted_at), clears all
//                             their sessions, and returns { ok: true,
//                             hardDeleteAt }. Owners must transfer or
//                             delete the family first.
//
//   DELETE /api/family already exists (phase 7) and handles the family
//   side of the erasure story (CASCADE from migration 014 removes all
//   per-family rows). It is owner-only and requires the family name as a
//   confirmation string.
//
// The hard-delete of soft-deleted users is done by a daily cron job in
// server/cron.js (purgeSoftDeletedUsers) with a 30-day grace window.

const { errors } = require('../http/errors');
const { runWithFamily } = require('./family-context');

const SOFT_DELETE_GRACE_DAYS = 30;

function handleExportMe(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  const user = {
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    role: ctx.user.role,
    avatarUrl: ctx.user.avatar_url || null,
    profileMemberId: ctx.user.profile_member_id || null,
    familyId: ctx.user.family_id || null,
    createdAt: ctx.user.created_at,
    lastSeenAt: ctx.user.last_seen_at,
  };

  const payload = {
    exportVersion: 1,
    generatedAt: new Date().toISOString(),
    user,
    sessions: safeListSessions(repos, ctx.user.id),
  };

  if (ctx.user.family_id) {
    const familyId = ctx.user.family_id;
    runWithFamily(familyId, () => {
      payload.family = buildFamilyExport(repos, familyId);
    });
  }

  return payload;
}

function safeListSessions(repos, userId) {
  try {
    return repos.auth.listForUser(userId).map((s) => ({
      id: maskSessionId(s.id),
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
    }));
  } catch {
    return [];
  }
}

function maskSessionId(id) {
  if (typeof id !== 'string' || id.length < 12) return '***';
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function buildFamilyExport(repos, familyId) {
  const family = safe(() => repos.family.findFamilyById(familyId));
  const profileMembers = safe(() => repos.family.listMembers(familyId), []);
  const users = safe(() => repos.auth.listByFamily(familyId), []).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    profileMemberId: u.profile_member_id,
    lastSeenAt: u.last_seen_at,
  }));
  const familyProfile = safe(() => repos.familyProfile.get(), null);
  const inventory = safe(() => repos.inventory.getAll(), {});
  const inventoryLog = safe(() => repos.inventoryLog.getRecent(1000), []);
  const recipes = safe(() => repos.recipes.getAll(), []);
  const chores = safe(() => repos.chores.getAll(), []);
  const consumables = safe(() => repos.consumables.getAll(), []);
  const calendarEvents = safe(() => repos.calendar.getEvents('2000-01-01', '2100-12-31'), []);
  const notifications = safe(() => repos.notifications.getUnread(), []);
  const receipts = safe(() => repos.receipts.list({ limit: 500 }), []);

  const plans = [];
  const shoppingByWeek = [];
  const weeks = safe(
    () =>
      repos._db
        .prepare(
          `SELECT DISTINCT week_year FROM meal_plans WHERE family_id = ? ORDER BY week_year DESC`
        )
        .all(familyId),
    []
  );
  for (const row of weeks) {
    const wk = row.week_year;
    plans.push({
      weekYear: wk,
      plan: safe(() => repos.mealPlans.getWeek(wk), []),
      choreSchedules: safe(() => repos.choreSchedules.getWeek(wk), []),
    });
    const active = safe(() => repos.shoppingLists.getActive(wk), null);
    if (active) shoppingByWeek.push({ weekYear: wk, list: active });
  }

  return {
    family,
    familyProfile,
    profileMembers,
    users,
    inventory,
    inventoryLog,
    recipes,
    chores,
    consumables,
    calendarEvents,
    notifications,
    receipts,
    mealPlans: plans,
    shoppingLists: shoppingByWeek,
  };
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function handleDeleteMe(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Login required.');
  }
  // Owners must transfer ownership or delete the family before deleting
  // their own account — otherwise the family is left without an owner.
  if (ctx.user.role === 'owner' && ctx.user.family_id) {
    throw errors.forbidden('Transfer ownership or delete the family before deleting your account.');
  }
  repos.auth.softDelete(ctx.user.id);
  repos.auth.deleteAllForUser(ctx.user.id);
  const hardDeleteAt = new Date(Date.now() + SOFT_DELETE_GRACE_DAYS * 86400000).toISOString();
  return { ok: true, hardDeleteAt, graceDays: SOFT_DELETE_GRACE_DAYS };
}

function registerGdprRoutes(router, { repos }) {
  router.get('/api/me/export', (ctx) => handleExportMe(ctx, repos));
  router.delete('/api/me', (ctx) => handleDeleteMe(ctx, repos));
}

// ============================================================
// Cron helper — runs daily from server/cron.js
// ============================================================

function purgeSoftDeletedUsers(repos, { graceDays = SOFT_DELETE_GRACE_DAYS } = {}) {
  if (!repos?._db) return { purged: 0 };
  const rows = repos._db
    .prepare(
      `SELECT id FROM users WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?)`
    )
    .all(`-${graceDays} days`);
  if (rows.length === 0) return { purged: 0 };
  const del = repos._db.prepare('DELETE FROM users WHERE id = ?');
  const tx = repos._db.transaction(() => {
    for (const r of rows) del.run(r.id);
  });
  tx();
  return { purged: rows.length, ids: rows.map((r) => r.id) };
}

module.exports = {
  registerGdprRoutes,
  purgeSoftDeletedUsers,
  SOFT_DELETE_GRACE_DAYS,
};
