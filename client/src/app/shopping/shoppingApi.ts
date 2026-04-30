// Backend client for the Shopping screen.
//
// Phase 2D scope: read the active list, toggle bought state, delete
// items, append manual items, and trigger generation from the meal
// plan. All endpoints follow the existing fetch conventions:
// credentials:'include' so the HttpOnly session cookie tags every
// request, and a single ShoppingApiError carrying the HTTP status.
//
// Defensive shape: list/current returns categories[] grouped server-
// side. We expose the raw response unchanged — the hook + screen
// flatten and re-group as needed for optimistic updates.

export class ShoppingApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'ShoppingApiError';
    this.status = status;
    this.code = code;
  }
}

// ============================================================
// Response shapes
// ============================================================

export interface ShoppingItem {
  id: number;
  listId: number;
  sourceType: 'meal_ingredient' | 'consumable' | 'extra' | 'manual';
  sourceRef: string | null;
  ingredientName: string;
  ingredientNameNo: string | null;
  /** Aliased "name" — preferred display name (NO if available, else original). */
  name: string;
  productKey: string | null;
  qty: number | null;
  unit: string | null;
  category: string | null;
  packSize: number | null;
  packUnit: string | null;
  packCount: number | null;
  estPrice: number | null;
  pantryHas: boolean;
  pantryQty: number | null;
  needsBuy: boolean;
  boughtAt: string | null;
  boughtQty: number | null;
  /** Computed from boughtAt — true if the row has been marked bought. */
  checkedOff: boolean;
  /** Computed leftover qty after pantry is subtracted. */
  stillNeed: number;
  /** Recipe names that originally contributed this item. */
  mealsJson: string[] | null;
  dairyNote: string | null;
  sortOrder: number;
  notes: string | null;
}

export interface ShoppingCategory {
  category: string;
  items: ShoppingItem[];
}

export interface ShoppingListCurrentResponse {
  /** null when no active list exists for the current week. */
  id: number | null;
  weekYear: string;
  status: 'active' | 'done' | 'superseded' | 'draft' | null;
  enrichmentStatus: 'pending' | 'running' | 'done' | 'partial' | 'failed' | null;
  generatedAt?: string | null;
  confirmedAt?: string | null;
  totalEstPrice: number;
  categories: ShoppingCategory[];
  items?: ShoppingItem[];
}

export interface ShoppingItemAddBody {
  name: string;
  qty?: number;
  unit?: string;
  category?: string;
  notes?: string;
}

export interface ShoppingItemAddResponse {
  ok: true;
  item: ShoppingItem;
}

export interface ShoppingGenerateResponse {
  ok: true;
  listId: number;
  itemCount: number;
  needsBuyCount: number;
}

// ============================================================
// Internal helpers
// ============================================================

interface FetchOptions {
  signal?: AbortSignal;
}

interface ProblemResponse {
  detail?: string;
  code?: string;
}

async function parseResponse(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function throwIfError(res: Response, parsed: unknown, fallback: string): void {
  if (res.ok) return;
  const detail =
    parsed && typeof parsed === 'object' && 'detail' in parsed
      ? String((parsed as ProblemResponse).detail || fallback)
      : fallback;
  const code =
    parsed && typeof parsed === 'object' && 'code' in parsed
      ? String((parsed as ProblemResponse).code || '') || null
      : null;
  throw new ShoppingApiError(res.status, detail, code);
}

async function getJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(path, init);
  const parsed = await parseResponse(res);
  throwIfError(res, parsed, `HTTP ${res.status}`);
  return parsed as T;
}

async function sendJson<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: FetchOptions = {}
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  if (options.signal) init.signal = options.signal;
  const res = await fetch(path, init);
  const parsed = await parseResponse(res);
  throwIfError(res, parsed, `HTTP ${res.status}`);
  return parsed as T;
}

// ============================================================
// Public API
// ============================================================

export async function fetchShoppingList(
  signal?: AbortSignal
): Promise<ShoppingListCurrentResponse> {
  const opts: FetchOptions = {};
  if (signal) opts.signal = signal;
  return getJson<ShoppingListCurrentResponse>('/api/shopping/list/current', opts);
}

export async function markItemBought(
  itemId: number,
  qty?: number
): Promise<{ ok: true; alreadyBought?: boolean }> {
  return sendJson<{ ok: true; alreadyBought?: boolean }>(
    'PUT',
    `/api/shopping/items/${itemId}/bought`,
    qty != null ? { qty } : {}
  );
}

export async function markItemUnbought(itemId: number): Promise<{ ok: true }> {
  return sendJson<{ ok: true }>('PUT', `/api/shopping/items/${itemId}/unbought`);
}

export async function deleteItem(itemId: number): Promise<{ ok: true }> {
  return sendJson<{ ok: true }>('DELETE', `/api/shopping/items/${itemId}`);
}

export async function addItem(body: ShoppingItemAddBody): Promise<ShoppingItemAddResponse> {
  return sendJson<ShoppingItemAddResponse>('POST', '/api/shopping/items', body);
}

export async function generateFromMeals(): Promise<ShoppingGenerateResponse> {
  return sendJson<ShoppingGenerateResponse>('POST', '/api/shopping/generate', {});
}
