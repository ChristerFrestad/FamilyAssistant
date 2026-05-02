// @ts-check
// Seed service: initialises the SQLite database with data from
// server/seed.js the first time the server starts. Idempotent — skips
// when data already exists.

const seed = require('../seed');

function seedIfEmpty(repos) {
  const { products, recipes, chores, consumables } = repos;
  // Each section uses its own transaction (via repo.upsertMany / insert).
  // We don't wrap everything in one outer transaction because SQLite
  // does not support nested tx.

  // === PRODUCTS ===
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

  // === RECIPES ===
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

  // === CHORES ===
  if (chores.getAll().length === 0) {
    chores.upsertMany(seed.chores);
    console.log(`[SEED] Seeded ${seed.chores.length} chores`);
  }

  // === CONSUMABLES ===
  if (consumables.getAll().length === 0) {
    consumables.upsertMany(seed.consumables);
    console.log(`[SEED] Seeded ${seed.consumables.length} consumables`);
  }
}

function ensureCurrentWeek(repos) {
  const weekYear = seed.getWeekYear();
  if (!repos.mealPlans.exists(weekYear)) {
    repos.mealPlans.seedDefault(weekYear, seed.defaultMealPlan);
  }
  if (!repos.choreSchedules.exists(weekYear)) {
    repos.choreSchedules.seedDefault(weekYear);
  }
  return weekYear;
}

module.exports = { seedIfEmpty, ensureCurrentWeek };
