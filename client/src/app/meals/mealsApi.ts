// Backend client for the Meals screen.
//
// Read-only scope for Phase 2C: a single GET /api/meals/current call
// returns the seven-day plan with recipes already attached. Mutating
// endpoints (swap, status, reorder, pantry-suggestions) live behind
// placeholder buttons in the UI and will get their own helpers when
// they ship in Sprint 5+.
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

export type MealStatus = 'planned' | 'eaten' | 'away' | 'skipped' | 'removed';

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
  /** ISO weekday: mandag=0, søndag=6. */
  dayOfWeek: number;
  /** Norwegian day name from backend (mandag/tirsdag/...). */
  dayName: string;
  recipeId: number | null;
  status: MealStatus;
  notes: string | null;
  recipe: MealRecipe | null;
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
