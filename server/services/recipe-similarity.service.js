/**
 * Fase F4 — Recipe similarity.
 *
 * Beregner likhet mellom to oppskrifter basert på:
 *   - Jaccard-similarity over ingrediens-productKeys (vekt 0.6)
 *   - Kategori-match (1 hvis samme category, 0 ellers; vekt 0.3)
 *   - Servings-proximity (1 - |diff|/max(servings); vekt 0.1)
 *
 * Resultat: score i [0, 1].
 *
 * Caching: enkel LRU-cache med TTL 10 minutter på per-recipe-id basis.
 * Invalidatet eksplisitt av clear() når oppskrifter endres.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 100;
const cache = new Map(); // id -> { at, data }

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function ingredientKeys(recipe) {
  if (!recipe || !Array.isArray(recipe.ingredients)) return [];
  return recipe.ingredients
    .map((i) => i.productKey || (i.name || '').toLowerCase().trim())
    .filter(Boolean);
}

function computeSimilarity(a, b) {
  if (!a || !b || a.id === b.id) return { score: 0, reasons: [] };
  const keysA = ingredientKeys(a);
  const keysB = ingredientKeys(b);
  const ingJac = jaccard(keysA, keysB);

  const categoryMatch = a.category && b.category && a.category === b.category ? 1 : 0;

  let servingsProximity = 1;
  if (a.servings && b.servings) {
    const maxS = Math.max(a.servings, b.servings);
    servingsProximity = 1 - Math.abs(a.servings - b.servings) / maxS;
  }

  const score = ingJac * 0.6 + categoryMatch * 0.3 + servingsProximity * 0.1;

  const reasons = [];
  if (ingJac > 0.4) reasons.push(`${Math.round(ingJac * 100)}% felles ingredienser`);
  else if (ingJac > 0) reasons.push(`${Math.round(ingJac * 100)}% overlapp`);
  if (categoryMatch) reasons.push(`samme kategori (${a.category})`);
  if (servingsProximity >= 0.8 && a.servings && b.servings)
    reasons.push(`samme porsjons-størrelse`);

  return { score: Math.min(1, score), reasons };
}

function findSimilar(repos, recipeId, limit = 5) {
  if (!repos || !repos.recipes) return [];
  const id = parseInt(recipeId, 10);
  if (!Number.isFinite(id)) return [];

  // Cache-sjekk
  const now = Date.now();
  const cached = cache.get(id);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.data.slice(0, limit);
  }

  const target = repos.recipes.getById(id);
  if (!target) return [];

  const all = repos.recipes.getAll();
  const scored = all
    .filter((r) => r.id !== id)
    .map((r) => {
      const sim = computeSimilarity(target, r);
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        prepTime: r.prepTime || r.prep_time,
        servings: r.servings,
        score: sim.score,
        reasons: sim.reasons,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  // Cache lagring
  if (cache.size >= CACHE_MAX) {
    // Fjern eldste
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(id, { at: now, data: scored });

  return scored.slice(0, limit);
}

function clear() {
  cache.clear();
}

module.exports = {
  computeSimilarity,
  findSimilar,
  jaccard,
  clear,
};
