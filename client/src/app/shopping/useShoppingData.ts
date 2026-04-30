// Orchestrates the Shopping screen's data + mutation flows.
//
// One initial fetch on mount. All mutations are optimistic with
// rollback on failure: the local snapshot is updated immediately, the
// API call kicks off, and on rejection the previous snapshot is
// restored and a userFacingError is exposed so the screen can surface
// it as a toast.
//
// The hook keeps the response in the same shape as the API (categories
// + items) but exposes derived helpers (flatItems, stats, hasActiveList)
// so the screen stays declarative.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchShoppingList,
  markItemBought,
  markItemUnbought,
  deleteItem as apiDeleteItem,
  addItem as apiAddItem,
  generateFromMeals as apiGenerateFromMeals,
  ShoppingApiError,
  type ShoppingListCurrentResponse,
  type ShoppingItem,
  type ShoppingItemAddBody,
} from './shoppingApi';

export interface ShoppingStats {
  total: number;
  bought: number;
  remaining: number;
  /** Sum of estPrice over items where estPrice > 0 and not yet bought. */
  remainingPriceSum: number;
  /** How many items contributed to remainingPriceSum (UI hint when partial). */
  itemsWithPriceCount: number;
}

export interface UseShoppingDataResult {
  list: ShoppingListCurrentResponse | null;
  isLoading: boolean;
  error: Error | null;
  /** Last error produced by a mutation, to surface as a toast. Cleared on next successful op. */
  userFacingError: { message: string; code: string | null } | null;
  /** Indicates whether the active list exists (id != null). */
  hasActiveList: boolean;
  /** Flat list of all items across categories — convenience for the Shopping screen. */
  flatItems: ShoppingItem[];
  stats: ShoppingStats;
  retry: () => void;
  toggleBought: (item: ShoppingItem) => Promise<void>;
  removeItem: (item: ShoppingItem) => Promise<void>;
  addItem: (body: ShoppingItemAddBody) => Promise<ShoppingItem | null>;
  generateFromMeals: () => Promise<void>;
  clearUserFacingError: () => void;
}

export interface UseShoppingDataOverrides {
  fetchShoppingList?: typeof fetchShoppingList;
  markItemBought?: typeof markItemBought;
  markItemUnbought?: typeof markItemUnbought;
  deleteItem?: typeof apiDeleteItem;
  addItem?: typeof apiAddItem;
  generateFromMeals?: typeof apiGenerateFromMeals;
}

function flatten(list: ShoppingListCurrentResponse | null): ShoppingItem[] {
  if (!list) return [];
  if (list.categories && list.categories.length > 0) {
    return list.categories.flatMap((c) => c.items || []);
  }
  return list.items || [];
}

function recomputeStats(items: ShoppingItem[]): ShoppingStats {
  let total = 0;
  let bought = 0;
  let remainingPriceSum = 0;
  let itemsWithPriceCount = 0;
  for (const it of items) {
    total++;
    if (it.checkedOff) bought++;
    if (!it.checkedOff && typeof it.estPrice === 'number' && it.estPrice > 0) {
      remainingPriceSum += it.estPrice;
      itemsWithPriceCount++;
    }
  }
  return {
    total,
    bought,
    remaining: Math.max(0, total - bought),
    remainingPriceSum: Math.round(remainingPriceSum),
    itemsWithPriceCount,
  };
}

function reAssembleCategories(
  prev: ShoppingListCurrentResponse,
  nextItems: ShoppingItem[]
): ShoppingListCurrentResponse {
  // Preserve category order and re-bucket items by category. Items with
  // unknown/null category fall under their own bucket "Annet" so the
  // user always sees them.
  const categoryOrder = (prev.categories || []).map((c) => c.category);
  const byCat = new Map<string, ShoppingItem[]>();
  for (const cat of categoryOrder) byCat.set(cat, []);
  for (const it of nextItems) {
    const cat = it.category || 'Annet';
    if (!byCat.has(cat)) {
      byCat.set(cat, []);
    }
    const arr = byCat.get(cat);
    if (arr) arr.push(it);
  }
  const categories = Array.from(byCat.entries())
    .filter(([, items]) => items.length > 0)
    .map(([category, items]) => ({ category, items }));
  return { ...prev, categories, items: nextItems };
}

function applyItemUpdate(
  list: ShoppingListCurrentResponse,
  itemId: number,
  updater: (it: ShoppingItem) => ShoppingItem
): ShoppingListCurrentResponse {
  const flat = flatten(list).map((it) => (it.id === itemId ? updater(it) : it));
  return reAssembleCategories(list, flat);
}

function removeItemFromList(
  list: ShoppingListCurrentResponse,
  itemId: number
): ShoppingListCurrentResponse {
  const flat = flatten(list).filter((it) => it.id !== itemId);
  return reAssembleCategories(list, flat);
}

function appendItemToList(
  list: ShoppingListCurrentResponse,
  item: ShoppingItem
): ShoppingListCurrentResponse {
  const flat = [...flatten(list), item];
  return reAssembleCategories(list, flat);
}

export function useShoppingData(overrides: UseShoppingDataOverrides = {}): UseShoppingDataResult {
  const fetchListFn = overrides.fetchShoppingList ?? fetchShoppingList;
  const markBoughtFn = overrides.markItemBought ?? markItemBought;
  const markUnboughtFn = overrides.markItemUnbought ?? markItemUnbought;
  const deleteItemFn = overrides.deleteItem ?? apiDeleteItem;
  const addItemFn = overrides.addItem ?? apiAddItem;
  const generateFn = overrides.generateFromMeals ?? apiGenerateFromMeals;

  const [list, setList] = useState<ShoppingListCurrentResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [userFacingError, setUserFacingError] =
    useState<UseShoppingDataResult['userFacingError']>(null);

  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback((): void => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    fetchListFn(ctrl.signal).then(
      (res) => {
        if (ctrl.signal.aborted) return;
        setList(res);
        setIsLoading(false);
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setList(null);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load shopping list'));
      }
    );
  }, [fetchListFn]);

  useEffect(() => {
    load();
    const ctrl = ctrlRef.current;
    return () => {
      ctrl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleBought = useCallback(
    async (item: ShoppingItem): Promise<void> => {
      const wasBought = item.checkedOff;
      // Optimistic flip.
      setList((prev) => {
        if (!prev) return prev;
        return applyItemUpdate(prev, item.id, (it) => ({
          ...it,
          checkedOff: !wasBought,
          boughtAt: !wasBought ? new Date().toISOString() : null,
        }));
      });
      try {
        if (wasBought) {
          await markUnboughtFn(item.id);
        } else {
          await markBoughtFn(item.id);
        }
        setUserFacingError(null);
      } catch (err) {
        // Rollback.
        setList((prev) => {
          if (!prev) return prev;
          return applyItemUpdate(prev, item.id, (it) => ({
            ...it,
            checkedOff: wasBought,
            boughtAt: wasBought ? it.boughtAt : null,
          }));
        });
        const code = err instanceof ShoppingApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke lagre';
        setUserFacingError({ message, code });
      }
    },
    [markBoughtFn, markUnboughtFn]
  );

  const removeItem = useCallback(
    async (item: ShoppingItem): Promise<void> => {
      const snapshot = list;
      // Optimistic removal.
      setList((prev) => (prev ? removeItemFromList(prev, item.id) : prev));
      try {
        await deleteItemFn(item.id);
        setUserFacingError(null);
      } catch (err) {
        // Rollback.
        setList(snapshot);
        const code = err instanceof ShoppingApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke slette';
        setUserFacingError({ message, code });
      }
    },
    [list, deleteItemFn]
  );

  const addItem = useCallback(
    async (body: ShoppingItemAddBody): Promise<ShoppingItem | null> => {
      try {
        const res = await addItemFn(body);
        setList((prev) => (prev ? appendItemToList(prev, res.item) : prev));
        setUserFacingError(null);
        return res.item;
      } catch (err) {
        const code = err instanceof ShoppingApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke legge til';
        setUserFacingError({ message, code });
        return null;
      }
    },
    [addItemFn]
  );

  const generateFromMeals = useCallback(async (): Promise<void> => {
    try {
      await generateFn();
      // Re-fetch the full list after generation.
      load();
      setUserFacingError(null);
    } catch (err) {
      const code = err instanceof ShoppingApiError ? err.code : null;
      const message = err instanceof Error ? err.message : 'Kunne ikke generere handleliste';
      setUserFacingError({ message, code });
    }
  }, [generateFn, load]);

  const clearUserFacingError = useCallback(() => setUserFacingError(null), []);

  const flatItems = useMemo(() => flatten(list), [list]);
  const stats = useMemo(() => recomputeStats(flatItems), [flatItems]);
  const hasActiveList = list?.id != null;

  return {
    list,
    isLoading,
    error,
    userFacingError,
    hasActiveList,
    flatItems,
    stats,
    retry: load,
    toggleBought,
    removeItem,
    addItem,
    generateFromMeals,
    clearUserFacingError,
  };
}
