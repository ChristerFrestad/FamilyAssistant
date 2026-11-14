-- Marks a dinner as an automatic draft or a person's choice.
-- Existing rows stay 'manual', so a later Sunday refresh does not
-- replace dinners the family already set. New seeded weeks are 'auto'.

ALTER TABLE meal_plans ADD COLUMN plan_origin TEXT NOT NULL DEFAULT 'manual';
