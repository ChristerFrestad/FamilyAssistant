// Hook that orchestrates the Meals screen's data fetching.
//
// Two parallel fetches on mount / when weekYear changes:
//   - GET /api/meals/week/:weekYear (or /current when unset) — week plan
//   - GET /api/family         — only portionSum is consumed; we fall
//                                back to 1.0 if the family fetch fails
//                                so the meals screen stays usable
//                                even when the family endpoint is
//                                degraded.
//
// Selected-day state lives here so DayStrip and MealHero can stay
// trivially testable as pure components. Default selection is "today"
// (computed from Date.now()), clamped to 0..6 with mandag=0 mapping.
// When viewing a non-current week, todayIndex is -1 so no day is marked
// as "today".

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMealsCurrent,
  fetchMealsWeek,
  type MealsCurrentResponse,
  type MealSlot,
} from './mealsApi';
import { fetchFamily, type FamilyResponse } from '../family/familyApi';
import { getIsoWeekYear } from '../hooks/isoWeek';

export type FamilyFetchState =
  | { status: 'loading' }
  | { status: 'ok'; portionSum: number }
  | { status: 'failed' };

export interface UseMealsDataResult {
  meals: MealsCurrentResponse | null;
  /** True until the meal-plan fetch settles. Family fetch can lag without blocking. */
  isLoading: boolean;
  /** Set when the meal-plan fetch fails. Family failures don't surface as errors. */
  error: Error | null;
  family: FamilyFetchState;
  /** Currently selected day (0..6). Defaults to today, clamped to range. */
  selectedDayIndex: number;
  /** Index of "today" in the meals[] array (0..6), or -1 when viewing another week. */
  todayIndex: number;
  /** Manually pick a day. */
  selectDay: (index: number) => void;
  /** Re-fetch both endpoints. */
  retry: () => void;
}

export interface UseMealsDataOverrides {
  fetchMealsCurrent?: typeof fetchMealsCurrent;
  fetchMealsWeek?: typeof fetchMealsWeek;
  fetchFamily?: typeof fetchFamily;
  /** Test override for "today" — defaults to new Date() at call time. */
  now?: Date;
  /** ISO week to load (YYYY-WNN). Defaults to current week via /api/meals/current. */
  weekYear?: string;
}

/**
 * ISO weekday with Monday=0..Sunday=6 (matches backend dayOfWeek).
 * JS Date.getDay() returns Sunday=0..Saturday=6, so we shift.
 */
export function isoWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function useMealsData(overrides: UseMealsDataOverrides = {}): UseMealsDataResult {
  const fetchMealsCurrentFn = overrides.fetchMealsCurrent ?? fetchMealsCurrent;
  const fetchMealsWeekFn = overrides.fetchMealsWeek ?? fetchMealsWeek;
  const fetchFamilyFn = overrides.fetchFamily ?? fetchFamily;
  const fixedNow = overrides.now;
  const weekYear = overrides.weekYear;

  const [meals, setMeals] = useState<MealsCurrentResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [family, setFamily] = useState<FamilyFetchState>({ status: 'loading' });

  const today = fixedNow ?? new Date();
  const currentWeekYear = getIsoWeekYear(today);
  const viewingCurrentWeek = !weekYear || weekYear === currentWeekYear;
  const todayIndex = viewingCurrentWeek ? isoWeekday(today) : -1;
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(
    viewingCurrentWeek ? isoWeekday(today) : 0
  );

  const mealsCtrlRef = useRef<AbortController | null>(null);
  const familyCtrlRef = useRef<AbortController | null>(null);

  const load = useCallback((): void => {
    mealsCtrlRef.current?.abort();
    familyCtrlRef.current?.abort();
    const mealsCtrl = new AbortController();
    const familyCtrl = new AbortController();
    mealsCtrlRef.current = mealsCtrl;
    familyCtrlRef.current = familyCtrl;

    setIsLoading(true);
    setError(null);
    setFamily({ status: 'loading' });

    const mealsPromise = weekYear
      ? fetchMealsWeekFn(weekYear, mealsCtrl.signal)
      : fetchMealsCurrentFn(mealsCtrl.signal);

    mealsPromise.then(
      (res) => {
        if (mealsCtrl.signal.aborted) return;
        setMeals(res);
        setIsLoading(false);
      },
      (err) => {
        if (mealsCtrl.signal.aborted) return;
        setMeals(null);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load meals'));
      }
    );

    fetchFamilyFn(familyCtrl.signal).then(
      (res: FamilyResponse) => {
        if (familyCtrl.signal.aborted) return;
        const sum = Number(res.portionSum);
        if (Number.isFinite(sum) && sum > 0) {
          setFamily({ status: 'ok', portionSum: sum });
        } else {
          setFamily({ status: 'failed' });
        }
      },
      (err: unknown) => {
        if (familyCtrl.signal.aborted) return;
        setFamily({ status: 'failed' });
        void err;
      }
    );
  }, [fetchMealsCurrentFn, fetchMealsWeekFn, fetchFamilyFn, weekYear]);

  useEffect(() => {
    load();
    const mealsCtrl = mealsCtrlRef.current;
    const familyCtrl = familyCtrlRef.current;
    return () => {
      mealsCtrl?.abort();
      familyCtrl?.abort();
    };
    // Re-fetch when selected week changes. Omit `load` — tests pass
    // fresh vi.fn() overrides each render (same as original mount-only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekYear]);

  // When switching weeks, reset day selection: today if current week, else Monday.
  useEffect(() => {
    setSelectedDayIndex(viewingCurrentWeek ? isoWeekday(today) : 0);
    // intentionally only when weekYear identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekYear, viewingCurrentWeek]);

  const selectDay = useCallback((index: number): void => {
    if (!Number.isInteger(index) || index < 0 || index > 6) return;
    setSelectedDayIndex(index);
  }, []);

  return {
    meals,
    isLoading,
    error,
    family,
    selectedDayIndex,
    todayIndex,
    selectDay,
    retry: load,
  };
}

// ============================================================
// Pure helpers — exported so the screen + components can use them
// directly and stay free of UI-coupled knowledge.
// ============================================================

/**
 * Returns the meal slot for the given dayOfWeek, or null if either
 * the meals payload is missing or no slot matches. Defensive against
 * out-of-range indices.
 */
export function selectSlot(meals: MealsCurrentResponse | null, dayOfWeek: number): MealSlot | null {
  if (!meals) return null;
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null;
  return meals.meals.find((s) => s.dayOfWeek === dayOfWeek) ?? null;
}

/**
 * Returns the effective scale factor for ingredient display.
 *   - If recipe.servings is missing/invalid: returns null (caller
 *     shows un-scaled ingredients with an info badge).
 *   - If family fetch failed: returns 1.0 (un-scaled, but no badge —
 *     the missing-data hint surfaces elsewhere).
 *   - Otherwise: portionSum / servings, clamped to >= 0.
 */
export function computeScale(
  recipe: { servings: number | null },
  family: FamilyFetchState
): number | null {
  const servings = Number(recipe.servings);
  if (!Number.isFinite(servings) || servings <= 0) return null;
  if (family.status !== 'ok') return 1;
  if (family.portionSum <= 0) return 1;
  return family.portionSum / servings;
}
