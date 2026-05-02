// RecipePickerDialog presentation tests. Parent owns state; we
// verify search-filter, category-pill toggling, blocked-row state,
// and that "Velg" fires onSelect with the recipe id.

import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecipePickerDialog } from './RecipePickerDialog';
import type { RecipeSummary } from '../../meals/mealsApi';

function makeRecipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: 1,
    name: 'Kylling red curry',
    category: 'rask',
    prepTime: '25 min',
    servings: 2,
    hiddenByAllergy: false,
    hiddenByDiet: false,
    shownWithDislikeWarning: false,
    blockedIngredients: [],
    ...overrides,
  };
}

const NOOP = (): void => undefined;

describe('RecipePickerDialog', () => {
  test('renders loading state', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[]}
        loading
        error={null}
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    expect(screen.getByTestId('recipe-picker-loading')).toBeInTheDocument();
  });

  test('renders error state when fetch failed', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[]}
        loading={false}
        error="Boom"
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    expect(screen.getByTestId('recipe-picker-error')).toHaveTextContent('Boom');
  });

  test('renders empty-results message when no recipes match filter', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[makeRecipe({ name: 'Pizza' })]}
        loading={false}
        error={null}
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    fireEvent.change(screen.getByTestId('recipe-picker-search'), {
      target: { value: 'sushi' },
    });
    expect(screen.getByTestId('recipe-picker-no-results')).toBeInTheDocument();
  });

  test('search filters recipes by name', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[makeRecipe({ id: 1, name: 'Pizza' }), makeRecipe({ id: 2, name: 'Tacos' })]}
        loading={false}
        error={null}
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    fireEvent.change(screen.getByTestId('recipe-picker-search'), {
      target: { value: 'pizza' },
    });
    expect(screen.getByTestId('recipe-picker-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-picker-row-2')).toBeNull();
  });

  test('category filter pills are multi-select', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[
          makeRecipe({ id: 1, category: 'rask' }),
          makeRecipe({ id: 2, category: 'comfort' }),
          makeRecipe({ id: 3, category: 'helg' }),
        ]}
        loading={false}
        error={null}
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    fireEvent.click(screen.getByTestId('recipe-picker-category-rask'));
    expect(screen.getByTestId('recipe-picker-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-picker-row-2')).toBeNull();
    fireEvent.click(screen.getByTestId('recipe-picker-category-comfort'));
    expect(screen.getByTestId('recipe-picker-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-picker-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-picker-row-3')).toBeNull();
  });

  test('blocked recipes show a flag and disable the select button', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[makeRecipe({ id: 1, hiddenByAllergy: true })]}
        loading={false}
        error={null}
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    expect(screen.getByTestId('recipe-picker-blocked-1')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-picker-select-1')).toBeDisabled();
  });

  test('select button fires onSelect with recipe id', () => {
    const onSelect = vi.fn();
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[makeRecipe({ id: 7 })]}
        loading={false}
        error={null}
        applying={false}
        applyError={null}
        onSelect={onSelect}
        onClose={NOOP}
      />
    );
    fireEvent.click(screen.getByTestId('recipe-picker-select-7'));
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  test('current recipe is marked when in swap mode', () => {
    render(
      <RecipePickerDialog
        open
        mode="swap"
        dayOfWeek={1}
        currentRecipeId={5}
        recipes={[makeRecipe({ id: 5 }), makeRecipe({ id: 6 })]}
        loading={false}
        error={null}
        applying={false}
        applyError={null}
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    expect(screen.getByTestId('recipe-picker-current-5')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-picker-current-6')).toBeNull();
  });

  test('cancel button fires onClose and is disabled while applying', () => {
    const onClose = vi.fn();
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[]}
        loading={false}
        error={null}
        applying
        applyError={null}
        onSelect={NOOP}
        onClose={onClose}
      />
    );
    expect(screen.getByTestId('recipe-picker-cancel')).toBeDisabled();
  });

  test('apply error surfaces inline', () => {
    render(
      <RecipePickerDialog
        open
        mode="plan"
        dayOfWeek={0}
        recipes={[]}
        loading={false}
        error={null}
        applying={false}
        applyError="Could not save"
        onSelect={NOOP}
        onClose={NOOP}
      />
    );
    expect(screen.getByTestId('recipe-picker-apply-error')).toHaveTextContent('Could not save');
  });
});
