-- A planned dinner may point at the shared library without copying it
-- into the family's own recipes. Existing rows stay family recipes
-- (library_recipe_id NULL). Nothing is rewritten or deleted.

ALTER TABLE meal_plans ADD COLUMN library_recipe_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_meal_plans_library_recipe
  ON meal_plans(library_recipe_id)
  WHERE library_recipe_id IS NOT NULL;
