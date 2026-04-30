// Tests for RecipeIngredients. Three render-modes plus the two
// pure formatter helpers. The defensive console.warn for missing
// servings is asserted on so we know the pilot-telemetry stays
// wired up.

import { render, screen } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { RecipeIngredients, formatQty, formatServings } from './RecipeIngredients';
import type { MealRecipe } from '../../meals/mealsApi';

function makeRecipe(overrides: Partial<MealRecipe> = {}): MealRecipe {
  return {
    id: 1,
    name: 'Kylling red curry',
    category: 'rask',
    prepTime: '25 min',
    servings: 2,
    source: null,
    url: null,
    notes: null,
    ingredients: [
      { id: 1, productKey: 'kylling', name: 'Kyllingfilet', qty: 400, unit: 'g' },
      { id: 2, productKey: 'kokosmelk', name: 'Kokosmelk', qty: 0.4, unit: 'l' },
    ],
    ...overrides,
  };
}

describe('RecipeIngredients — scaled mode', () => {
  test('renders ingredients with scaled quantities and meta line', () => {
    render(<RecipeIngredients recipe={makeRecipe()} scale={1.5} />);
    // 400 * 1.5 = 600, 0.4 * 1.5 = 0.6
    expect(screen.getByText(/600 g/)).toBeInTheDocument();
    expect(screen.getByText(/0.6 l/)).toBeInTheDocument();
    expect(screen.getByTestId('recipe-scaled-servings')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-scaling-unavailable-badge')).toBeNull();
  });

  test('scale = 1 still renders meta line with effective = original', () => {
    render(<RecipeIngredients recipe={makeRecipe()} scale={1} />);
    expect(screen.getByTestId('recipe-scaled-servings')).toBeInTheDocument();
    expect(screen.getByText(/400 g/)).toBeInTheDocument();
  });
});

describe('RecipeIngredients — defensive scaling-unavailable mode', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('renders un-scaled quantities and warning badge when scale is null', () => {
    render(<RecipeIngredients recipe={makeRecipe({ servings: null })} scale={null} />);
    // Quantities render at original values (no multiplication)
    expect(screen.getByText(/400 g/)).toBeInTheDocument();
    expect(screen.getByText(/0.4 l/)).toBeInTheDocument();
    expect(screen.getByTestId('recipe-scaling-unavailable-badge')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-scaling-unavailable-description')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-scaled-servings')).toBeNull();
  });

  test('logs scaling-unavailable telemetry with stable key + recipe id', () => {
    render(<RecipeIngredients recipe={makeRecipe({ id: 42, servings: null })} scale={null} />);
    expect(warnSpy).toHaveBeenCalledWith(
      'meals.recipe.scalingUnavailable',
      expect.objectContaining({ recipeId: 42, servings: null })
    );
  });

  test('does not log when scale is a number', () => {
    render(<RecipeIngredients recipe={makeRecipe()} scale={1.5} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('RecipeIngredients — empty ingredient list', () => {
  test('renders empty-state text instead of list', () => {
    render(<RecipeIngredients recipe={makeRecipe({ ingredients: [] })} scale={1} />);
    expect(screen.getByTestId('recipe-ingredients-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-ingredient-list')).toBeNull();
  });
});

describe('formatQty', () => {
  test('rounds to one decimal under 10', () => {
    expect(formatQty(0.6000000000001)).toBe('0.6');
    expect(formatQty(2.345)).toBe('2.3');
  });
  test('rounds to integer at or above 10', () => {
    expect(formatQty(15.7)).toBe('16');
    expect(formatQty(123)).toBe('123');
  });
  test('handles non-finite values defensively', () => {
    expect(formatQty(Number.NaN)).toBe('0');
    expect(formatQty(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('formatServings', () => {
  test('keeps integers integer', () => {
    expect(formatServings(4)).toBe('4');
  });
  test('rounds non-integers to one decimal', () => {
    expect(formatServings(2.5)).toBe('2.5');
    expect(formatServings(1.234)).toBe('1.2');
  });
  test('handles NaN defensively', () => {
    expect(formatServings(Number.NaN)).toBe('0');
  });
});
