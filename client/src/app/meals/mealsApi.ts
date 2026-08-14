// Backend client for the Meals screen.
//
// Originally read-only for Phase 2C. Sprint 6 adds the smart-coupling
// endpoints — markEaten/applyDeduction/unmarkEaten — that drive the
// MarkCookedDialog. Other mutating endpoints (swap, status, reorder,
// pantry-suggestions) still live behind placeholder buttons until
// they ship.
//
// We keep the same fetch conventions as dashboardApi/familyApi:
// credentials:'include' so the HttpOnly session cookie tags every
// request, and a single MealsApiError carrying the HTTP status so
// callers branch on 401/403/4xx without parsing message strings.

export class MealsApiError extends Error {
  status: number;
  code: string | undefined;
  mealPlanCount: number | undefined;

  constructor(
    status: number,
    message: string,
    extras: { code?: string; mealPlanCount?: number } = {}
  ) {
    super(message);
    this.name = 'MealsApiError';
    this.status = status;
    this.code = extras.code;
    this.mealPlanCount = extras.mealPlanCount;
  }
}

// ============================================================
// Response shapes
// ============================================================

export type RecipeCategory = 'rask' | 'comfort' | 'helg';

// Backend persists 'cooked' (per the meal_plans CHECK constraint).
// The frontend value used to be 'eaten' which never matched any real
// row — kept as an alias here only because removing it could ripple
// into legacy code; new UI code should use 'cooked'.
export type MealStatus = 'planned' | 'cooked' | 'eaten' | 'away' | 'skipped' | 'removed';

export interface RecipeIngredient {
  id?: number;
  productKey: string | null;
  name: string;
  qty: number;
  unit: string;
  optional?: boolean;
}

/**
 * Recipe shape returned inside /api/meals/current. The backend
 * spreads the raw SQL row plus camelCase aliases (prepTime,
 * sourceType) and an ingredients array. We type the fields we
 * actually consume in the UI; ignore the rest. `servings` is
 * intentionally `number | null` because seed-data is consistent
 * for pilot but UI-imported / scraped recipes (post-pilot) may
 * lack a servings count — RecipeIngredients handles that case
 * defensively.
 */
export interface MealRecipe {
  id: number;
  name: string;
  category: RecipeCategory;
  prepTime: string | null;
  servings: number | null;
  source: string | null;
  url: string | null;
  notes: string | null;
  ingredients: RecipeIngredient[];
}

export interface MealSlot {
  /** Primary key from meal_plans, used by the mark-cooked endpoints. */
  id: number;
  /** ISO weekday: mandag=0, søndag=6. */
  dayOfWeek: number;
  /** Norwegian day name from backend (mandag/tirsdag/...). */
  dayName: string;
  recipeId: number | null;
  status: MealStatus;
  notes: string | null;
  recipe: MealRecipe | null;
}

// Sprint 6 — pantry deduction shapes
export interface MealDeductionSuggestion {
  productKey: string | null;
  name: string;
  recipeAmount: number;
  portionFactor: number;
  suggestedDeduction: number;
  pantryRemaining: number;
  pantryUnit: string | null;
  matched: boolean;
  optional: boolean;
}

export interface MarkEatenResponse {
  mealId: number;
  recipeId: number;
  alreadyCooked: boolean;
  suggestions: MealDeductionSuggestion[];
}

export interface DeductionItem {
  productKey: string;
  amountToDeduct: number;
}

export interface ApplyDeductionResponse {
  ok: true;
  mealId: number;
  applied: Array<{ productKey: string; prevQty: number; newQty: number; delta: number }>;
  skipped: Array<{ productKey: string | null; reason: string }>;
  lowStockTriggered: string[];
}

export interface MealsCurrentResponse {
  /** ISO week-year string, e.g. "2026-W18". */
  weekYear: string;
  meals: MealSlot[];
}

// ============================================================
// Internal helpers
// ============================================================

interface FetchOptions {
  signal?: AbortSignal;
}

async function getJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (options.signal) init.signal = options.signal;

  const res = await fetch(path, init);
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Non-JSON body — fall through to status check.
  }
  if (!res.ok) throw toMealsApiError(res.status, parsed);
  return parsed as T;
}

function toMealsApiError(status: number, parsed: unknown): MealsApiError {
  const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const detail =
    obj && 'detail' in obj && obj.detail != null ? String(obj.detail) : `HTTP ${status}`;
  const extras: { code?: string; mealPlanCount?: number } = {};
  if (obj && typeof obj.code === 'string') extras.code = obj.code;
  if (obj && typeof obj.mealPlanCount === 'number') extras.mealPlanCount = obj.mealPlanCount;
  return new MealsApiError(status, detail, extras);
}

// ============================================================
// Public API
// ============================================================

export async function fetchMealsCurrent(signal?: AbortSignal): Promise<MealsCurrentResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return getJson<MealsCurrentResponse>('/api/meals/current', init);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok) throw toMealsApiError(res.status, parsed);
  return parsed as T;
}

async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok) throw toMealsApiError(res.status, parsed);
  return parsed as T;
}

export async function markMealEaten(mealId: number): Promise<MarkEatenResponse> {
  return postJson<MarkEatenResponse>(`/api/meals/${mealId}/mark-eaten`, {});
}

export async function unmarkMealEaten(mealId: number): Promise<{ ok: true }> {
  return postJson<{ ok: true }>(`/api/meals/${mealId}/unmark-eaten`, {});
}

export async function applyMealDeduction(
  mealId: number,
  items: DeductionItem[]
): Promise<ApplyDeductionResponse> {
  return postJson<ApplyDeductionResponse>(`/api/meals/${mealId}/apply-deduction`, { items });
}

// ============================================================
// Recipes — Sprint 6 plan picker
// ============================================================

export type RecipeSourceType = 'manual' | 'ai' | 'imported';
export type RecipeSourceFilter = 'all' | 'mine' | 'imported' | 'ai';

export interface RecipeBlockedIngredient {
  name: string;
  allergen?: string;
}

export interface RecipeSummary {
  id: number;
  name: string;
  category: RecipeCategory;
  prepTime: string | null;
  servings: number | null;
  source?: string | null;
  sourceType?: RecipeSourceType | string | null;
  url?: string | null;
  active?: boolean;
  /** Backend annotates each recipe with allergy/diet flags. */
  hiddenByAllergy?: boolean;
  hiddenByDiet?: boolean;
  shownWithDislikeWarning?: boolean;
  safeForProfile?: boolean;
  /** Recipe-filter blocked-ingredients list when allergy hits. Empty when safe. */
  blockedIngredients?: RecipeBlockedIngredient[];
}

export interface RecipeDetail extends RecipeSummary {
  notes: string | null;
  ingredients: RecipeIngredient[];
  equipment?: string[];
}

export interface RecipeWriteBody {
  name: string;
  category: RecipeCategory;
  prepTime?: string;
  servings?: number;
  notes?: string;
  url?: string;
  ingredients?: Array<{
    name: string;
    qty: number;
    unit: string;
    optional?: boolean;
    productKey?: string;
  }>;
}

export interface RecipeMutationResponse {
  ok: true;
  recipeId?: number;
  recipe: RecipeDetail;
}

export interface ImportRecipeUrlResponse {
  ok: true;
  recipeId: number;
  source?: string;
  recipe?: RecipeDetail;
  safeForProfile?: boolean;
  blockedIngredients?: RecipeBlockedIngredient[];
}

export interface FetchRecipesQuery {
  source?: RecipeSourceFilter;
  includeInactive?: boolean;
}

export interface RecipesResponse {
  recipes: RecipeSummary[];
  filter: {
    ignoreDietTags: boolean;
    activeDietTags: string[];
  };
}

export interface SwapMealResponse {
  ok: true;
  mealPlan: unknown[];
  autogeneratedShoppingList: unknown;
}

/**
 * GET /api/recipes — list recipes for the current family with
 * allergy/diet annotations. Optional `source` and `includeInactive`
 * query params match the G1 library filters.
 */
export async function fetchRecipes(
  signal?: AbortSignal,
  query: FetchRecipesQuery = {}
): Promise<RecipesResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  const params = new URLSearchParams();
  if (query.source && query.source !== 'all') params.set('source', query.source);
  if (query.includeInactive) params.set('includeInactive', '1');
  const qs = params.toString();
  return getJson<RecipesResponse>(qs ? `/api/recipes?${qs}` : '/api/recipes', init);
}

/** GET /api/recipes/:id — one recipe including ingredients. */
export async function fetchRecipe(
  id: number,
  signal?: AbortSignal
): Promise<{ recipe: RecipeDetail }> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return getJson<{ recipe: RecipeDetail }>(`/api/recipes/${id}`, init);
}

/** POST /api/recipes — adult create. Server stamps sourceType=manual. */
export async function createRecipe(body: RecipeWriteBody): Promise<RecipeMutationResponse> {
  return postJson<RecipeMutationResponse>('/api/recipes', body);
}

/** PATCH /api/recipes/:id — adult update. */
export async function updateRecipe(
  id: number,
  body: Partial<RecipeWriteBody> & { active?: boolean }
): Promise<RecipeMutationResponse> {
  return sendJson<RecipeMutationResponse>('PATCH', `/api/recipes/${id}`, body);
}

/** POST /api/recipes/:id/deactivate — hide from the library. */
export async function deactivateRecipe(id: number): Promise<RecipeMutationResponse> {
  return postJson<RecipeMutationResponse>(`/api/recipes/${id}/deactivate`, {});
}

/** PATCH /api/recipes/:id { active: true } — restore a hidden recipe. */
export async function reactivateRecipe(id: number): Promise<RecipeMutationResponse> {
  return updateRecipe(id, { active: true });
}

/** DELETE /api/recipes/:id — 204, or 409 RECIPE_IN_USE / 405. */
export async function deleteRecipe(id: number): Promise<void> {
  await sendJson<undefined>('DELETE', `/api/recipes/${id}`);
}

/** POST /api/recipes/import-url — adult import from a public recipe page. */
export async function importRecipeFromUrl(url: string): Promise<ImportRecipeUrlResponse> {
  return postJson<ImportRecipeUrlResponse>('/api/recipes/import-url', { url });
}

/**
 * PUT /api/meals/swap — set or replace the recipe for a given day.
 * Backend uses INSERT ... ON CONFLICT DO UPDATE so the same call
 * works for both "plan" (empty slot) and "swap" (existing recipe).
 * Status resets to 'planned' on every swap.
 */
export async function swapMeal(
  weekYear: string,
  dayOfWeek: number,
  recipeId: number
): Promise<SwapMealResponse> {
  const res = await fetch('/api/meals/swap', {
    method: 'PUT',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ weekYear, dayOfWeek, recipeId }),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok) throw toMealsApiError(res.status, parsed);
  return parsed as SwapMealResponse;
}
