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
    render(
      <MealHero
        slot={makeSlot()}
        dayLabel="Mandag"
        isToday={false}
        onPlaceholderAction={() => undefined}
      />
    );
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
        onPlaceholderAction={() => undefined}
      />
    );
    expect(screen.queryByTestId('meal-hero-source-link')).toBeNull();
  });

  test('swap button calls onPlaceholderAction with "swap"', () => {
    const handler = vi.fn();
    render(
      <MealHero slot={makeSlot()} dayLabel="Mandag" isToday={false} onPlaceholderAction={handler} />
    );
    fireEvent.click(screen.getByTestId('meal-hero-swap-button'));
    expect(handler).toHaveBeenCalledWith('swap');
  });

  test('renders placeholder status when provided', () => {
    render(
      <MealHero
        slot={makeSlot()}
        dayLabel="Mandag"
        isToday={false}
        onPlaceholderAction={() => undefined}
        placeholderStatus="Kommer i Sprint 5"
      />
    );
    expect(screen.getByTestId('meal-hero-placeholder-status')).toHaveTextContent(
      'Kommer i Sprint 5'
    );
  });
});

describe('MealHero — empty state', () => {
  test('renders empty hero with plan button when recipe is null', () => {
    render(
      <MealHero
        slot={makeSlot({ recipe: null, recipeId: null })}
        dayLabel="Mandag"
        isToday={false}
        onPlaceholderAction={() => undefined}
      />
    );
    expect(screen.getByTestId('meal-hero-empty')).toBeInTheDocument();
    expect(screen.getByTestId('meal-hero-plan-button')).toBeInTheDocument();
  });

  test('plan button triggers placeholder action with "plan"', () => {
    const handler = vi.fn();
    render(
      <MealHero
        slot={makeSlot({ recipe: null, recipeId: null })}
        dayLabel="Mandag"
        isToday={false}
        onPlaceholderAction={handler}
      />
    );
    fireEvent.click(screen.getByTestId('meal-hero-plan-button'));
    expect(handler).toHaveBeenCalledWith('plan');
  });
});

describe('MealHero — status branches', () => {
  test('away status replaces hero body with away copy', () => {
    render(
      <MealHero
        slot={makeSlot({ status: 'away' })}
        dayLabel="Søndag"
        isToday={false}
        onPlaceholderAction={() => undefined}
      />
    );
    expect(screen.getByTestId('meal-hero-away')).toBeInTheDocument();
    expect(screen.getByTestId('meal-hero-away-recipe-meta')).toBeInTheDocument();
    // Recipe controls should not show in away state
    expect(screen.queryByTestId('meal-hero-swap-button')).toBeNull();
  });

  test('away without recipe omits recipe-meta line', () => {
    render(
      <MealHero
        slot={makeSlot({ status: 'away', recipe: null, recipeId: null })}
        dayLabel="Søndag"
        isToday={false}
        onPlaceholderAction={() => undefined}
      />
    );
    expect(screen.queryByTestId('meal-hero-away-recipe-meta')).toBeNull();
  });

  test('skipped status renders skipped panel', () => {
    render(
      <MealHero
        slot={makeSlot({ status: 'skipped' })}
        dayLabel="Tirsdag"
        isToday={false}
        onPlaceholderAction={() => undefined}
      />
    );
    expect(screen.getByTestId('meal-hero-skipped')).toBeInTheDocument();
  });
});
