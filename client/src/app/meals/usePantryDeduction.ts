// Sprint 6 — usePantryDeduction.
//
// Wraps the three meal-cooked endpoints into a small state machine so
// the Meals screen can drive the dialog without owning fetch
// orchestration directly.
//
// State transitions:
//   idle → loading       (open dialog, fetch suggestions)
//   loading → ready      (suggestions arrived)
//   loading → error      (fetch failed)
//   ready → applying     (user pressed Confirm)
//   applying → applied   (apply-deduction returned ok)
//   applying → applyError(apply-deduction failed)
//   ready/applied → idle (user closed dialog)
//
// We do NOT optimistically mutate the parent's pantry view here —
// that's the parent's job after `applied` (it can refetch
// /api/pantry on next render). The dialog itself only needs the local
// state captured in MarkCookedDialogState.

import { useCallback, useRef, useState } from 'react';
import {
  applyMealDeduction,
  markMealEaten,
  unmarkMealEaten,
  MealsApiError,
  type ApplyDeductionResponse,
  type DeductionItem,
} from './mealsApi';
import type { MarkCookedDialogState } from '../components/meals/MarkCookedDialog';

const INITIAL_STATE: MarkCookedDialogState = {
  open: false,
  loading: false,
  error: null,
  applying: false,
  applyError: null,
  mealId: null,
  suggestions: [],
  resultMessage: null,
  lowStockCount: 0,
  alreadyCooked: false,
};

export interface UsePantryDeductionResult {
  state: MarkCookedDialogState;
  /** Open the dialog for the given meal id. Triggers mark-eaten + fetch. */
  open: (mealId: number) => Promise<void>;
  /** Apply the user-confirmed deductions. */
  confirm: (items: DeductionItem[]) => Promise<ApplyDeductionResponse | null>;
  /** Close without applying — meal stays cooked. */
  skip: () => void;
  /** Cancel the cook entirely (rolls status back to planned). */
  cancel: () => Promise<void>;
  /**
   * Backdrop, Escape, and X. Undoes the cooked mark until the person
   * confirms a deduction or explicitly skips it. After that, close
   * only hides the dialog.
   */
  close: () => void;
}

export function usePantryDeduction(onAfterMutate?: () => void): UsePantryDeductionResult {
  const [state, setState] = useState<MarkCookedDialogState>(INITIAL_STATE);
  const openGen = useRef(0);
  const onAfterRef = useRef(onAfterMutate);
  onAfterRef.current = onAfterMutate;

  const open = useCallback(async (mealId: number): Promise<void> => {
    const gen = ++openGen.current;
    setState({
      ...INITIAL_STATE,
      open: true,
      loading: true,
      mealId,
    });
    try {
      const res = await markMealEaten(mealId);
      if (gen !== openGen.current) {
        // Dismissed while mark-eaten was in flight. Undo only the cook
        // this request just created.
        if (!res.alreadyCooked) {
          try {
            await unmarkMealEaten(mealId);
          } catch {
            // The parent refetches. Closing must not hang.
          }
          onAfterRef.current?.();
        }
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        suggestions: res.suggestions,
        alreadyCooked: res.alreadyCooked,
      }));
    } catch (err) {
      if (gen !== openGen.current) return;
      const message = err instanceof MealsApiError ? err.message : 'Network error';
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }, []);

  const confirm = useCallback(
    async (items: DeductionItem[]): Promise<ApplyDeductionResponse | null> => {
      const mealId = state.mealId;
      if (mealId == null) return null;
      setState((prev) => ({ ...prev, applying: true, applyError: null }));
      try {
        const res = await applyMealDeduction(mealId, items);
        const lowStockCount = Array.isArray(res.lowStockTriggered)
          ? res.lowStockTriggered.length
          : 0;
        setState((prev) => ({
          ...prev,
          applying: false,
          applyError: null,
          resultMessage: 'applied',
          lowStockCount,
        }));
        onAfterMutate?.();
        return res;
      } catch (err) {
        const message = err instanceof MealsApiError ? err.message : 'Network error';
        setState((prev) => ({
          ...prev,
          applying: false,
          applyError: message,
        }));
        return null;
      }
    },
    [state.mealId, onAfterMutate]
  );

  const skip = useCallback((): void => {
    // Meal stays cooked; pantry untouched. We just close the dialog.
    setState(INITIAL_STATE);
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    if (state.loading) {
      openGen.current += 1;
      setState(INITIAL_STATE);
      return;
    }
    const mealId = state.mealId;
    if (mealId == null || state.alreadyCooked || state.resultMessage !== null) {
      setState(INITIAL_STATE);
      return;
    }
    try {
      await unmarkMealEaten(mealId);
    } catch {
      // Silent — the parent will refetch and re-derive truth from
      // server. The cancel button must always close the dialog so
      // the user is not trapped behind a network failure.
    }
    setState(INITIAL_STATE);
    onAfterMutate?.();
  }, [onAfterMutate, state.alreadyCooked, state.loading, state.mealId, state.resultMessage]);

  const close = useCallback((): void => {
    if (state.loading) {
      openGen.current += 1;
      setState(INITIAL_STATE);
      return;
    }
    const mealId = state.mealId;
    const settled = state.resultMessage !== null;
    if (mealId == null || settled || state.alreadyCooked) {
      setState(INITIAL_STATE);
      return;
    }
    void (async () => {
      try {
        await unmarkMealEaten(mealId);
      } catch {
        // Same as cancel: dismissing must not trap the dialog.
      }
      setState(INITIAL_STATE);
      onAfterMutate?.();
    })();
  }, [onAfterMutate, state.alreadyCooked, state.loading, state.mealId, state.resultMessage]);

  return { state, open, confirm, skip, cancel, close };
}
