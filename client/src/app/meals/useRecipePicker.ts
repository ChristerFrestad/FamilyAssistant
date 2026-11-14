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

import { useCallback, useRef, useState } from 'react';
import {
  fetchMealSuggestions,
  fetchRecipes,
  planLibraryRecipe,
  swapMeal,
  MealsApiError,
  type RecipeSummary,
  type SwapMealResponse,
} from './mealsApi';
import type { PickerMode } from '../components/meals/RecipePickerDialog';

export interface LibraryPickerItem {
  libraryId: number;
  name: string;
  sourceName: string;
  reason?: string;
}

export interface RecipePickerState {
  open: boolean;
  mode: PickerMode;
  dayOfWeek: number | null;
  loading: boolean;
  error: string | null;
  recipes: RecipeSummary[];
  librarySuggestions: LibraryPickerItem[];
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
  librarySuggestions: [],
  applying: false,
  applyError: null,
  currentRecipeId: null,
};

export interface UseRecipePickerResult {
  state: RecipePickerState;
  openForPlan: (dayOfWeek: number) => Promise<void>;
  openForSwap: (dayOfWeek: number, currentRecipeId: number) => Promise<void>;
  select: (recipeId: number) => Promise<void>;
  selectLibrary: (libraryId: number) => Promise<void>;
  close: () => void;
}

/**
 * @param weekYear        — ISO week the screen is showing (URL), never
 *                          read from a render that has not loaded meals
 * @param onAfterSwap     — fires after a successful swap with the
 *                          server week, so the parent can paint it
 *                          without a follow-up GET
 */
export function useRecipePicker(
  weekYear: string | null,
  onAfterSwap?: (result: SwapMealResponse) => void
): UseRecipePickerResult {
  const [state, setState] = useState<RecipePickerState>(INITIAL_STATE);
  // Written synchronously when the dialog opens, so the first select
  // does not no-op on a stale render where dayOfWeek was still null.
  const dayRef = useRef<number | null>(null);
  const weekRef = useRef<string | null>(weekYear);
  weekRef.current = weekYear;

  async function loadRecipes(): Promise<void> {
    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      recipes: [],
      librarySuggestions: [],
    }));
    try {
      const res = await fetchRecipes();
      const day = dayRef.current;
      const family = Array.isArray(res.recipes) ? res.recipes : [];
      let librarySuggestions: LibraryPickerItem[] = [];
      let ordered = family;
      if (day !== null) {
        try {
          const suggestions = await fetchMealSuggestions(day, weekRef.current);
          const ranked = suggestions.suggestions || [];
          const byId = new Map(family.map((recipe) => [recipe.id, recipe]));
          const seen = new Set<number>();
          const first: RecipeSummary[] = [];
          for (const item of ranked) {
            if (item.fromLibrary || item.recipeId == null) continue;
            const recipe = byId.get(item.recipeId);
            if (!recipe || seen.has(recipe.id)) continue;
            seen.add(recipe.id);
            const row: RecipeSummary = { ...recipe };
            if ((item.expiringUsed || 0) > 0) row.reason = 'expiring';
            else if ((item.ingredientsAtHome || 0) > 0) {
              row.reason = `using:${item.ingredientsAtHome}`;
            } else row.reason = 'new';
            first.push(row);
          }
          ordered = [...first, ...family.filter((recipe) => !seen.has(recipe.id))];
          librarySuggestions = ranked
            .filter((item) => item.fromLibrary === true && typeof item.libraryId === 'number')
            .map((item) => {
              const row: LibraryPickerItem = {
                libraryId: item.libraryId as number,
                name: item.name,
                sourceName: item.sourceName || '',
              };
              if ((item.expiringUsed || 0) > 0) row.reason = 'expiring';
              else if ((item.ingredientsAtHome || 0) > 0) {
                row.reason = `using:${item.ingredientsAtHome}`;
              } else row.reason = 'new';
              return row;
            });
        } catch {
          librarySuggestions = [];
        }
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        recipes: ordered,
        librarySuggestions,
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
    dayRef.current = dayOfWeek;
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
      dayRef.current = dayOfWeek;
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
      const day = dayRef.current;
      const week = weekRef.current;
      if (week === null || day === null) return;
      setState((prev) => ({ ...prev, applying: true, applyError: null }));
      try {
        const result = await swapMeal(week, day, recipeId);
        // Close dialog + reset state. Parent paints `result.week`
        // directly so a stale meals GET cannot hide the first swap.
        dayRef.current = null;
        setState(INITIAL_STATE);
        onAfterSwap?.(result);
      } catch (err) {
        const message = err instanceof MealsApiError ? err.message : 'Network error';
        setState((prev) => ({
          ...prev,
          applying: false,
          applyError: message,
        }));
      }
    },
    [onAfterSwap]
  );

  const selectLibrary = useCallback(
    async (libraryId: number): Promise<void> => {
      const day = dayRef.current;
      const week = weekRef.current;
      if (week === null || day === null) return;
      setState((prev) => ({ ...prev, applying: true, applyError: null }));
      try {
        const result = await planLibraryRecipe(libraryId, week, day);
        dayRef.current = null;
        setState(INITIAL_STATE);
        onAfterSwap?.(result);
      } catch (err) {
        const message = err instanceof MealsApiError ? err.message : 'Network error';
        setState((prev) => ({
          ...prev,
          applying: false,
          applyError: message,
        }));
      }
    },
    [onAfterSwap]
  );

  const close = useCallback((): void => {
    dayRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, openForPlan, openForSwap, select, selectLibrary, close };
}
