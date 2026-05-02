// Tests for the usePantryDeduction hook. We mock the three API
// helpers and verify that the hook drives the dialog state machine
// correctly through the open → confirm / skip / cancel paths.

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  markMealEaten: vi.fn(),
  applyMealDeduction: vi.fn(),
  unmarkMealEaten: vi.fn(),
}));

vi.mock('./mealsApi', async () => {
  const actual = await vi.importActual<typeof import('./mealsApi')>('./mealsApi');
  return {
    ...actual,
    markMealEaten: mocks.markMealEaten,
    applyMealDeduction: mocks.applyMealDeduction,
    unmarkMealEaten: mocks.unmarkMealEaten,
  };
});

import { usePantryDeduction } from './usePantryDeduction';

describe('usePantryDeduction', () => {
  beforeEach(() => {
    mocks.markMealEaten.mockReset();
    mocks.applyMealDeduction.mockReset();
    mocks.unmarkMealEaten.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('open() fetches suggestions and stores them in state', async () => {
    mocks.markMealEaten.mockResolvedValue({
      mealId: 7,
      recipeId: 11,
      alreadyCooked: false,
      suggestions: [
        {
          productKey: 'flour',
          name: 'Flour',
          recipeAmount: 200,
          portionFactor: 1,
          suggestedDeduction: 200,
          pantryRemaining: 500,
          pantryUnit: 'g',
          matched: true,
          optional: false,
        },
      ],
    });

    const { result } = renderHook(() => usePantryDeduction());

    await act(async () => {
      await result.current.open(7);
    });

    expect(result.current.state.open).toBe(true);
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.mealId).toBe(7);
    expect(result.current.state.suggestions).toHaveLength(1);
  });

  test('open() surfaces error when markMealEaten fails', async () => {
    mocks.markMealEaten.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePantryDeduction());

    await act(async () => {
      await result.current.open(7);
    });

    expect(result.current.state.error).toBeTruthy();
    expect(result.current.state.loading).toBe(false);
  });

  test('confirm() applies deduction and stores result message + lowStock count', async () => {
    mocks.markMealEaten.mockResolvedValue({
      mealId: 7,
      recipeId: 11,
      alreadyCooked: false,
      suggestions: [],
    });
    mocks.applyMealDeduction.mockResolvedValue({
      ok: true,
      mealId: 7,
      applied: [{ productKey: 'flour', prevQty: 500, newQty: 300, delta: -200 }],
      skipped: [],
      lowStockTriggered: ['flour'],
    });
    const onAfter = vi.fn();
    const { result } = renderHook(() => usePantryDeduction(onAfter));

    await act(async () => {
      await result.current.open(7);
    });

    await act(async () => {
      await result.current.confirm([{ productKey: 'flour', amountToDeduct: 200 }]);
    });

    expect(mocks.applyMealDeduction).toHaveBeenCalledWith(7, [
      { productKey: 'flour', amountToDeduct: 200 },
    ]);
    expect(result.current.state.applying).toBe(false);
    expect(result.current.state.resultMessage).toBe('applied');
    expect(result.current.state.lowStockCount).toBe(1);
    expect(onAfter).toHaveBeenCalled();
  });

  test('confirm() preserves dialog with applyError when API fails', async () => {
    mocks.markMealEaten.mockResolvedValue({
      mealId: 7,
      recipeId: 11,
      alreadyCooked: false,
      suggestions: [],
    });
    mocks.applyMealDeduction.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => usePantryDeduction());

    await act(async () => {
      await result.current.open(7);
    });

    await act(async () => {
      await result.current.confirm([{ productKey: 'x', amountToDeduct: 1 }]);
    });

    expect(result.current.state.applyError).toBeTruthy();
    expect(result.current.state.open).toBe(true);
  });

  test('skip() resets to idle without calling API', async () => {
    mocks.markMealEaten.mockResolvedValue({
      mealId: 1,
      recipeId: 11,
      alreadyCooked: false,
      suggestions: [],
    });
    const { result } = renderHook(() => usePantryDeduction());
    await act(async () => {
      await result.current.open(1);
    });

    act(() => {
      result.current.skip();
    });

    expect(result.current.state.open).toBe(false);
    expect(mocks.applyMealDeduction).not.toHaveBeenCalled();
    expect(mocks.unmarkMealEaten).not.toHaveBeenCalled();
  });

  test('cancel() rolls status back via unmarkMealEaten', async () => {
    mocks.markMealEaten.mockResolvedValue({
      mealId: 5,
      recipeId: 11,
      alreadyCooked: false,
      suggestions: [],
    });
    mocks.unmarkMealEaten.mockResolvedValue({ ok: true });
    const onAfter = vi.fn();
    const { result } = renderHook(() => usePantryDeduction(onAfter));

    await act(async () => {
      await result.current.open(5);
    });

    await act(async () => {
      await result.current.cancel();
    });

    expect(mocks.unmarkMealEaten).toHaveBeenCalledWith(5);
    expect(result.current.state.open).toBe(false);
    expect(onAfter).toHaveBeenCalled();
  });

  test('cancel() still closes dialog if unmark API fails', async () => {
    mocks.markMealEaten.mockResolvedValue({
      mealId: 5,
      recipeId: 11,
      alreadyCooked: false,
      suggestions: [],
    });
    mocks.unmarkMealEaten.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => usePantryDeduction());

    await act(async () => {
      await result.current.open(5);
    });

    await act(async () => {
      await result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.state.open).toBe(false);
    });
  });

  test('close() resets state without calling any API', () => {
    const { result } = renderHook(() => usePantryDeduction());
    act(() => {
      result.current.close();
    });
    expect(result.current.state.open).toBe(false);
    expect(mocks.markMealEaten).not.toHaveBeenCalled();
    expect(mocks.applyMealDeduction).not.toHaveBeenCalled();
    expect(mocks.unmarkMealEaten).not.toHaveBeenCalled();
  });
});
