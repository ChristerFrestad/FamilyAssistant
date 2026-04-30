// Tests for useMealsData.ts. Covers the orchestration layer +
// the pure helpers. Component-level integration is in the screen
// and component tests; here we only assert the hook's contract.

import { renderHook, waitFor, act } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import {
  useMealsData,
  isoWeekday,
  selectSlot,
  computeScale,
  type FamilyFetchState,
} from './useMealsData';
import type { MealsCurrentResponse } from './mealsApi';
import type { FamilyResponse } from '../family/familyApi';

const SAMPLE_MEALS: MealsCurrentResponse = {
  weekYear: '2026-W18',
  meals: Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    dayName: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][i] ?? '',
    recipeId: i === 2 ? null : i + 1,
    status: 'planned' as const,
    notes: null,
    recipe:
      i === 2
        ? null
        : {
            id: i + 1,
            name: `Recipe ${i + 1}`,
            category: 'rask' as const,
            prepTime: '25 min',
            servings: 2,
            source: null,
            url: null,
            notes: null,
            ingredients: [],
          },
  })),
};

const SAMPLE_FAMILY: FamilyResponse = {
  family: {
    id: 1,
    name: 'Familie Frestad',
    ownerUserId: 1,
    createdAt: '2026-04-01 12:00:00',
    updatedAt: '2026-04-01 12:00:00',
  },
  profileMembers: [],
  users: [],
  portionSum: 3,
};

describe('isoWeekday', () => {
  test('maps søndag (JS day 0) to 6', () => {
    expect(isoWeekday(new Date(2026, 3, 26))).toBe(6); // Sunday 26 April 2026
  });
  test('maps mandag to 0', () => {
    expect(isoWeekday(new Date(2026, 3, 27))).toBe(0); // Monday 27 April 2026
  });
  test('maps lørdag to 5', () => {
    expect(isoWeekday(new Date(2026, 3, 25))).toBe(5);
  });
});

describe('selectSlot', () => {
  test('returns matching slot', () => {
    const slot = selectSlot(SAMPLE_MEALS, 3);
    expect(slot?.dayOfWeek).toBe(3);
    expect(slot?.recipe?.name).toBe('Recipe 4');
  });
  test('returns null for null payload', () => {
    expect(selectSlot(null, 3)).toBeNull();
  });
  test('returns null for out-of-range index', () => {
    expect(selectSlot(SAMPLE_MEALS, -1)).toBeNull();
    expect(selectSlot(SAMPLE_MEALS, 7)).toBeNull();
    expect(selectSlot(SAMPLE_MEALS, 1.5)).toBeNull();
  });
});

describe('computeScale', () => {
  const familyOk: FamilyFetchState = { status: 'ok', portionSum: 3 };
  const familyFailed: FamilyFetchState = { status: 'failed' };
  const familyLoading: FamilyFetchState = { status: 'loading' };

  test('returns portionSum / servings when both are valid', () => {
    expect(computeScale({ servings: 2 }, familyOk)).toBe(1.5);
  });
  test('returns null when servings is null', () => {
    expect(computeScale({ servings: null }, familyOk)).toBeNull();
  });
  test('returns null when servings is 0', () => {
    expect(computeScale({ servings: 0 }, familyOk)).toBeNull();
  });
  test('returns 1 when family failed (un-scaled fallback)', () => {
    expect(computeScale({ servings: 2 }, familyFailed)).toBe(1);
  });
  test('returns 1 when family is still loading', () => {
    expect(computeScale({ servings: 2 }, familyLoading)).toBe(1);
  });
  test('returns 1 when portionSum is 0', () => {
    expect(computeScale({ servings: 2 }, { status: 'ok', portionSum: 0 })).toBe(1);
  });
});

describe('useMealsData hook', () => {
  test('starts in loading state and resolves to data', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockResolvedValue(SAMPLE_FAMILY);
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 28) })
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.meals?.weekYear).toBe('2026-W18');
    expect(result.current.error).toBeNull();
  });

  test('selectedDayIndex defaults to today', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockResolvedValue(SAMPLE_FAMILY);
    // Tuesday 28 April 2026 → ISO weekday 1
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 28) })
    );
    expect(result.current.selectedDayIndex).toBe(1);
    expect(result.current.todayIndex).toBe(1);
  });

  test('selectDay updates state and clamps invalid input', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockResolvedValue(SAMPLE_FAMILY);
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 27) })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.selectDay(4));
    expect(result.current.selectedDayIndex).toBe(4);

    act(() => result.current.selectDay(-1));
    expect(result.current.selectedDayIndex).toBe(4); // unchanged
    act(() => result.current.selectDay(7));
    expect(result.current.selectedDayIndex).toBe(4);
    act(() => result.current.selectDay(2.5));
    expect(result.current.selectedDayIndex).toBe(4);
  });

  test('error state when meals fetch fails', async () => {
    const fetchMealsCurrent = vi.fn().mockRejectedValue(new Error('boom'));
    const fetchFamily = vi.fn().mockResolvedValue(SAMPLE_FAMILY);
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 27) })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.meals).toBeNull();
  });

  test('family fetch failure does not block the screen', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockRejectedValue(new Error('family-down'));
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 27) })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.family.status).toBe('failed'));
    expect(result.current.meals?.weekYear).toBe('2026-W18');
    expect(result.current.error).toBeNull();
  });

  test('family ok with positive portionSum', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockResolvedValue({ ...SAMPLE_FAMILY, portionSum: 2.5 });
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 27) })
    );
    await waitFor(() => expect(result.current.family.status).toBe('ok'));
    if (result.current.family.status === 'ok') {
      expect(result.current.family.portionSum).toBe(2.5);
    }
  });

  test('family with non-positive portionSum is treated as failed', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockResolvedValue({ ...SAMPLE_FAMILY, portionSum: 0 });
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 27) })
    );
    await waitFor(() => expect(result.current.family.status).toBe('failed'));
  });

  test('retry re-runs both fetches', async () => {
    const fetchMealsCurrent = vi.fn().mockResolvedValue(SAMPLE_MEALS);
    const fetchFamily = vi.fn().mockResolvedValue(SAMPLE_FAMILY);
    const { result } = renderHook(() =>
      useMealsData({ fetchMealsCurrent, fetchFamily, now: new Date(2026, 3, 27) })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMealsCurrent).toHaveBeenCalledTimes(1);
    expect(fetchFamily).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMealsCurrent).toHaveBeenCalledTimes(2);
    expect(fetchFamily).toHaveBeenCalledTimes(2);
  });
});
