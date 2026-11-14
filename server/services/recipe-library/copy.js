'use strict';

const ALLOWED_CATEGORY = new Set(['rask', 'comfort', 'helg']);
const FEW_RECIPES = 15;

function familyRecipeByUrl(repos, url) {
  if (!url) return null;
  return (
    repos.recipes.getAll({ includeInactive: true }).find((recipe) => recipe.url === url) || null
  );
}

function copyLibraryRecipe(repos, libraryId) {
  const row = repos.recipeLibrary.getById(libraryId);
  if (!row || row.active === 0) return null;
  const existing = familyRecipeByUrl(repos, row.canonical_url);
  if (existing) return { alreadyAdded: true, recipeId: existing.id, recipe: existing };
  const category = ALLOWED_CATEGORY.has(row.category) ? row.category : 'comfort';
  const recipeId = Number(
    repos.recipes.insert({
      name: row.title,
      category,
      prepTime: row.total_time_min ? `${row.total_time_min} min` : null,
      source: row.source_name,
      url: row.canonical_url,
      servings: row.servings || 2,
      sourceType: 'imported',
      ingredients: (row.ingredients || []).map((ing) => ({
        productKey: ing.productKey || null,
        name: ing.name || ing.rawLine,
        qty: ing.qty == null ? 1 : ing.qty,
        unit: ing.unit || 'stk',
      })),
    })
  );
  return { alreadyAdded: false, recipeId, recipe: repos.recipes.getById(recipeId) };
}

module.exports = { copyLibraryRecipe, familyRecipeByUrl, FEW_RECIPES };
