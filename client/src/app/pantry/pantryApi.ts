// Backend client for the Pantry sub-view.
//
// Phase 2E scope: read the pantry, mark amounts as used (which decrements
// remaining via PUT /api/pantry/correct), add new items manually, and
// remove items. All endpoints follow the existing fetch conventions:
// credentials:'include' so the HttpOnly session cookie tags every
// request, and a single PantryApiError carrying the HTTP status.
//
// The backend already implements auto-add (shopping toggle "bought"
// inserts the item into pantry) and the low-stock auto-suggest flow
// (correctQty triggers shopping-list insertion when ratio < 20%).
// Frontend does not call those flows directly — they happen as a
// side-effect of operations the user already performs on Shopping.

export class PantryApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'PantryApiError';
    this.status = status;
    this.code = code;
  }
}

// ============================================================
// Response shapes
// ============================================================

export interface PantryItem {
  productKey: string;
  /** Stable identifier inherited from products catalog. */
  ingredientName: string;
  /** Norwegian display name when available. */
  ingredientNameNo: string;
  /** Aliased "name" — preferred display string (NO when present). */
  name: string;
  /** Remaining qty in the same unit as `unit`. */
  quantity: number;
  /** Original/total package size; null when never set. */
  total: number | null;
  /** quantity / total in [0, 1+]; null when total is unknown. */
  ratio: number | null;
  /** Server-derived: ratio < LOW_THRESHOLD (currently 0.20). */
  isLow: boolean;
  /** Unit string ("stk", "dl", "g", etc.). May be empty when unknown. */
  unit: string;
  category: string | null;
  /** ISO YYYY-MM-DD or null. Server-side `expires_est`. */
  expiresEst: string | null;
  /** ISO YYYY-MM-DD or null. */
  lastPurchased: string | null;
  /** Learned shelf-life metadata (PR A.2). */
  shelfDaysLearned: number | null;
  shelfDaysSampleCount: number;
  shelfDaysSeed: number | null;
}

export interface PantryListResponse {
  items: PantryItem[];
}

export interface PantryAddBody {
  /**
   * Free-text user input ("melk"); backend resolves to productKey via
   * pantryResolver. Either query OR productKey must be set per Zod
   * schema, but the UI flow uses query exclusively for new manual adds.
   */
  query: string;
  qty: number;
  unit?: string;
  total?: number;
  category?: string;
  notes?: string;
}

export interface PantryAddResponse {
  ok: true;
  item: {
    productKey: string;
    qtyRemaining: number;
    totalSize: number | null;
    unit: string;
    expiresEst: string | null;
    reason: string;
  };
  resolved?: {
    productKey: string;
    isNew?: boolean;
    unit?: string;
    category?: string;
  };
}

export interface PantryCorrectBody {
  productKey: string;
  /** Absolute new quantity, NOT a delta. Backend computes delta itself. */
  newQty: number;
  newTotal?: number;
  newUnit?: string;
  notes?: string;
}

export interface PantryCorrectResponse {
  ok: true;
  productKey: string;
  prevQty: number;
  newQty: number;
  delta: number;
  /** Set when the correction crossed below LOW_THRESHOLD and pantry
   *  service auto-added to the active shopping list. */
  lowStock?: {
    triggered: boolean;
    listId?: number;
    reason?: string;
  };
}

export interface PantryDeleteResponse {
  ok: true;
  productKey: string;
}

// ============================================================
// Internal helpers — mirror shoppingApi for consistency
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
  throw new PantryApiError(res.status, detail, code);
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

export async function fetchPantry(signal?: AbortSignal): Promise<PantryListResponse> {
  const opts: FetchOptions = {};
  if (signal) opts.signal = signal;
  return getJson<PantryListResponse>('/api/pantry', opts);
}

export async function addPantryItem(body: PantryAddBody): Promise<PantryAddResponse> {
  return sendJson<PantryAddResponse>('POST', '/api/pantry/add', body);
}

/**
 * Mark an amount as used. Translates a "user used X units" intent into the
 * backend's absolute-newQty contract: newQty = currentRemaining - amountUsed.
 * Caller is expected to have already validated 0 < amountUsed <= currentRemaining.
 */
export async function markAmountUsed(
  productKey: string,
  newQty: number,
  notes?: string
): Promise<PantryCorrectResponse> {
  const body: PantryCorrectBody = { productKey, newQty };
  if (notes) body.notes = notes;
  return sendJson<PantryCorrectResponse>('PUT', '/api/pantry/correct', body);
}

export async function deletePantryItem(productKey: string): Promise<PantryDeleteResponse> {
  // productKey may contain spaces or special chars from auto-resolve; encode for safety.
  const encoded = encodeURIComponent(productKey);
  return sendJson<PantryDeleteResponse>('DELETE', `/api/pantry/${encoded}`);
}
