// Orchestrates the Pantry sub-view's data + mutation flows.
//
// Mirrors useShoppingData's shape: one initial fetch on mount, optimistic
// mutations with rollback on failure, userFacingError surface for toasts.
// Three mutations:
//   - markUsed(item, amountUsed)     — decrements quantity by amountUsed
//   - removeItem(productKey)         — DELETE; "har ikke likevel"
//   - addItem({ name, qty, unit })   — POST; resolves productKey server-side
//
// markUsed maps the user-facing "I used X units" intent to the backend's
// absolute newQty contract. When newQty reaches 0 the optimistic update
// removes the row from the list (backend GET /api/pantry filters out
// qty=0 rows, so refetching would show the same end-state).
//
// addItem cannot be fully optimistic because the backend allocates the
// productKey via slugify/resolver and returns shape we don't have until
// the response arrives. We refetch instead — simpler than synthesizing
// a placeholder row that has to be reconciled.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPantry,
  markAmountUsed,
  deletePantryItem,
  addPantryItem,
  PantryApiError,
  type PantryItem,
  type PantryListResponse,
  type PantryAddBody,
} from './pantryApi';

export interface PantryStats {
  total: number;
  /** Items with isLow=true (ratio < 0.20). */
  lowCount: number;
  /** Items with expiresEst within 7 days from today (inclusive). */
  expiringSoonCount: number;
}

export interface UsePantryDataResult {
  items: PantryItem[];
  isLoading: boolean;
  error: Error | null;
  /** Last error produced by a mutation, surface as toast. Cleared on next successful op. */
  userFacingError: { message: string; code: string | null } | null;
  stats: PantryStats;
  /** Items grouped by category for rendering. Empty/null categories collapse to 'other'. */
  itemsByCategory: Array<{ category: string; items: PantryItem[] }>;
  retry: () => void;
  markUsed: (item: PantryItem, amountUsed: number) => Promise<void>;
  removeItem: (productKey: string) => Promise<void>;
  addItem: (body: PantryAddBody) => Promise<PantryItem | null>;
  clearUserFacingError: () => void;
}

export interface UsePantryDataOverrides {
  fetchPantry?: typeof fetchPantry;
  markAmountUsed?: typeof markAmountUsed;
  deletePantryItem?: typeof deletePantryItem;
  addPantryItem?: typeof addPantryItem;
}

const DAY_MS = 86_400_000;
// Mirrors server/services/units.js LOW_THRESHOLD (0.15). Used to keep
// optimistic isLow flag in sync after markUsed before refetch arrives.
const LOW_THRESHOLD = 0.15;

function recomputeStats(items: PantryItem[]): PantryStats {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nowMs = today.getTime();
  let lowCount = 0;
  let expiringSoonCount = 0;
  for (const it of items) {
    if (it.isLow) lowCount++;
    if (it.expiresEst) {
      const exp = Date.parse(it.expiresEst);
      if (Number.isFinite(exp)) {
        const diffDays = Math.round((exp - nowMs) / DAY_MS);
        if (diffDays <= 7) expiringSoonCount++;
      }
    }
  }
  return { total: items.length, lowCount, expiringSoonCount };
}

function groupByCategory(items: PantryItem[]): Array<{ category: string; items: PantryItem[] }> {
  const buckets = new Map<string, PantryItem[]>();
  for (const it of items) {
    const cat = it.category || 'other';
    const arr = buckets.get(cat);
    if (arr) {
      arr.push(it);
    } else {
      buckets.set(cat, [it]);
    }
  }
  return Array.from(buckets.entries()).map(([category, list]) => ({ category, items: list }));
}

function applyItemUpdate(
  items: PantryItem[],
  productKey: string,
  updater: (it: PantryItem) => PantryItem
): PantryItem[] {
  return items.map((it) => (it.productKey === productKey ? updater(it) : it));
}

function removeFromList(items: PantryItem[], productKey: string): PantryItem[] {
  return items.filter((it) => it.productKey !== productKey);
}

export function usePantryData(overrides: UsePantryDataOverrides = {}): UsePantryDataResult {
  const fetchFn = overrides.fetchPantry ?? fetchPantry;
  const markUsedFn = overrides.markAmountUsed ?? markAmountUsed;
  const deleteFn = overrides.deletePantryItem ?? deletePantryItem;
  const addFn = overrides.addPantryItem ?? addPantryItem;

  const [items, setItems] = useState<PantryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [userFacingError, setUserFacingError] =
    useState<UsePantryDataResult['userFacingError']>(null);

  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback((): void => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setIsLoading(true);
    setError(null);
    fetchFn(ctrl.signal).then(
      (res: PantryListResponse) => {
        if (ctrl.signal.aborted) return;
        setItems(res.items || []);
        setIsLoading(false);
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setItems([]);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load pantry'));
      }
    );
  }, [fetchFn]);

  useEffect(() => {
    load();
    const ctrl = ctrlRef.current;
    return () => {
      ctrl?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markUsed = useCallback(
    async (item: PantryItem, amountUsed: number): Promise<void> => {
      const newQty = Math.max(0, item.quantity - amountUsed);
      const snapshot = items;
      // Optimistic: update remaining + ratio + isLow, or remove row at qty=0.
      setItems((prev) => {
        if (newQty <= 0) {
          return removeFromList(prev, item.productKey);
        }
        return applyItemUpdate(prev, item.productKey, (it) => {
          const ratio = it.total ? newQty / it.total : it.ratio;
          const update: PantryItem = {
            ...it,
            quantity: newQty,
            ratio,
            isLow: ratio !== null ? ratio < LOW_THRESHOLD : it.isLow,
          };
          return update;
        });
      });
      try {
        await markUsedFn(item.productKey, newQty);
        setUserFacingError(null);
      } catch (err) {
        setItems(snapshot);
        const code = err instanceof PantryApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke lagre';
        setUserFacingError({ message, code });
      }
    },
    [items, markUsedFn]
  );

  const removeItem = useCallback(
    async (productKey: string): Promise<void> => {
      const snapshot = items;
      setItems((prev) => removeFromList(prev, productKey));
      try {
        await deleteFn(productKey);
        setUserFacingError(null);
      } catch (err) {
        setItems(snapshot);
        const code = err instanceof PantryApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke slette';
        setUserFacingError({ message, code });
      }
    },
    [items, deleteFn]
  );

  const addItem = useCallback(
    async (body: PantryAddBody): Promise<PantryItem | null> => {
      try {
        const res = await addFn(body);
        // Backend response only carries the upsert summary, not the full
        // PantryItem shape we render. Refetch to hydrate display fields
        // (name, ratio, isLow, learned shelf-life). This is a single
        // additional GET right after the user adds — acceptable cost.
        load();
        setUserFacingError(null);
        // Synthesize a minimal PantryItem for callers that need an immediate
        // identifier (e.g. focus-management). The next render after refetch
        // replaces it with the full row.
        return {
          productKey: res.item.productKey,
          ingredientName: res.item.productKey,
          ingredientNameNo: res.item.productKey,
          name: res.item.productKey,
          quantity: res.item.qtyRemaining,
          total: res.item.totalSize,
          ratio: null,
          isLow: false,
          unit: res.item.unit,
          category: null,
          expiresEst: res.item.expiresEst,
          lastPurchased: null,
          shelfDaysLearned: null,
          shelfDaysSampleCount: 0,
          shelfDaysSeed: null,
        };
      } catch (err) {
        const code = err instanceof PantryApiError ? err.code : null;
        const message = err instanceof Error ? err.message : 'Kunne ikke legge til';
        setUserFacingError({ message, code });
        return null;
      }
    },
    [addFn, load]
  );

  const clearUserFacingError = useCallback(() => setUserFacingError(null), []);

  const stats = useMemo(() => recomputeStats(items), [items]);
  const itemsByCategory = useMemo(() => groupByCategory(items), [items]);

  return {
    items,
    isLoading,
    error,
    userFacingError,
    stats,
    itemsByCategory,
    retry: load,
    markUsed,
    removeItem,
    addItem,
    clearUserFacingError,
  };
}
