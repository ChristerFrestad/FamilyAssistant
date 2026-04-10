// Seed service: initialiserer SQLite-databasen med data fra server/seed.js
// f\u00f8rste gang den startes. Idempotent \u2014 hopper over hvis data finnes.

const seed = require('../seed');

function seedIfEmpty(repos) {
  const { products, recipes, chores, consumables } = repos;
  // Hver seksjon bruker sin egen transaksjon (via repo.upsertMany / insert).
  // Vi wrapper ikke alt i \u00e9n ytre transaksjon fordi SQLite ikke st\u00f8tter nested tx.

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
    console.log(`[SEED] Sa\u00e5dd ${Object.keys(seed.products).length} produkter`);
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
    console.log(`[SEED] Sa\u00e5dd ${seed.recipes.length} oppskrifter`);
  }

  // === CHORES ===
  if (chores.getAll().length === 0) {
    chores.upsertMany(seed.chores);
    console.log(`[SEED] Sa\u00e5dd ${seed.chores.length} husarbeid-oppgaver`);
  }

  // === CONSUMABLES ===
  if (consumables.getAll().length === 0) {
    consumables.upsertMany(seed.consumables);
    console.log(`[SEED] Sa\u00e5dd ${seed.consumables.length} consumables`);
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
