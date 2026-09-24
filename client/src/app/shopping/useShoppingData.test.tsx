// Tests for useShoppingData.ts. Verifies orchestration:
//   - initial fetch + loading/error states
//   - optimistic toggle + rollback
//   - optimistic delete + rollback
//   - addItem appends to current list
//   - generateFromMeals re-fetches
//   - userFacingError surfacing + clearing
//   - stats recomputation
//   - hasActiveList derivation

import { renderHook, waitFor, act } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { useShoppingData } from './useShoppingData';
import {
  ShoppingApiError,
  type ShoppingItem,
  type ShoppingListCurrentResponse,
} from './shoppingApi';

function makeItem(over: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: 1,
    listId: 10,
    sourceType: 'meal_ingredient',
    sourceRef: null,
    ingredientName: 'Melk',
    ingredientNameNo: null,
    name: 'Melk',
    productKey: null,
    qty: 1,
    unit: 'l',
    category: 'Meieri',
    packSize: null,
    packUnit: null,
    packCount: null,
    estPrice: 25,
    pantryHas: false,
    pantryQty: null,
    needsBuy: true,
    boughtAt: null,
    boughtQty: null,
    checkedOff: false,
    stillNeed: 1,
    mealsJson: null,
    dairyNote: null,
    sortOrder: 0,
    notes: null,
    ...over,
  };
}

const baseList: ShoppingListCurrentResponse = {
  id: 10,
  weekYear: '2026-W18',
  status: 'active',
  enrichmentStatus: 'done',
  totalEstPrice: 100,
  categories: [
    {
      category: 'Meieri',
      items: [
        makeItem({ id: 1, name: 'Melk', estPrice: 25 }),
        makeItem({ id: 2, name: 'Smør', estPrice: 30, checkedOff: true, boughtAt: '2026-04-30' }),
      ],
    },
    {
      category: 'Frukt & grønt',
      items: [makeItem({ id: 3, name: 'Eple', category: 'Frukt & grønt', estPrice: 15 })],
    },
  ],
  items: [],
};

function fetchOk(payload: ShoppingListCurrentResponse) {
  return vi.fn().mockResolvedValue(payload);
}
function fetchEmpty() {
  return vi.fn().mockResolvedValue({
    id: null,
    weekYear: '2026-W18',
    status: null,
    enrichmentStatus: 'done',
    totalEstPrice: 0,
    categories: [],
    items: [],
  } satisfies ShoppingListCurrentResponse);
}

describe('useShoppingData — initial load', () => {
  test('exposes loading then resolves with the list', async () => {
    const fetchListFn = fetchOk(baseList);
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchListFn,
      })
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.list?.id).toBe(10);
    expect(result.current.flatItems).toHaveLength(3);
    expect(result.current.hasActiveList).toBe(true);
    expect(result.current.stats.total).toBe(3);
    expect(result.current.stats.bought).toBe(1);
    expect(result.current.stats.remaining).toBe(2);
  });

  test('hasActiveList is false when backend returns id:null', async () => {
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchEmpty(),
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasActiveList).toBe(false);
    expect(result.current.flatItems).toEqual([]);
  });

  test('exposes error when fetch rejects', async () => {
    const fetchListFn = vi.fn().mockRejectedValue(new ShoppingApiError(500, 'boom'));
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchListFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.list).toBeNull();
  });
});

describe('useShoppingData — toggleBought', () => {
  test('optimistically marks bought and confirms on success', async () => {
    const markBoughtFn = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        markItemBought: markBoughtFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const milk = result.current.flatItems.find((i) => i.id === 1);
    expect(milk).toBeDefined();
    if (!milk) throw new Error('milk should exist');

    await act(async () => {
      await result.current.toggleBought(milk);
    });

    expect(markBoughtFn).toHaveBeenCalledWith(1);
    const updated = result.current.flatItems.find((i) => i.id === 1);
    expect(updated?.checkedOff).toBe(true);
    expect(result.current.userFacingError).toBeNull();
    expect(result.current.stats.bought).toBe(2);
  });

  test('toggles unbought on already-bought item', async () => {
    const markUnboughtFn = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        markItemUnbought: markUnboughtFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const butter = result.current.flatItems.find((i) => i.id === 2);
    if (!butter) throw new Error('butter should exist');

    await act(async () => {
      await result.current.toggleBought(butter);
    });
    expect(markUnboughtFn).toHaveBeenCalledWith(2);
    const updated = result.current.flatItems.find((i) => i.id === 2);
    expect(updated?.checkedOff).toBe(false);
  });

  test('rolls back on failure and surfaces userFacingError', async () => {
    const markBoughtFn = vi
      .fn()
      .mockRejectedValue(new ShoppingApiError(500, 'server crash', 'INTERNAL'));
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        markItemBought: markBoughtFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const milk = result.current.flatItems.find((i) => i.id === 1);
    if (!milk) throw new Error('milk should exist');

    await act(async () => {
      await result.current.toggleBought(milk);
    });

    const reverted = result.current.flatItems.find((i) => i.id === 1);
    expect(reverted?.checkedOff).toBe(false);
    expect(result.current.userFacingError?.message).toBe('server crash');
    expect(result.current.userFacingError?.code).toBe('INTERNAL');
  });
});

describe('useShoppingData — removeItem', () => {
  test('optimistically removes and confirms on success', async () => {
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        deleteItem: deleteFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const milk = result.current.flatItems.find((i) => i.id === 1);
    if (!milk) throw new Error('milk should exist');

    await act(async () => {
      await result.current.removeItem(milk);
    });
    expect(deleteFn).toHaveBeenCalledWith(1);
    expect(result.current.flatItems.find((i) => i.id === 1)).toBeUndefined();
  });

  test('rolls back on failure and restores the list', async () => {
    const deleteFn = vi.fn().mockRejectedValue(new ShoppingApiError(500, 'fail'));
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        deleteItem: deleteFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const milk = result.current.flatItems.find((i) => i.id === 1);
    if (!milk) throw new Error('milk should exist');

    await act(async () => {
      await result.current.removeItem(milk);
    });
    expect(result.current.flatItems.find((i) => i.id === 1)).toBeDefined();
    expect(result.current.userFacingError?.message).toBe('fail');
  });
});

describe('useShoppingData — addItem', () => {
  test('appends new item to the categories', async () => {
    const newItem = makeItem({
      id: 99,
      name: 'Bananer',
      category: 'Frukt & grønt',
      estPrice: 20,
    });
    const addItemFn = vi.fn().mockResolvedValue({ ok: true, item: newItem });
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        addItem: addItemFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addItem({ name: 'Bananer' });
    });
    expect(addItemFn).toHaveBeenCalledWith({ name: 'Bananer' });
    expect(result.current.flatItems.find((i) => i.id === 99)).toBeDefined();
  });

  test('forwards NO_ACTIVE_LIST as userFacingError', async () => {
    const addItemFn = vi
      .fn()
      .mockRejectedValue(new ShoppingApiError(400, 'no list', 'NO_ACTIVE_LIST'));
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchEmpty(),
        addItem: addItemFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.addItem({ name: 'Melk' });
    });
    expect(returned).toBeNull();
    expect(result.current.userFacingError?.code).toBe('NO_ACTIVE_LIST');
  });
});

describe('useShoppingData — generateFromMeals', () => {
  test('calls generate and triggers a re-fetch', async () => {
    let fetchCount = 0;
    const fetchListFn = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return baseList;
    });
    const generateFn = vi.fn().mockResolvedValue({
      ok: true,
      listId: 10,
      itemCount: 3,
      needsBuyCount: 2,
    });
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchListFn,
        generateFromMeals: generateFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchCount).toBe(1);

    await act(async () => {
      await result.current.generateFromMeals();
    });
    expect(generateFn).toHaveBeenCalled();
    await waitFor(() => expect(fetchCount).toBe(2));
  });

  test('surfaces WEEK_NOT_COMPLETE on backend rejection', async () => {
    const generateFn = vi
      .fn()
      .mockRejectedValue(new ShoppingApiError(400, 'not complete', 'WEEK_NOT_COMPLETE'));
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        generateFromMeals: generateFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.generateFromMeals();
    });
    expect(result.current.userFacingError?.code).toBe('WEEK_NOT_COMPLETE');
  });
});

describe('useShoppingData — stats', () => {
  test('remainingPriceSum sums only un-bought items with positive estPrice', async () => {
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Milk (25) + Eple (15) = 40. Smør is bought.
    expect(result.current.stats.remainingPriceSum).toBe(40);
    expect(result.current.stats.itemsWithPriceCount).toBe(2);
  });

  test('clearUserFacingError clears the toast state', async () => {
    const markBoughtFn = vi.fn().mockRejectedValue(new ShoppingApiError(500, 'fail'));
    const { result } = renderHook(() =>
      useShoppingData({
        fetchShoppingList: fetchOk(baseList),
        markItemBought: markBoughtFn,
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const milk = result.current.flatItems.find((i) => i.id === 1);
    if (!milk) throw new Error('milk should exist');
    await act(async () => {
      await result.current.toggleBought(milk);
    });
    expect(result.current.userFacingError).not.toBeNull();
    act(() => result.current.clearUserFacingError());
    expect(result.current.userFacingError).toBeNull();
  });
});
