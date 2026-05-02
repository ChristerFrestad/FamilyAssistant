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

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MealsApiError';
    this.status = status;
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
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new MealsApiError(res.status, detail);
  }
  return parsed as T;
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
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new MealsApiError(res.status, detail);
  }
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
