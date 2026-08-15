// Tests for DayStrip — the horizontal day-pill row.
//
// Pure render — no hooks, no fetch. We assert on the buttons,
// active state, today-marker, and active-vs-empty dot. The
// component owns no side effects so the assertions can be
// straightforward DOM checks.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { DayStrip } from './DayStrip';
import type { MealSlot } from '../../meals/mealsApi';

const NO_DAYS = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

function makeSlots(overrides: Partial<MealSlot>[] = []): MealSlot[] {
  return Array.from({ length: 7 }, (_, i) => ({
    id: 100 + i,
    dayOfWeek: i,
    dayName: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][i] ?? '',
    recipeId: i + 1,
    status: 'planned' as const,
    notes: null,
    recipe: {
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
    ...(overrides[i] ?? {}),
  }));
}

describe('DayStrip', () => {
  test('renders 7 pills with short day labels', () => {
    render(
      <DayStrip
        slots={makeSlots()}
        selectedIndex={0}
        todayIndex={0}
        shortDayLabels={NO_DAYS}
        todayLabel="I dag"
        ariaLabel="Velg dag"
        onSelect={() => undefined}
      />
    );
    NO_DAYS.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  test('marks the selected pill with aria-pressed=true', () => {
    render(
      <DayStrip
        slots={makeSlots()}
        selectedIndex={3}
        todayIndex={0}
        shortDayLabels={NO_DAYS}
        todayLabel="I dag"
        ariaLabel="Velg dag"
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('day-pill-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('day-pill-0').getAttribute('aria-pressed')).toBe('false');
  });

  test('marks today with aria-current and a label', () => {
    render(
      <DayStrip
        slots={makeSlots()}
        selectedIndex={0}
        todayIndex={2}
        shortDayLabels={NO_DAYS}
        todayLabel="I dag"
        ariaLabel="Velg dag"
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('day-pill-2').getAttribute('aria-current')).toBe('date');
    expect(screen.getByTestId('day-pill-2-today')).toHaveTextContent('I dag');
    // Other pills do not get the today label
    expect(screen.queryByTestId('day-pill-0-today')).toBeNull();
  });

  test('shows active dot when slot has a recipe and status is not removed/skipped', () => {
    const slots = makeSlots([
      {},
      { recipe: null, recipeId: null }, // empty
      { status: 'skipped' },
      { status: 'removed', recipe: null, recipeId: null },
    ]);
    render(
      <DayStrip
        slots={slots}
        selectedIndex={0}
        todayIndex={0}
        shortDayLabels={NO_DAYS}
        todayLabel="I dag"
        ariaLabel="Velg dag"
        onSelect={() => undefined}
      />
    );
    expect(screen.getByTestId('day-pill-0-active')).toBeInTheDocument();
    expect(screen.getByTestId('day-pill-1-empty')).toBeInTheDocument();
    expect(screen.getByTestId('day-pill-2-empty')).toBeInTheDocument();
    expect(screen.getByTestId('day-pill-3-empty')).toBeInTheDocument();
  });

  test('clicking a pill calls onSelect with the index', () => {
    const handler = vi.fn();
    render(
      <DayStrip
        slots={makeSlots()}
        selectedIndex={0}
        todayIndex={0}
        shortDayLabels={NO_DAYS}
        todayLabel="I dag"
        ariaLabel="Velg dag"
        onSelect={handler}
      />
    );
    fireEvent.click(screen.getByTestId('day-pill-4'));
    expect(handler).toHaveBeenCalledWith(4);
  });

  test('nav contains horizontal overflow with overflow-x-auto', () => {
    // Regression guard for hotfix/meals-mobile-layout. The 7 pills are
    // each min-w-[72px] flex-shrink-0, totalling 552px (with gaps) —
    // wider than mobile viewport. The nav wrapper MUST keep overflow-x
    // scroll containment so the strip itself scrolls horizontally
    // without pushing <body> wider than the viewport.
    render(
      <DayStrip
        slots={makeSlots()}
        selectedIndex={0}
        todayIndex={0}
        shortDayLabels={NO_DAYS}
        todayLabel="I dag"
        ariaLabel="Velg dag"
        onSelect={() => undefined}
      />
    );
    const nav = screen.getByTestId('day-strip');
    expect(nav.className).toMatch(/\boverflow-x-auto\b/);
  });
});
