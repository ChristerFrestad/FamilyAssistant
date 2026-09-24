// @ts-check
// Seed service: initialises the SQLite database with data from
// server/seed.js. Two entry points:
//
//   seedIfEmpty(repos) — one-shot, called once at server startup.
//     Runs WITHOUT family-context, so internal getFamilyId() falls
//     back to LEGACY_FAMILY_ID = 1. Effectively seeds family 1 only.
//     Kept for backward-compat with existing deploys.
//
//   seedFamilyDefaults(repos, familyId) — per-family, called from
//     POST /api/auth/onboarding/complete and the repair script for
//     existing orphan families. Uses runWithFamily() to set the
//     async-local context so all repo writes land on the new family.
//     Idempotent — internal "is the table empty for this family?"-
//     guards prevent duplicates. Returns a summary of what was
//     inserted so the caller can audit-log it.

const seed = require('../seed');
const { runWithFamily } = require('../auth/family-context');

function seedIfEmpty(repos) {
  const { products, recipes, chores, consumables } = repos;
  // Each section uses its own transaction (via repo.upsertMany / insert).
  // We don't wrap everything in one outer transaction because SQLite
  // does not support nested tx.

  // === PRODUCTS === (global, no family_id)
  if (products.count() === 0) {
    const tx = repos.transaction(() => {
      for (const [key, p] of Object.entries(seed.products)) {
        products.upsert({
          key,
          productName: p.productName,
          category: p.category,
          packSize: p.packSize,
          unit: p.unit,
          estPrice: p.estPrice,
          shelfDays: p.shelfDays,
          store: p.store,
          dairyRule: p.dairyRule,
        });
      }
    });
    tx();
    console.log(`[SEED] Seeded ${Object.keys(seed.products).length} products`);
  }

  // === RECIPES === (per-family — startup seed lands on legacy family 1)
  if (recipes.count() === 0) {
    const tx = repos.transaction(() => {
      for (const r of seed.recipes) {
        recipes.insert({
          ...r,
          prepTime: r.prepTime,
          pinterestUrl: r.pinterestUrl,
        });
      }
    });
    tx();
    console.log(`[SEED] Seeded ${seed.recipes.length} recipes`);
  }

  // === CHORES === (per-family — startup seed lands on legacy family 1)
  if (chores.getAll({ includeInactive: true }).length === 0) {
    chores.upsertMany(seed.chores);
    console.log(`[SEED] Seeded ${seed.chores.length} chores`);
  }

  // === CONSUMABLES === (per-family — startup seed lands on legacy family 1)
  // Live seed is seed.consumables (small generic staple set, autoAdd
  // off). The branded/baby/personal-care catalog is NOT inserted here.
  if (consumables.getAll().length === 0) {
    consumables.upsertMany(seed.consumables);
    console.log(`[SEED] Seeded ${seed.consumables.length} consumables`);
  }
}

/**
 * Per-family seed. Runs every part of seedIfEmpty (except `products`
 * which is global) inside runWithFamily(familyId), so all repo writes
 * land on the named family.
 *
 * Returns `{ recipesInserted, choresInserted, consumablesInserted,
 * familyProfileCreated, mealPlansSeeded }`. Each counter is the number
 * of NEW rows inserted; if the family already had data, the
 * corresponding counter is 0 (idempotent).
 *
 * Why we map seed-recipe-id to new-recipe-id:
 *   `seed.defaultMealPlan` references `recipeId: 1..7` which is the
 *   id-position in `seed.recipes`. The per-family insert auto-
 *   increments, so a fresh family gets ids 37..72 (or higher,
 *   depending on prior seeding). To preserve the default-plan
 *   structure, we capture an id-map during recipe insertion and
 *   feed it into the meal-plan seed.
 *
 * @param {object} repos
 * @param {number} familyId
 * @returns {{
 *   recipesInserted: number,
 *   choresInserted: number,
 *   consumablesInserted: number,
 *   familyProfileCreated: boolean,
 *   mealPlansSeeded: number,
 *   choreSchedulesSeeded: number,
 * }}
 */
function seedFamilyDefaults(repos, familyId) {
  if (!Number.isInteger(familyId) || familyId <= 0) {
    throw new Error('seedFamilyDefaults: familyId must be a positive integer');
  }

  const summary = {
    recipesInserted: 0,
    choresInserted: 0,
    consumablesInserted: 0,
    familyProfileCreated: false,
    mealPlansSeeded: 0,
    choreSchedulesSeeded: 0,
  };

  return runWithFamily(familyId, () => {
    const { recipes, chores, consumables, mealPlans, choreSchedules, familyProfile } = repos;

    // 1. Recipes — and capture the seed-id → new-id map for step 5.
    /** @type {Record<number, number>} */
    const recipeIdMap = {};
    if (recipes.count() === 0) {
      for (const r of seed.recipes) {
        const newId = recipes.insert({
          ...r,
          prepTime: r.prepTime,
          pinterestUrl: r.pinterestUrl,
        });
        recipeIdMap[r.id] = Number(newId);
        summary.recipesInserted++;
      }
    }

    // 2. Chores
    if (chores.getAll({ includeInactive: true }).length === 0) {
      chores.upsertMany(seed.chores);
      summary.choresInserted = seed.chores.length;
    }

    // 3. Consumables — empty-table only. Live defaults are the small
    //    generic staple set in seed.consumables (no branded household
    //    must-buys, no baby/personal-care, autoAdd off). Families that
    //    already have rows are left unchanged.
    if (consumables.getAll().length === 0) {
      consumables.upsertMany(seed.consumables);
      summary.consumablesInserted = seed.consumables.length;
    }

    // 4. family_profile parent row — empty allergies/dislikes; UI
    //    flow lets the user set these in Family-screen later.
    const existingProfile = familyProfile.get();
    const looksUnsaved =
      existingProfile.updatedAt == null && existingProfile.allergies.length === 0;
    if (looksUnsaved) {
      familyProfile.update({
        members: [],
        allergies: [],
        dislikes: [],
        preferences: {},
        preferredChain: null,
        secondaryChain: null,
      });
      summary.familyProfileCreated = true;
    }

    // 5. Default meal-plan for current ISO week, with recipe_ids
    //    remapped from seed-ids to the family's new ids. We skip
    //    slots whose seed-recipe-id has no mapping (e.g. when
    //    recipes were already present and we did not re-seed them
    //    in step 1 — in that case we leave existing meal_plans
    //    alone too).
    const weekYear = seed.getWeekYear();
    const haveMapping = Object.keys(recipeIdMap).length > 0;
    if (!mealPlans.exists(weekYear) && haveMapping) {
      const remapped = seed.defaultMealPlan
        .map((slot) => {
          const recipeId = recipeIdMap[slot.recipeId];
          if (recipeId == null) return null;
          return { ...slot, recipeId };
        })
        .filter((slot) => slot !== null);
      if (remapped.length > 0) {
        mealPlans.seedDefault(weekYear, remapped);
        summary.mealPlansSeeded = remapped.length;
      }
    }

    // 6. Chore schedules for current week.
    if (!choreSchedules.exists(weekYear)) {
      choreSchedules.seedDefault(weekYear);
      // We don't have an exact insert count from the repo, but the
      // seed always produces one row per chore with default_day !=
      // NULL. Surface the chore-count so callers have something
      // useful in the audit log.
      summary.choreSchedulesSeeded = chores.getAll().filter((c) => c.default_day != null).length;
    }

    return summary;
  });
}

/**
 * Build a seed-id → family-recipe-id map by name-lookup. Used by
 * ensureCurrentWeek so the default-week meal-plan points at recipes
 * that actually belong to the current family. Returns an empty map
 * if no seed-recipes match — the caller then skips meal-plan seeding
 * to avoid orphan rows.
 */
function buildSeedRecipeIdMapFromRepo(repos) {
  /** @type {Record<number, number>} */
  const mp = {};
  if (typeof repos.recipes.findByName !== 'function') return mp;
  for (const r of seed.recipes) {
    const found = repos.recipes.findByName(r.name);
    if (found && Number.isInteger(found.id)) {
      mp[r.id] = found.id;
    }
  }
  return mp;
}

function ensureCurrentWeek(repos) {
  const weekYear = seed.getWeekYear();
  if (!repos.mealPlans.exists(weekYear)) {
    // Only seed a default meal-plan when the family already has seed
    // recipes — otherwise the hardcoded `seed.defaultMealPlan` rows
    // would create orphan meal_plans pointing at recipes that belong
    // to another family (the multi-tenant bug repaired 2026-05-02).
    const recipeIdMap = buildSeedRecipeIdMapFromRepo(repos);
    const remapped = seed.defaultMealPlan
      .map((slot) => {
        const recipeId = recipeIdMap[slot.recipeId];
        if (recipeId == null) return null;
        return { ...slot, recipeId };
      })
      .filter((slot) => slot !== null);
    if (remapped.length > 0) {
      repos.mealPlans.seedDefault(weekYear, remapped);
    }
  }
  if (!repos.choreSchedules.exists(weekYear)) {
    repos.choreSchedules.seedDefault(weekYear);
  }
  return weekYear;
}

module.exports = { seedIfEmpty, seedFamilyDefaults, ensureCurrentWeek };
