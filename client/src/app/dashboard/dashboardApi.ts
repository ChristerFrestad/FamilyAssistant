// Backend client for the dashboard screen.
//
// PR-#? Fase 2A: Christer's Strategy A — three parallel calls to
// existing endpoints, no new aggregated /api/dashboard/today
// endpoint. Each helper here wraps a single fetch + JSON parse;
// the useDashboardData hook fans them out via Promise.all.
//
// Cookie note: every request sets `credentials: 'include'`. Same
// rationale as authApi.ts — the session cookie is HttpOnly and
// must be sent back so the server can identify the family.

export class DashboardApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DashboardApiError';
    this.status = status;
  }
}

// ============================================================
// Response shapes
// ============================================================

export interface TodayMeal {
  dayOfWeek: number;
  recipeId: number | null;
  status: string;
  notes: string | null;
  // Backend returns rows from the `recipes` table (see
  // server/repositories/recipe.repo.js getById) — fields use the
  // SQL column names (name, category) plus aliased prepTime /
  // sourceType. We mirror that here so consumers can read the
  // response without an extra mapping layer.
  recipe: {
    id: number;
    name: string;
    category?: string | null;
    prepTime?: string | null;
    servings?: number | null;
  } | null;
}

export interface TodayChore {
  choreId: string;
  task: string;
  icon?: string;
  status: string;
  scheduledDay: number;
  postponedTo: number | null;
}

export interface TodayResponse {
  dayName: string;
  dayOfWeek: number;
  weekYear: string;
  meal: TodayMeal | null;
  chores: TodayChore[];
  events: CalendarEvent[];
}

export interface ShoppingItem {
  id: number;
  ingredientName: string;
  qty: number;
  unit: string;
  checkedOff: boolean;
}

export interface ShoppingSummaryResponse {
  id: number | null;
  weekYear: string;
  status: string | null;
  items: ShoppingItem[];
  totalEstPrice: number;
}

export interface CalendarEvent {
  id: number;
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
}

export interface CalendarRangeResponse {
  events: CalendarEvent[];
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
    throw new DashboardApiError(res.status, detail);
  }
  return parsed as T;
}

// ============================================================
// Public API
// ============================================================

export async function fetchToday(signal?: AbortSignal): Promise<TodayResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return getJson<TodayResponse>('/api/today', init);
}

export async function fetchShoppingSummary(signal?: AbortSignal): Promise<ShoppingSummaryResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  return getJson<ShoppingSummaryResponse>('/api/shopping/list/current', init);
}

/**
 * Fetch calendar events in a date range (inclusive on both ends).
 * Dates are ISO YYYY-MM-DD. The backend uses `from` + `to` query
 * params; both default to today server-side, but we always pass an
 * explicit range so the dashboard's "next 30 days" window is
 * deterministic regardless of server clock.
 */
export async function fetchUpcomingEvents(
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<CalendarRangeResponse> {
  const init: FetchOptions = {};
  if (signal) init.signal = signal;
  const url = `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return getJson<CalendarRangeResponse>(url, init);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Today + N days as ISO YYYY-MM-DD. Used by the dashboard to build
 * a 30-day calendar window. Pure function so it's trivial to unit-
 * test without faking Date.now.
 */
export function isoDate(offsetDays = 0, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
