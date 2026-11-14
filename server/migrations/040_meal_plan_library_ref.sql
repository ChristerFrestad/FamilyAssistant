-- A planned dinner may point at the shared library without copying it
-- into the family's own recipes. Existing rows stay family recipes
-- (library_recipe_id NULL). Nothing is rewritten or deleted.

ALTER TABLE meal_plans ADD COLUMN library_recipe_id INTEGER;
