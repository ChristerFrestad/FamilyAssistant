// MarkCookedDialog presentation tests. The component is presentational —
// the parent owns state — so these tests assert the rendered surface,
// the per-row inline-edit behavior, and the action callbacks for
// confirm/skip/cancel.

import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarkCookedDialog, type MarkCookedDialogState } from './MarkCookedDialog';

function makeState(overrides: Partial<MarkCookedDialogState> = {}): MarkCookedDialogState {
  return {
    open: true,
    loading: false,
    error: null,
    applying: false,
    applyError: null,
    mealId: 1,
    suggestions: [],
    resultMessage: null,
    lowStockCount: 0,
    ...overrides,
  };
}

describe('MarkCookedDialog', () => {
  test('renders loading state', () => {
    render(
      <MarkCookedDialog
        state={makeState({ loading: true })}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('mark-cooked-loading')).toBeInTheDocument();
  });

  test('renders error state when fetch failed', () => {
    render(
      <MarkCookedDialog
        state={makeState({ error: 'Boom' })}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('mark-cooked-load-error')).toHaveTextContent('Boom');
  });

  test('shows empty-matched message when no rows match the pantry', () => {
    render(
      <MarkCookedDialog
        state={makeState({
          suggestions: [
            {
              productKey: 'salt',
              name: 'Salt',
              recipeAmount: 5,
              portionFactor: 1,
              suggestedDeduction: 0,
              pantryRemaining: 0,
              pantryUnit: null,
              matched: false,
              optional: false,
            },
          ],
        })}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('mark-cooked-empty-matched')).toBeInTheDocument();
    expect(screen.getByTestId('mark-cooked-confirm')).toBeDisabled();
  });

  test('renders editable rows for matched ingredients', () => {
    render(
      <MarkCookedDialog
        state={makeState({
          suggestions: [
            {
              productKey: 'flour',
              name: 'Mel',
              recipeAmount: 200,
              portionFactor: 1,
              suggestedDeduction: 200,
              pantryRemaining: 500,
              pantryUnit: 'g',
              matched: true,
              optional: false,
            },
          ],
        })}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const input = screen.getByTestId('mark-cooked-amount-flour') as HTMLInputElement;
    expect(input.value).toBe('200');
  });

  test('confirm sends edited amount items to onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null);
    render(
      <MarkCookedDialog
        state={makeState({
          suggestions: [
            {
              productKey: 'flour',
              name: 'Mel',
              recipeAmount: 200,
              portionFactor: 1,
              suggestedDeduction: 200,
              pantryRemaining: 500,
              pantryUnit: 'g',
              matched: true,
              optional: false,
            },
          ],
        })}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const input = screen.getByTestId('mark-cooked-amount-flour') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('mark-cooked-confirm'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([{ productKey: 'flour', amountToDeduct: 150 }]);
    });
  });

  test('skip checkbox excludes a row from the confirm payload', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null);
    render(
      <MarkCookedDialog
        state={makeState({
          suggestions: [
            {
              productKey: 'flour',
              name: 'Mel',
              recipeAmount: 200,
              portionFactor: 1,
              suggestedDeduction: 200,
              pantryRemaining: 500,
              pantryUnit: 'g',
              matched: true,
              optional: false,
            },
          ],
        })}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('mark-cooked-skip-flour'));
    fireEvent.click(screen.getByTestId('mark-cooked-confirm'));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([]);
    });
  });

  test('clamps over-pantry amount before sending', async () => {
    const onConfirm = vi.fn().mockResolvedValue(null);
    render(
      <MarkCookedDialog
        state={makeState({
          suggestions: [
            {
              productKey: 'flour',
              name: 'Mel',
              recipeAmount: 200,
              portionFactor: 1,
              suggestedDeduction: 200,
              pantryRemaining: 100,
              pantryUnit: 'g',
              matched: true,
              optional: false,
            },
          ],
        })}
        onConfirm={onConfirm}
        onSkip={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const input = screen.getByTestId('mark-cooked-amount-flour') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('mark-cooked-confirm'));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([{ productKey: 'flour', amountToDeduct: 100 }]);
    });
  });

  test('cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <MarkCookedDialog
        state={makeState({ suggestions: [] })}
        onConfirm={vi.fn()}
        onSkip={vi.fn()}
        onCancel={onCancel}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('mark-cooked-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  test('skip button calls onSkip', () => {
    const onSkip = vi.fn();
    render(
      <MarkCookedDialog
        state={makeState({ suggestions: [] })}
        onConfirm={vi.fn()}
        onSkip={onSkip}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('mark-cooked-skip'));
    expect(onSkip).toHaveBeenCalled();
  });
});
