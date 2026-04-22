-- B5 — Gamification foundation: per-completion history for chores.
--
-- Context: chore_schedules tracks the CURRENT status for (family, week,
-- chore) with status and completed_at. That's a single mutable state.
-- For gamification (XP per user per week, streak across weeks,
-- leaderboard all-time, week-goal progress) we need an append-only
-- HISTORY of every completion event — which chore, which user, when.
--
-- Uke 2 scope: table + indexes. No XP calculation yet; xp_awarded is
-- placeholder (DEFAULT 0). When XP rules are designed in a later PR
-- they will UPDATE rows or INSERT with computed values.
--
-- Per-member attribution (profile_member_id) is deliberately OUT OF
-- SCOPE here and belongs to B7 (per-member diets/profiles). It can be
-- added as a nullable FK in a later migration without affecting this
-- one.
--
-- History starts from deploy-time. Historic completions before this
-- migration are NOT backfilled; gamification stats are "from now on".

CREATE TABLE IF NOT EXISTS chore_completions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week_year    TEXT    NOT NULL,  -- YYYY-WNN, matches chore_schedules.week_year
  chore_id     INTEGER NOT NULL,  -- no strict FK: chores can be inactivated
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                       -- NULL for synthetic LOCAL_USER (pilot single-tenant);
                       -- real id for authenticated users. SET NULL on delete
                       -- preserves gamification history after user removal.
  completed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  xp_awarded   INTEGER NOT NULL DEFAULT 0  -- reserved for future XP rules
);

-- Family + week — used by weekly aggregation and leaderboard-per-week.
CREATE INDEX IF NOT EXISTS idx_chore_completions_family_week
  ON chore_completions(family_id, week_year);

-- User + week — used by per-user XP and streak calculation.
CREATE INDEX IF NOT EXISTS idx_chore_completions_user_week
  ON chore_completions(user_id, week_year);
