// Meal planning service: swap-forslag, holdbarhetsjekker, s\u00f8ndagspush-generering

const { altSuggestionMap, getWeekYear } = require('../seed');

function getSwapSuggestions(repos, dayOfWeek, weekYear) {
  const plan = repos.mealPlans.getWeek(weekYear);
  const currentRecipeIds = plan.map((p) => p.recipeId);
  const inventoryMap = repos.inventory.getAll();
  const allRecipes = repos.recipes.getAll();

  const altIds = altSuggestionMap[dayOfWeek] || [];
  const suggestions = [];

  for (const rid of altIds) {
    if (currentRecipeIds.includes(rid)) continue;
    const recipe = allRecipes.find((r) => r.id === rid);
    if (!recipe) continue;

    let homeCount = 0;
    for (const ing of recipe.ingredients || []) {
      const key = ing.productKey || (ing.name || '').toLowerCase();
      if (inventoryMap[key] && inventoryMap[key].qtyRemaining >= ing.qty) homeCount++;
    }

    suggestions.push({
      recipeId: recipe.id,
      name: recipe.name,
      prepTime: recipe.prepTime,
      category: recipe.category,
      ingredientsAtHome: homeCount,
      totalIngredients: recipe.ingredients.length,
      reason:
        homeCount > 0
          ? `${homeCount}/${recipe.ingredients.length} ingredienser hjemme`
          : 'Ny smak!',
      ingredients: recipe.ingredients,
    });

    if (suggestions.length >= 5) break;
  }

  return suggestions;
}

function checkShelfLife(repos, plan, fromDay, toDay) {
  const fromSlot = plan.find((p) => p.dayOfWeek === fromDay);
  if (!fromSlot) return { ok: true, warnings: [] };

  const recipe = repos.recipes.getById(fromSlot.recipeId);
  if (!recipe) return { ok: true, warnings: [] };

  const productsMap = repos.products.getAllAsMap();
  const warnings = [];
  const purchaseDay = 0;
  const maxDay = toDay;

  for (const ing of recipe.ingredients || []) {
    const product = productsMap[ing.productKey];
    if (!product || !product.shelfDays) continue;
    if (product.shelfDays <= maxDay - purchaseDay + 1 && product.shelfDays < 14) {
      const DAYS = [
        'mandag',
        'tirsdag',
        'onsdag',
        'torsdag',
        'fredag',
        'l\u00f8rdag',
        's\u00f8ndag',
      ];
      const latestDay = Math.min(purchaseDay + product.shelfDays - 1, 6);
      warnings.push({
        ingredient: product.productName,
        shelfDays: product.shelfDays,
        latestDay: DAYS[latestDay],
        message: `${product.productName} holder maks ${product.shelfDays} dager \u2014 senest ${DAYS[latestDay]}`,
      });
    }
  }
  return { ok: warnings.length === 0, warnings };
}

function generateSundayDraft(repos) {
  const nextWeekDate = new Date(Date.now() + 7 * 86400000);
  const nextWk = getWeekYear(nextWeekDate);
  const currentWk = getWeekYear();

  const currentPlan = repos.mealPlans.getWeek(currentWk);
  const recentIds = currentPlan.map((s) => s.recipeId);
  const history = repos.mealHistory.getRecent(28).map((h) => h.recipeId);
  const allRecent = [...new Set([...recentIds, ...history])];

  const all = repos.recipes.getAll();
  const rask = all.filter((r) => r.category === 'rask' && !allRecent.includes(r.id));
  const comfort = all.filter((r) => r.category === 'comfort' && !allRecent.includes(r.id));
  const helg = all.filter((r) => r.category === 'helg' && !allRecent.includes(r.id));

  const allRask = all.filter((r) => r.category === 'rask');
  const allComfort = all.filter((r) => r.category === 'comfort');
  const allHelg = all.filter((r) => r.category === 'helg');

  const usedIds = new Set();
  function pick(arr, fallback) {
    // Filtrer bort allerede valgte for å unngå duplikater uten array-mutasjon
    let src = arr.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = fallback.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) src = all.filter((r) => !usedIds.has(r.id));
    if (src.length === 0) return null;
    const chosen = src[Math.floor(Math.random() * src.length)];
    usedIds.add(chosen.id);
    return chosen;
  }

  const suggested = [
    { dayOfWeek: 0, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 1, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 2, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 3, recipeId: pick(rask, allRask)?.id, status: 'planned' },
    { dayOfWeek: 4, recipeId: pick(comfort, allComfort)?.id, status: 'planned' },
    { dayOfWeek: 5, recipeId: pick(helg, allHelg)?.id, status: 'planned' },
    { dayOfWeek: 6, recipeId: pick(helg, allHelg)?.id, status: 'planned' },
  ].filter((s) => s.recipeId);

  return { weekYear: nextWk, meals: suggested };
}

module.exports = { getSwapSuggestions, checkShelfLife, generateSundayDraft };
