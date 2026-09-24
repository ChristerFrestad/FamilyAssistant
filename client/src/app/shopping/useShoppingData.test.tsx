import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useShoppingData } from './useShoppingData';
import type { ShoppingListCurrentResponse } from './shoppingApi';

const EMPTY: ShoppingListCurrentResponse = {
  id: null,
  weekYear: '2026-W18',
  status: null,
  enrichmentStatus: 'done',
  totalEstPrice: 0,
  categories: [],
  items: [],
};

describe('useShoppingData weekYear', () => {
  test('passes the selected ISO week to the list fetcher', async () => {
    const fetchShoppingList = vi.fn().mockResolvedValue(EMPTY);
    const { result } = renderHook(() =>
      useShoppingData({ fetchShoppingList, weekYear: '2026-W20' })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchShoppingList).toHaveBeenCalledWith(expect.any(AbortSignal), '2026-W20');
  });
});
