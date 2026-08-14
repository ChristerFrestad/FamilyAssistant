-- Migration 032: recipes.active for soft-hide (manual create/update/deactivate)
--
-- Recipes stay referenced by meal_plans after hide. GET /api/recipes
-- lists active=1 only; getById still returns inactive so planned meals
-- keep their name. Do not DELETE recipes — deactivate instead.
--
-- Existing rows get active=1 via the column default.

ALTER TABLE recipes ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_recipes_family_active ON recipes(family_id, active);
