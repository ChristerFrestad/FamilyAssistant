// Tests for pantryApi.ts — verifies request shaping (method/path/body),
// response parsing, and error mapping. Network is mocked via vi.fn()
// replacing global.fetch; no real HTTP calls.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  PantryApiError,
  fetchPantry,
  addPantryItem,
  markAmountUsed,
  deletePantryItem,
} from './pantryApi';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchPantry', () => {
  test('GETs /api/pantry with credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    const res = await fetchPantry();
    expect(res).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pantry',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      })
    );
  });

  test('forwards AbortSignal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    const ctrl = new AbortController();
    await fetchPantry(ctrl.signal);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  test('throws PantryApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'unauthorized' }));
    await expect(fetchPantry()).rejects.toMatchObject({
      name: 'PantryApiError',
      status: 401,
    });
  });
});

describe('addPantryItem', () => {
  test('POSTs to /api/pantry/add with JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        item: {
          productKey: 'pasta',
          qtyRemaining: 2,
          totalSize: null,
          unit: 'pk',
          expiresEst: null,
          reason: 'manual',
        },
      })
    );
    const res = await addPantryItem({ query: 'pasta', qty: 2, unit: 'pk' });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pantry/add',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ query: 'pasta', qty: 2, unit: 'pk' }),
      })
    );
  });

  test('throws on validation failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { detail: 'qty must be positive' }));
    await expect(addPantryItem({ query: 'x', qty: -1 })).rejects.toMatchObject({
      name: 'PantryApiError',
      status: 400,
    });
  });
});

describe('markAmountUsed', () => {
  test('PUTs to /api/pantry/correct with newQty', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        productKey: 'melk',
        prevQty: 1,
        newQty: 0.5,
        delta: -0.5,
      })
    );
    const res = await markAmountUsed('melk', 0.5);
    expect(res.newQty).toBe(0.5);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/pantry/correct');
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ productKey: 'melk', newQty: 0.5 });
  });

  test('passes notes when provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, productKey: 'melk', prevQty: 1, newQty: 0, delta: -1 })
    );
    await markAmountUsed('melk', 0, 'used the rest');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      productKey: 'melk',
      newQty: 0,
      notes: 'used the rest',
    });
  });
});

describe('deletePantryItem', () => {
  test('DELETEs to /api/pantry/:productKey with URL-encoding', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, productKey: 'melk' }));
    await deletePantryItem('melk');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pantry/melk',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' })
    );
  });

  test('encodes special chars in productKey', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, productKey: 'melk lett' }));
    await deletePantryItem('melk lett');
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/pantry/melk%20lett');
  });

  test('throws when not found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: 'not found' }));
    await expect(deletePantryItem('nope')).rejects.toMatchObject({
      name: 'PantryApiError',
      status: 404,
    });
  });
});

describe('PantryApiError', () => {
  test('preserves status and code', () => {
    const e = new PantryApiError(409, 'conflict', 'CONFLICT');
    expect(e.status).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(e.message).toBe('conflict');
    expect(e.name).toBe('PantryApiError');
  });
});
