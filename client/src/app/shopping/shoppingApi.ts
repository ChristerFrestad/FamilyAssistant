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
  constructor(status: number, message: string, code: string | null = null) { super(message); this.name = 'ShoppingApiError'; this.status = status; this.code = code; }
}

export interface ShoppingItem {
  id: number; listId: number; sourceType: 'meal_ingredient' | 'consumable' | 'extra' | 'manual'; sourceRef: string | null; ingredientName: string; ingredientNameNo: string | null; name: string; productKey: string | null; qty: number | null; unit: string | null; category: string | null; packSize: number | null; packUnit: string | null; packCount: number | null; estPrice: number | null; pantryHas: boolean; pantryQty: number | null; needsBuy: boolean; boughtAt: string | null; boughtQty: number | null; checkedOff: boolean; stillNeed: number; mealsJson: string[] | null; dairyNote: string | null; sortOrder: number; notes: string | null;
}
export interface ShoppingCategory { category: string; items: ShoppingItem[]; }
export interface ShoppingListCurrentResponse { id: number | null; weekYear: string; status: 'active' | 'done' | 'superseded' | 'draft' | null; enrichmentStatus: 'pending' | 'running' | 'done' | 'partial' | 'failed' | null; generatedAt?: string | null; confirmedAt?: string | null; totalEstPrice: number; categories: ShoppingCategory[]; items?: ShoppingItem[]; }
export interface ShoppingItemAddBody { name: string; qty?: number; unit?: string; category?: string; notes?: string; weekYear?: string; }
export interface ShoppingItemAddResponse { ok: true; item: ShoppingItem; }
export interface ShoppingGenerateResponse { ok: true; listId: number; itemCount: number; needsBuyCount: number; }
interface FetchOptions { signal?: AbortSignal; }
interface ProblemResponse { detail?: string; code?: string; }
async function parseResponse(res: Response): Promise<unknown> { try { return await res.json(); } catch { return null; } }
function throwIfError(res: Response, parsed: unknown, fallback: string): void { if (res.ok) return; const detail = parsed && typeof parsed === 'object' && 'detail' in parsed ? String((parsed as ProblemResponse).detail || fallback) : fallback; const code = parsed && typeof parsed === 'object' && 'code' in parsed ? String((parsed as ProblemResponse).code || '') || null : null; throw new ShoppingApiError(res.status, detail, code); }
async function getJson<T>(path: string, options: FetchOptions = {}): Promise<T> { const init: RequestInit = { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }; if (options.signal) init.signal = options.signal; const res = await fetch(path, init); const parsed = await parseResponse(res); throwIfError(res, parsed, `HTTP ${res.status}`); return parsed as T; }
async function sendJson<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, options: FetchOptions = {}): Promise<T> { const init: RequestInit = { method, credentials: 'include', headers: { Accept: 'application/json' } }; if (body !== undefined) { init.headers = { ...init.headers, 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); } if (options.signal) init.signal = options.signal; const res = await fetch(path, init); const parsed = await parseResponse(res); throwIfError(res, parsed, `HTTP ${res.status}`); return parsed as T; }
export async function fetchShoppingList(signal?: AbortSignal, weekYear?: string): Promise<ShoppingListCurrentResponse> { const opts: FetchOptions = {}; if (signal) opts.signal = signal; const q = weekYear ? `?week=${encodeURIComponent(weekYear)}` : ''; return getJson<ShoppingListCurrentResponse>(`/api/shopping/list/current${q}`, opts); }
export async function markItemBought(itemId: number, qty?: number): Promise<{ ok: true; alreadyBought?: boolean }> { return sendJson<{ ok: true; alreadyBought?: boolean }>('PUT', `/api/shopping/items/${itemId}/bought`, qty != null ? { qty } : {}); }
export async function markItemUnbought(itemId: number): Promise<{ ok: true }> { return sendJson<{ ok: true }>('PUT', `/api/shopping/items/${itemId}/unbought`); }
export async function deleteItem(itemId: number): Promise<{ ok: true }> { return sendJson<{ ok: true }>('DELETE', `/api/shopping/items/${itemId}`); }
export async function addItem(body: ShoppingItemAddBody, weekYear?: string): Promise<ShoppingItemAddResponse> { const payload = weekYear && !('weekYear' in body) ? { ...body, weekYear } : body; return sendJson<ShoppingItemAddResponse>('POST', '/api/shopping/items', payload); }
export async function generateFromMeals(weekYear?: string): Promise<ShoppingGenerateResponse> { const body = weekYear ? { weekYear } : {}; return sendJson<ShoppingGenerateResponse>('POST', '/api/shopping/generate', body); }
