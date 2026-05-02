// Sprint 6 — useRecipePicker.
//
// Drives the RecipePickerDialog. Two entry points (openForPlan and
// openForSwap) share the same state shape; the only difference is
// the mode flag the dialog uses for its title.
//
// State machine:
//   idle → loading           (open dialog, fetch recipes)
//   loading → ready          (recipes arrived)
//   loading → error          (fetch failed)
//   ready → applying         (user selected a recipe)
//   applying → idle          (swap succeeded; dialog closes)
//   applying → applyError    (swap failed; dialog stays open)
//   ready/error → idle       (user closed dialog)

import { useCallback, useState } from 'react';
import { fetchRecipes, swapMeal, MealsApiError, type RecipeSummary } from './mealsApi';
import type { PickerMode } from '../components/meals/RecipePickerDialog';

export interface RecipePickerState {
  open: boolean;
  mode: PickerMode;
  dayOfWeek: number | null;
  loading: boolean;
  error: string | null;
  recipes: RecipeSummary[];
  applying: boolean;
  applyError: string | null;
  /** When swapping, the current recipe's id so the picker can flag it. */
  currentRecipeId: number | null;
}

const INITIAL_STATE: RecipePickerState = {
  open: false,
  mode: 'plan',
  dayOfWeek: null,
  loading: false,
  error: null,
  recipes: [],
  applying: false,
  applyError: null,
  currentRecipeId: null,
};

export interface UseRecipePickerResult {
  state: RecipePickerState;
  openForPlan: (dayOfWeek: number) => Promise<void>;
  openForSwap: (dayOfWeek: number, currentRecipeId: number) => Promise<void>;
  select: (recipeId: number) => Promise<void>;
  close: () => void;
}

/**
 * @param weekYear        — current ISO weekYear from /api/meals/current
 * @param onAfterSwap     — fires after a successful swap so the parent
 *                          can refetch /api/meals/current
 */
export function useRecipePicker(
  weekYear: string | null,
  onAfterSwap?: () => void
): UseRecipePickerResult {
  const [state, setState] = useState<RecipePickerState>(INITIAL_STATE);

  async function loadRecipes(): Promise<void> {
    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      recipes: [],
    }));
    try {
      const res = await fetchRecipes();
      setState((prev) => ({
        ...prev,
        loading: false,
        recipes: Array.isArray(res.recipes) ? res.recipes : [],
      }));
    } catch (err) {
      const message = err instanceof MealsApiError ? err.message : 'Network error';
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }

  const openForPlan = useCallback(async (dayOfWeek: number): Promise<void> => {
    setState({
      ...INITIAL_STATE,
      open: true,
      mode: 'plan',
      dayOfWeek,
      loading: true,
    });
    await loadRecipes();
  }, []);

  const openForSwap = useCallback(
    async (dayOfWeek: number, currentRecipeId: number): Promise<void> => {
      setState({
        ...INITIAL_STATE,
        open: true,
        mode: 'swap',
        dayOfWeek,
        currentRecipeId,
        loading: true,
      });
      await loadRecipes();
    },
    []
  );

  const select = useCallback(
    async (recipeId: number): Promise<void> => {
      const day = state.dayOfWeek;
      if (weekYear === null || day === null) return;
      setState((prev) => ({ ...prev, applying: true, applyError: null }));
      try {
        await swapMeal(weekYear, day, recipeId);
        // Close dialog + reset state. Parent's onAfterSwap refetches
        // meals so the hero re-renders with the new recipe.
        setState(INITIAL_STATE);
        onAfterSwap?.();
      } catch (err) {
        const message = err instanceof MealsApiError ? err.message : 'Network error';
        setState((prev) => ({
          ...prev,
          applying: false,
          applyError: message,
        }));
      }
    },
    [state.dayOfWeek, weekYear, onAfterSwap]
  );

  const close = useCallback((): void => {
    setState(INITIAL_STATE);
  }, []);

  return { state, openForPlan, openForSwap, select, close };
}
