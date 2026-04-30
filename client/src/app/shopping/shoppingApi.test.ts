// Tests for shoppingApi.ts.
//
// Verifies the eight contracts:
//   1. fetchShoppingList GETs /api/shopping/list/current with credentials.
//   2. Non-2xx responses throw ShoppingApiError carrying status + code.
//   3. markItemBought PUTs body with qty when provided.
//   4. markItemUnbought PUTs without body.
//   5. deleteItem sends DELETE.
//   6. addItem POSTs body and returns parsed item.
//   7. generateFromMeals POSTs an empty body.
//   8. AbortSignal flows through to fetch.

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import {
  fetchShoppingList,
  markItemBought,
  markItemUnbought,
  deleteItem,
  addItem,
  generateFromMeals,
  ShoppingApiError,
} from './shoppingApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('fetchShoppingList', () => {
  test('GETs /api/shopping/list/current with credentials and parses categories', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 42,
        weekYear: '2026-W18',
        status: 'active',
        enrichmentStatus: 'done',
        totalEstPrice: 320,
        categories: [
          {
            category: 'Meieri',
            items: [{ id: 1, ingredientName: 'Melk', name: 'Melk', checkedOff: false }],
          },
        ],
        items: [],
      })
    );
    const r = await fetchShoppingList();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/shopping/list/current',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.id).toBe(42);
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0]?.items[0]?.name).toBe('Melk');
  });

  test('returns the empty-shell payload when no active list exists', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        id: null,
        weekYear: '2026-W18',
        status: null,
        enrichmentStatus: 'done',
        totalEstPrice: 0,
        categories: [],
        items: [],
      })
    );
    const r = await fetchShoppingList();
    expect(r.id).toBeNull();
    expect(r.categories).toEqual([]);
  });

  test('throws ShoppingApiError on 4xx with detail string', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Authentication required' }));
    await expect(fetchShoppingList()).rejects.toBeInstanceOf(ShoppingApiError);
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { detail: 'Authentication required' }));
    try {
      await fetchShoppingList();
    } catch (e) {
      expect(e).toBeInstanceOf(ShoppingApiError);
      expect((e as ShoppingApiError).status).toBe(401);
      expect((e as ShoppingApiError).message).toBe('Authentication required');
    }
  });

  test('forwards an AbortSignal to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        id: null,
        weekYear: '2026-W18',
        status: null,
        enrichmentStatus: 'done',
        totalEstPrice: 0,
        categories: [],
      })
    );
    const ctrl = new AbortController();
    await fetchShoppingList(ctrl.signal);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/shopping/list/current',
      expect.objectContaining({ signal: ctrl.signal })
    );
  });
});

describe('markItemBought', () => {
  test('PUTs with qty body when qty is provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await markItemBought(7, 2);
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe('/api/shopping/items/7/bought');
    expect(call?.[1]).toMatchObject({ method: 'PUT' });
    const init = call?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ qty: 2 });
  });

  test('PUTs with empty body when qty is omitted', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await markItemBought(7);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  test('returns alreadyBought when backend signals idempotent toggle', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, alreadyBought: true }));
    const r = await markItemBought(7);
    expect(r.alreadyBought).toBe(true);
  });
});

describe('markItemUnbought', () => {
  test('PUTs without body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await markItemUnbought(7);
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe('/api/shopping/items/7/unbought');
    expect((call?.[1] as RequestInit).method).toBe('PUT');
    expect((call?.[1] as RequestInit).body).toBeUndefined();
  });
});

describe('deleteItem', () => {
  test('sends DELETE', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await deleteItem(11);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/shopping/items/11',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' })
    );
  });
});

describe('addItem', () => {
  test('POSTs body and returns parsed item from 201', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(201, {
        ok: true,
        item: {
          id: 99,
          ingredientName: 'Melk',
          name: 'Melk',
          qty: 2,
          unit: 'l',
          category: 'Meieri',
          checkedOff: false,
        },
      })
    );
    const r = await addItem({ name: 'Melk', qty: 2, unit: 'l', category: 'Meieri' });
    expect(r.item.id).toBe(99);
    expect(r.item.name).toBe('Melk');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Melk',
      qty: 2,
      unit: 'l',
      category: 'Meieri',
    });
  });

  test('forwards backend code on 400 NO_ACTIVE_LIST', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(400, {
        detail: 'Ingen aktiv handleliste',
        code: 'NO_ACTIVE_LIST',
      })
    );
    try {
      await addItem({ name: 'Melk' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ShoppingApiError);
      expect((e as ShoppingApiError).status).toBe(400);
      expect((e as ShoppingApiError).code).toBe('NO_ACTIVE_LIST');
    }
  });
});

describe('generateFromMeals', () => {
  test('POSTs to /api/shopping/generate with empty body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, listId: 5, itemCount: 12, needsBuyCount: 9 })
    );
    const r = await generateFromMeals();
    expect(r.listId).toBe(5);
    expect(r.itemCount).toBe(12);
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe('/api/shopping/generate');
    expect((call?.[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({});
  });

  test('forwards WEEK_NOT_COMPLETE code from backend', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(400, {
        detail: 'Uken er ikke ferdigplanlagt',
        code: 'WEEK_NOT_COMPLETE',
      })
    );
    try {
      await generateFromMeals();
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ShoppingApiError).code).toBe('WEEK_NOT_COMPLETE');
    }
  });
});
