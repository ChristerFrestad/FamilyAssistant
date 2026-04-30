// Tests for usePantryData.ts. Verifies orchestration:
//   - initial fetch + loading/error states
//   - markUsed: optimistic decrement + rollback
//   - markUsed at amountUsed=remaining removes the row
//   - removeItem: optimistic delete + rollback
//   - addItem refetches and surfaces the new item
//   - userFacingError surfacing + clearing
//   - stats recomputation (low + expiring soon)
//   - groupByCategory bucketing

import { renderHook, waitFor, act } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { usePantryData } from './usePantryData';
import { PantryApiError, type PantryItem, type PantryListResponse } from './pantryApi';

function makeItem(over: Partial<PantryItem>): PantryItem {
  return {
    productKey: 'melk',
    ingredientName: 'melk',
    ingredientNameNo: 'Melk',
    name: 'Melk',
    quantity: 1,
    total: 1,
    ratio: 1,
    isLow: false,
    unit: 'l',
    category: 'Meieri',
    expiresEst: null,
    lastPurchased: null,
    shelfDaysLearned: null,
    shelfDaysSampleCount: 0,
    shelfDaysSeed: null,
    ...over,
  };
}

function fetchOk(items: PantryItem[]) {
  return vi.fn().mockResolvedValue({ items } satisfies PantryListResponse);
}

describe('usePantryData — initial load', () => {
  test('exposes loading then resolves with items', async () => {
    const fetchFn = fetchOk([
      makeItem({ productKey: 'melk', name: 'Melk' }),
      makeItem({ productKey: 'smor', name: 'Smør', category: 'Meieri' }),
    ]);
    const { result } = renderHook(() => usePantryData({ fetchPantry: fetchFn }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.stats.total).toBe(2);
    expect(result.current.error).toBeNull();
  });

  test('exposes error when fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new PantryApiError(500, 'boom'));
    const { result } = renderHook(() => usePantryData({ fetchPantry: fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.items).toEqual([]);
  });

  test('handles empty pantry', async () => {
    const fetchFn = fetchOk([]);
    const { result } = renderHook(() => usePantryData({ fetchPantry: fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.stats.total).toBe(0);
  });
});

describe('usePantryData — stats', () => {
  test('counts low and expiring-soon items', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inFiveDays = new Date(today.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
    const inTenDays = new Date(today.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);

    const fetchFn = fetchOk([
      makeItem({ productKey: 'a', isLow: true, expiresEst: inFiveDays }),
      makeItem({ productKey: 'b', isLow: false, expiresEst: inTenDays }),
      makeItem({ productKey: 'c', isLow: true, expiresEst: null }),
    ]);
    const { result } = renderHook(() => usePantryData({ fetchPantry: fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stats.lowCount).toBe(2);
    expect(result.current.stats.expiringSoonCount).toBe(1);
  });
});

describe('usePantryData — itemsByCategory', () => {
  test('groups items by category and falls back to "other" for null', async () => {
    const fetchFn = fetchOk([
      makeItem({ productKey: 'melk', category: 'Meieri' }),
      makeItem({ productKey: 'smor', category: 'Meieri' }),
      makeItem({ productKey: 'pasta', category: 'Tørrvarer' }),
      makeItem({ productKey: 'unknown', category: null }),
    ]);
    const { result } = renderHook(() => usePantryData({ fetchPantry: fetchFn }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const groups = result.current.itemsByCategory;
    expect(groups).toHaveLength(3);
    const meieri = groups.find((g) => g.category === 'Meieri');
    const other = groups.find((g) => g.category === 'other');
    expect(meieri?.items).toHaveLength(2);
    expect(other?.items).toHaveLength(1);
  });
});

describe('usePantryData — markUsed', () => {
  test('optimistically decrements quantity', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk', quantity: 1, total: 1, ratio: 1 })]);
    const markUsedFn = vi.fn().mockResolvedValue({
      ok: true,
      productKey: 'melk',
      prevQty: 1,
      newQty: 0.5,
      delta: -0.5,
    });
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, markAmountUsed: markUsedFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const item = result.current.items[0];
      if (!item) throw new Error('item missing');
      await result.current.markUsed(item, 0.5);
    });

    expect(markUsedFn).toHaveBeenCalledWith('melk', 0.5);
    const item = result.current.items[0];
    expect(item?.quantity).toBe(0.5);
    expect(item?.ratio).toBeCloseTo(0.5);
  });

  test('removes item when amountUsed equals remaining', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk', quantity: 1 })]);
    const markUsedFn = vi.fn().mockResolvedValue({
      ok: true,
      productKey: 'melk',
      prevQty: 1,
      newQty: 0,
      delta: -1,
    });
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, markAmountUsed: markUsedFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const item = result.current.items[0];
      if (!item) throw new Error('item missing');
      await result.current.markUsed(item, 1);
    });

    expect(result.current.items).toEqual([]);
  });

  test('rolls back on failure and surfaces error', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk', quantity: 1 })]);
    const markUsedFn = vi.fn().mockRejectedValue(new PantryApiError(500, 'boom'));
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, markAmountUsed: markUsedFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const item = result.current.items[0];
      if (!item) throw new Error('item missing');
      await result.current.markUsed(item, 0.5);
    });

    expect(result.current.items[0]?.quantity).toBe(1);
    expect(result.current.userFacingError?.message).toContain('boom');
  });
});

describe('usePantryData — removeItem', () => {
  test('optimistically removes and surfaces nothing on success', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk' }), makeItem({ productKey: 'smor' })]);
    const deleteFn = vi.fn().mockResolvedValue({ ok: true, productKey: 'melk' });
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, deletePantryItem: deleteFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeItem('melk');
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.productKey).toBe('smor');
    expect(result.current.userFacingError).toBeNull();
  });

  test('rolls back on failure', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk' })]);
    const deleteFn = vi.fn().mockRejectedValue(new PantryApiError(500, 'boom'));
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, deletePantryItem: deleteFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeItem('melk');
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.userFacingError?.message).toContain('boom');
  });
});

describe('usePantryData — addItem', () => {
  test('surfaces optimistic placeholder and triggers refetch', async () => {
    const initialItems = [makeItem({ productKey: 'melk' })];
    const afterAdd = [
      makeItem({ productKey: 'melk' }),
      makeItem({ productKey: 'pasta', name: 'Pasta', category: 'Tørrvarer' }),
    ];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ items: initialItems } satisfies PantryListResponse)
      .mockResolvedValueOnce({ items: afterAdd } satisfies PantryListResponse);
    const addFn = vi.fn().mockResolvedValue({
      ok: true,
      item: {
        productKey: 'pasta',
        qtyRemaining: 1,
        totalSize: null,
        unit: 'pk',
        expiresEst: null,
        reason: 'manual',
      },
    });

    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, addPantryItem: addFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await result.current.addItem({ query: 'pasta', qty: 1, unit: 'pk' });
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(addFn).toHaveBeenCalledWith({ query: 'pasta', qty: 1, unit: 'pk' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('surfaces error when add fails and does not refetch', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk' })]);
    const addFn = vi.fn().mockRejectedValue(new PantryApiError(400, 'invalid name'));
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, addPantryItem: addFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const out = await result.current.addItem({ query: '', qty: 1 });
      expect(out).toBeNull();
    });

    expect(result.current.userFacingError?.message).toContain('invalid name');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('usePantryData — clearUserFacingError', () => {
  test('clears the toast', async () => {
    const fetchFn = fetchOk([makeItem({ productKey: 'melk' })]);
    const deleteFn = vi.fn().mockRejectedValue(new PantryApiError(500, 'boom'));
    const { result } = renderHook(() =>
      usePantryData({ fetchPantry: fetchFn, deletePantryItem: deleteFn })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeItem('melk');
    });
    expect(result.current.userFacingError).not.toBeNull();

    act(() => {
      result.current.clearUserFacingError();
    });
    expect(result.current.userFacingError).toBeNull();
  });
});
