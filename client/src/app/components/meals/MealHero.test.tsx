// Tests for MealHero. The component branches on status + recipe, so
// each branch gets its own test. We don't depend on real i18n here —
// jsdom uses the i18next-test setup (no/en bundles loaded by
// test-setup.ts) so t-keys resolve to Norwegian strings during the
// test run.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { MealHero } from './MealHero';
import type { MealSlot } from '../../meals/mealsApi';

function makeSlot(overrides: Partial<MealSlot> = {}): MealSlot {
  return {
    id: 42,
    dayOfWeek: 0,
    dayName: 'mandag',
    recipeId: 1,
    status: 'planned',
    notes: null,
    recipe: {
      id: 1,
      name: 'Kylling red curry',
      category: 'rask',
      prepTime: '25 min',
      servings: 2,
      source: 'godt.no',
      url: 'https://example.com/recipe',
      notes: null,
      ingredients: [],
    },
    ...overrides,
  };
}

describe('MealHero — recipe state', () => {
  test('renders category badge, prep time, name, and open-source link', () => {
    render(<MealHero slot={makeSlot()} dayLabel="Mandag" isToday={false} />);
    expect(screen.getByTestId('meal-hero-recipe')).toBeInTheDocument();
    expect(screen.getByTestId('meal-hero-category')).toBeInTheDocument();
    expect(screen.getByTestId('meal-hero-prep-time')).toHaveTextContent('25 min');
    expect(screen.getByTestId('meal-hero-name')).toHaveTextContent('Kylling red curry');
    expect(screen.getByTestId('meal-hero-source-link')).toHaveAttribute(
      'href',
      'https://example.com/recipe'
    );
    expect(screen.getByTestId('meal-hero-source-link')).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('meal-hero-source-link')).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );
  });

  test('omits source link when recipe.url is null', () => {
    render(
      <MealHero
        slot={makeSlot({
          recipe: { ...makeSlot().recipe!, url: null },
        })}
        dayLabel="Mandag"
        isToday={false}
      />
    );
    expect(screen.queryByTestId('meal-hero-source-link')).toBeNull();
  });

  test('swap button calls onSwap with dayOfWeek and current recipe id', () => {
    const handler = vi.fn();
    render(<MealHero slot={makeSlot()} dayLabel="Mandag" isToday={false} onSwap={handler} />);
    fireEvent.click(screen.getByTestId('meal-hero-swap-button'));
    expect(handler).toHaveBeenCalledWith(0, 1);
  });

  test('mark-cooked button fires onMarkCooked with slot id', () => {
    const handler = vi.fn();
    render(<MealHero slot={makeSlot()} dayLabel="Mandag" isToday={false} onMarkCooked={handler} />);
    fireEvent.click(screen.getByTestId('meal-hero-mark-cooked-button'));
    expect(handler).toHaveBeenCalledWith(42);
  });
});

describe('MealHero — empty state', () => {
  test('renders empty hero with plan button when recipe is null', () => {
    render(
      <MealHero
        slot={makeSlot({ recipe: null, recipeId: null })}
        dayLabel="Mandag"
        isToday={false}
      />
    );
    expect(screen.getByTestId('meal-hero-empty')).toBeInTheDocument();
    expect(screen.getByTestId('meal-hero-plan-button')).toBeInTheDocument();
  });

  test('plan button calls onPlan with dayOfWeek', () => {
    const handler = vi.fn();
    render(
      <MealHero
        slot={makeSlot({ recipe: null, recipeId: null })}
        dayLabel="Mandag"
        isToday={false}
        onPlan={handler}
      />
    );
    fireEvent.click(screen.getByTestId('meal-hero-plan-button'));
    expect(handler).toHaveBeenCalledWith(0);
  });

  test('plan button is disabled when no onPlan handler is supplied', () => {
    render(
      <MealHero
        slot={makeSlot({ recipe: null, recipeId: null })}
        dayLabel="Mandag"
        isToday={false}
      />
    );
    expect(screen.getByTestId('meal-hero-plan-button')).toBeDisabled();
  });
});

describe('MealHero — status branches', () => {
  test('away status replaces hero body with away copy', () => {
    render(<MealHero slot={makeSlot({ status: 'away' })} dayLabel="Søndag" isToday={false} />);
    expect(screen.getByTestId('meal-hero-away')).toBeInTheDocument();
    expect(screen.getByTestId('meal-hero-away-recipe-meta')).toBeInTheDocument();
    expect(screen.queryByTestId('meal-hero-swap-button')).toBeNull();
  });

  test('away without recipe omits recipe-meta line', () => {
    render(
      <MealHero
        slot={makeSlot({ status: 'away', recipe: null, recipeId: null })}
        dayLabel="Søndag"
        isToday={false}
      />
    );
    expect(screen.queryByTestId('meal-hero-away-recipe-meta')).toBeNull();
  });

  test('skipped status renders skipped panel', () => {
    render(<MealHero slot={makeSlot({ status: 'skipped' })} dayLabel="Tirsdag" isToday={false} />);
    expect(screen.getByTestId('meal-hero-skipped')).toBeInTheDocument();
  });
});
