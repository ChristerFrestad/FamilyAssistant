-- Unmeasured lines such as "salt og pepper" have no quantity.
-- The family copy keeps the name and stores an empty amount.

CREATE TABLE recipe_ingredients__empty_amount (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_key TEXT,
  name        TEXT NOT NULL,
  qty         REAL,
  unit        TEXT,
  optional    INTEGER DEFAULT 0,
  sort_order  INTEGER DEFAULT 0,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE
);

INSERT INTO recipe_ingredients__empty_amount (
  id, recipe_id, product_key, name, qty, unit, optional, sort_order, family_id
)
SELECT id, recipe_id, product_key, name, qty, unit, optional, sort_order, family_id
FROM recipe_ingredients;

DROP TABLE recipe_ingredients;
ALTER TABLE recipe_ingredients__empty_amount RENAME TO recipe_ingredients;

CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_product ON recipe_ingredients(product_key);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_family ON recipe_ingredients(family_id);
