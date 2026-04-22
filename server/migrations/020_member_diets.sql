-- B7 — Per-member diet: allergies/dislikes/diet_tags/custom_diet_note
--
-- Extends family_profile_members with per-member dietary data. Works
-- alongside family_profile.allergies (family-level) via fallback arv:
-- a member with NULL allergies inherits from the family-level value.
-- A member with '[]' explicitly declares "no allergies" and does NOT
-- fall back.
--
-- Columns:
--   allergies        JSON array of strings, NULL = inherit from family_profile.
--   dislikes         JSON array of strings, NULL = inherit from family_profile.
--   diet_tags        JSON array of enum strings. NO fallback — personal
--                    lifestyle (one vegetarian doesn't make the family
--                    vegetarian). Default '[]' means no diet filters.
--   custom_diet_note Optional free-text ("avoids pork", "pescatarian except salmon").
--                    Exposed to LLM prompts, not to deterministic filters.
--
-- D3-enum for diet_tags (validated at repo layer, not at DB level, so
-- that adding a new tag later does not require a migration):
--   vegetarian | vegan | pescetarian | halal | kosher
--   laktosefri | glutenfri | eggfri | nøttefri
--   lavkarbo | lchf | keto | lav-fodmap
--
-- `diabetiker-vennlig` was considered and deliberately EXCLUDED:
-- diabetes is not one category — it is a spectrum requiring nutrient
-- info per recipe and per-user thresholds to be medically useful. A
-- single enum-tag would offer false reassurance. Deferred to phase 2
-- (uke 6-10 earliest). See `docs/workflow/pending-decisions.md`.
--
-- Portainer-risk: LOW. ADD COLUMN is idempotent; existing rows backfill
-- to the declared default. Rollback safe (DROP COLUMN if rolled back).
-- No rebuild, no foreign-key changes, no referential impact.

ALTER TABLE family_profile_members ADD COLUMN allergies TEXT DEFAULT NULL;
ALTER TABLE family_profile_members ADD COLUMN dislikes TEXT DEFAULT NULL;
ALTER TABLE family_profile_members ADD COLUMN diet_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE family_profile_members ADD COLUMN custom_diet_note TEXT DEFAULT NULL;
