-- Migration 015: in-app feedback + recipe feedback + AI chat history
--
-- Three family-scoped tables introduced in the multi-tenancy work:
--
-- 1. feedback
--      Free-text feedback submitted via the in-app "Gi tilbakemelding"
--      button in the header. Owners of the product (not the family)
--      read these in the super-admin workflow. Scoped to family/user so
--      we can see who sent what and reach back if needed.
--
-- 2. recipe_feedback
--      Per-recipe thumb up / neutral / down signal. Feeds into the
--      AI meal-suggestion prompt as family-specific preference context:
--      "this family liked chicken stew, disliked fish on Thursday".
--      Optional meal_plan_id ties the rating to a specific scheduled meal.
--
-- 3. ai_chat_history
--      Per-user conversation log with the family-scoped LLM assistant.
--      Messages are private to the individual user, but the surrounding
--      AI prompt always uses family pantry/menu/profile as context. A
--      session_id groups messages that belong to one ongoing conversation.
--
-- All three tables CASCADE on family deletion: GDPR-compliant hard delete
-- when a family is purged. user_id uses ON DELETE SET NULL so records
-- survive a single user removal (useful audit trail), while family purge
-- still removes everything.

-- ============================================================
-- SECTION 1: In-app feedback
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category     TEXT NOT NULL DEFAULT 'other'
                 CHECK (category IN ('bug','suggestion','question','praise','other')),
  message      TEXT NOT NULL,
  rating       INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  page_url     TEXT,
  user_agent   TEXT,
  contact_ok   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','reviewed','responded','archived')),
  response     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_family ON feedback(family_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);

-- ============================================================
-- SECTION 2: Recipe feedback (thumb up / neutral / down)
-- ============================================================

CREATE TABLE IF NOT EXISTS recipe_feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  meal_plan_id INTEGER REFERENCES meal_plans(id) ON DELETE SET NULL,
  rating       INTEGER NOT NULL CHECK (rating IN (-1, 0, 1)),
  comment      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_feedback_family ON recipe_feedback(family_id);
CREATE INDEX IF NOT EXISTS idx_recipe_feedback_recipe ON recipe_feedback(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_feedback_meal_plan ON recipe_feedback(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_recipe_feedback_rating ON recipe_feedback(family_id, rating);

-- ============================================================
-- SECTION 3: AI chat history
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_chat_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content     TEXT NOT NULL,
  model       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  tool_name   TEXT,
  tool_args   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_history_family ON ai_chat_history(family_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON ai_chat_history(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_history_user ON ai_chat_history(user_id, created_at DESC);
