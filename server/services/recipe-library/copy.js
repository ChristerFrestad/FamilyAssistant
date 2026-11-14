'use strict';

const { canonicalRecipeUrl } = require('./url');
const { enabledSourceNames } = require('./sources');

const ALLOWED_CATEGORY = new Set(['rask', 'comfort', 'helg']);
const FEW_RECIPES = 15;

function comparableUrl(url) {
  if (!url) return '';
  const canonical = canonicalRecipeUrl(url);
  if (canonical) return canonical;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return String(url).replace(/\/+$/, '');
  }
}

function familyRecipeByUrl(repos, url) {
  const wanted = comparableUrl(url);
  if (!wanted) return null;
  return (
    repos.recipes
      .getAll({ includeInactive: true })
      .find((recipe) => comparableUrl(recipe.url) === wanted) || null
  );
}

function copyLibraryRecipe(repos, libraryId) {
  const row = repos.recipeLibrary.getById(libraryId);
  if (!row || row.active === 0) return null;
  if (!enabledSourceNames().includes(row.source_name)) return null;
  const canonical = canonicalRecipeUrl(row.canonical_url);
  if (!canonical) return { rejected: true };
  const existing = familyRecipeByUrl(repos, canonical);
  if (existing) return { alreadyAdded: true, recipeId: existing.id, recipe: existing };
  const category = ALLOWED_CATEGORY.has(row.category) ? row.category : 'comfort';
  const recipeId = Number(
    repos.recipes.insert({
      name: row.title,
      category,
      prepTime: row.total_time_min ? `${row.total_time_min} min` : null,
      source: row.source_name,
      url: canonical,
      servings: row.servings || 2,
      sourceType: 'imported',
      ingredients: (row.ingredients || []).map((ing) => ({
        productKey: ing.productKey || null,
        name: ing.name || ing.rawLine,
        qty: ing.qty == null ? null : ing.qty,
        unit: ing.unit || null,
      })),
    })
  );
  return { alreadyAdded: false, recipeId, recipe: repos.recipes.getById(recipeId) };
}

function visibleLibraryDinner(repos, libraryId) {
  if (!libraryId || !repos.recipeLibrary || typeof repos.recipeLibrary.getById !== 'function') {
    return null;
  }
  const row = repos.recipeLibrary.getById(libraryId);
  if (!row || row.active === 0) return null;
  if (!enabledSourceNames().includes(row.source_name)) return null;
  return {
    id: null,
    libraryId: row.id,
    name: row.title,
    category: row.category || 'comfort',
    prepTime: row.total_time_min ? `${row.total_time_min} min` : null,
    servings: row.servings || 2,
    source: row.source_name,
    url: row.canonical_url || null,
    fromLibrary: true,
    notes: null,
    ingredients: (row.ingredients || []).map((ing) => ({
      name: ing.name || ing.rawLine,
      qty: ing.qty,
      unit: ing.unit,
      productKey: ing.productKey || null,
    })),
  };
}

module.exports = { copyLibraryRecipe, familyRecipeByUrl, visibleLibraryDinner, FEW_RECIPES };
