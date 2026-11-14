'use strict';

const { extractJsonLd, findRecipeNode, mapRecipeNode } = require('../recipe-url-import.service');
const { parseLibraryIngredient } = require('./ingredients');
const { matchCatalogKey } = require('./catalog-match');

function libraryRecordFromHtml(html, canonicalUrl, sourceName, productsMap) {
  const urlObj = new URL(canonicalUrl);
  const node = findRecipeNode(extractJsonLd(html));
  if (!node) return null;
  const mapped = mapRecipeNode(node, urlObj, { includeInstructions: false });
  if (mapped.notes) {
    throw new Error('Library records must not keep method text');
  }
  const rawLines = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [];
  const ingredients = rawLines
    .map((line) => {
      const text = typeof line === 'string' ? line : line && (line.text || line.name);
      const parsed = parseLibraryIngredient(text || '');
      if (!parsed) return null;
      return {
        ...parsed,
        productKey: matchCatalogKey(parsed.name, productsMap),
      };
    })
    .filter(Boolean);
  return {
    title: mapped.name,
    sourceName,
    canonicalUrl: urlObj.toString(),
    imageUrl: mapped.imageUrl,
    servings: mapped.servings,
    totalTimeMin: mapped.totalTimeMin,
    category: mapped.category,
    ingredients,
  };
}

module.exports = { libraryRecordFromHtml };
