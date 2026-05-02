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

import { useCallback, useState } from 'react';
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
  /** Close without firing any further request (used by the X / backdrop). */
  close: () => void;
}

export function usePantryDeduction(onAfterMutate?: () => void): UsePantryDeductionResult {
  const [state, setState] = useState<MarkCookedDialogState>(INITIAL_STATE);

  const open = useCallback(async (mealId: number): Promise<void> => {
    setState((prev) => ({
      ...prev,
      open: true,
      loading: true,
      error: null,
      applying: false,
      applyError: null,
      mealId,
      suggestions: [],
      resultMessage: null,
      lowStockCount: 0,
    }));
    try {
      const res = await markMealEaten(mealId);
      setState((prev) => ({
        ...prev,
        loading: false,
        suggestions: res.suggestions,
      }));
    } catch (err) {
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
    const mealId = state.mealId;
    if (mealId == null) {
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
  }, [state.mealId, onAfterMutate]);

  const close = useCallback((): void => {
    setState(INITIAL_STATE);
  }, []);

  return { state, open, confirm, skip, cancel, close };
}
