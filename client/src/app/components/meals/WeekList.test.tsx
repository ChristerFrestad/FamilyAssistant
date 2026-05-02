// Tests for WeekList — the compact 7-row summary under the hero.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { WeekList } from './WeekList';
import type { MealSlot } from '../../meals/mealsApi';

const NO_LONG = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function makeSlot(dayOfWeek: number, overrides: Partial<MealSlot> = {}): MealSlot {
  return {
    id: 200 + dayOfWeek,
    dayOfWeek,
    dayName:
      ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][dayOfWeek] ?? '',
    recipeId: dayOfWeek + 1,
    status: 'planned',
    notes: null,
    recipe: {
      id: dayOfWeek + 1,
      name: `Recipe ${dayOfWeek + 1}`,
      category: 'rask',
      prepTime: '20 min',
      servings: 2,
      source: null,
      url: null,
      notes: null,
      ingredients: [],
    },
    ...overrides,
  };
}

const COMMON_PROPS = {
  longDayLabels: NO_LONG,
  emptyRowLabel: '+ Legg til middag',
  awayLabel: 'Borte',
  skippedLabel: 'Hopp over',
  todayLabel: 'I dag',
  sectionLabel: 'Hele uka',
};

describe('WeekList', () => {
  test('renders 7 rows with day labels', () => {
    const slots = NO_LONG.map((_, i) => makeSlot(i));
    render(
      <WeekList
        slots={slots}
        selectedIndex={0}
        todayIndex={0}
        {...COMMON_PROPS}
        onSelect={() => undefined}
      />
    );
    NO_LONG.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  test('marks selected row with aria-pressed=true', () => {
    const slots = NO_LONG.map((_, i) => makeSlot(i));
    render(
      <WeekList
        slots={slots}
        selectedIndex={3}
        todayIndex={0}
        {...COMMON_PROPS}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('week-list-row-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('week-list-row-0').getAttribute('aria-pressed')).toBe('false');
  });

  test('marks today row with aria-current and a small badge', () => {
    const slots = NO_LONG.map((_, i) => makeSlot(i));
    render(
      <WeekList
        slots={slots}
        selectedIndex={0}
        todayIndex={2}
        {...COMMON_PROPS}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('week-list-row-2').getAttribute('aria-current')).toBe('date');
    expect(screen.getByTestId('week-list-row-2-today')).toHaveTextContent('I dag');
    expect(screen.queryByTestId('week-list-row-0-today')).toBeNull();
  });

  test('empty row shows placeholder text and no prep-time chip', () => {
    const slots = NO_LONG.map((_, i) =>
      i === 5 ? makeSlot(i, { recipe: null, recipeId: null }) : makeSlot(i)
    );
    render(
      <WeekList
        slots={slots}
        selectedIndex={0}
        todayIndex={0}
        {...COMMON_PROPS}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('week-list-row-5-text')).toHaveTextContent('+ Legg til middag');
    expect(screen.queryByTestId('week-list-row-5-prep-time')).toBeNull();
  });

  test('away row shows away-label and includes recipe name when present', () => {
    const slots = NO_LONG.map((_, i) => (i === 6 ? makeSlot(i, { status: 'away' }) : makeSlot(i)));
    render(
      <WeekList
        slots={slots}
        selectedIndex={0}
        todayIndex={0}
        {...COMMON_PROPS}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('week-list-row-6-text')).toHaveTextContent('Borte · Recipe 7');
    // Prep-time hidden in away state
    expect(screen.queryByTestId('week-list-row-6-prep-time')).toBeNull();
  });

  test('skipped row shows skipped-label only', () => {
    const slots = NO_LONG.map((_, i) =>
      i === 1 ? makeSlot(i, { status: 'skipped' }) : makeSlot(i)
    );
    render(
      <WeekList
        slots={slots}
        selectedIndex={0}
        todayIndex={0}
        {...COMMON_PROPS}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('week-list-row-1-text')).toHaveTextContent('Hopp over');
  });

  test('clicking a row calls onSelect with the index', () => {
    const slots = NO_LONG.map((_, i) => makeSlot(i));
    const handler = vi.fn();
    render(
      <WeekList
        slots={slots}
        selectedIndex={0}
        todayIndex={0}
        {...COMMON_PROPS}
        onSelect={handler}
      />
    );
    fireEvent.click(screen.getByTestId('week-list-row-4'));
    expect(handler).toHaveBeenCalledWith(4);
  });
});
