// Tests for WeekStrip — the shared horizontal day-pill row.
//
// Pure render — no hooks, no fetch. Asserts buttons, selected
// state, today-marker, empty/active/alert dots, and testid prefix.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi } from 'vitest';
import { WeekStrip, type WeekStripDot, type WeekStripProps } from './WeekStrip';

const NO_DAYS = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
const EMPTY_DOTS: WeekStripDot[] = ['empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'];

function renderStrip(overrides: Partial<WeekStripProps> = {}): void {
  render(
    <WeekStrip
      selectedIndex={0}
      todayIndex={0}
      shortDayLabels={NO_DAYS}
      todayLabel="I dag"
      ariaLabel="Velg dag"
      onSelect={() => undefined}
      dots={EMPTY_DOTS}
      {...overrides}
    />
  );
}

describe('WeekStrip', () => {
  test('renders 7 pills with short day labels', () => {
    renderStrip();
    NO_DAYS.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  test('marks the selected pill with aria-pressed=true', () => {
    renderStrip({ selectedIndex: 3 });
    expect(screen.getByTestId('week-pill-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('week-pill-0').getAttribute('aria-pressed')).toBe('false');
  });

  test('marks today with aria-current and a label', () => {
    renderStrip({ todayIndex: 2 });
    expect(screen.getByTestId('week-pill-2').getAttribute('aria-current')).toBe('date');
    expect(screen.getByTestId('week-pill-2-today')).toHaveTextContent('I dag');
    expect(screen.queryByTestId('week-pill-0-today')).toBeNull();
  });

  test('paints empty / active / alert dots', () => {
    const dots: WeekStripDot[] = ['empty', 'active', 'alert', 'empty', 'active', 'alert', 'empty'];
    renderStrip({ dots });
    expect(screen.getByTestId('week-pill-0-empty')).toHaveClass('bg-stroke-strong');
    expect(screen.getByTestId('week-pill-1-active')).toHaveClass('bg-mint');
    expect(screen.getByTestId('week-pill-2-alert')).toHaveClass('bg-rose');
  });

  test('clicking a pill calls onSelect with the index', () => {
    const handler = vi.fn();
    renderStrip({ onSelect: handler });
    fireEvent.click(screen.getByTestId('week-pill-4'));
    expect(handler).toHaveBeenCalledWith(4);
  });

  test('nav contains horizontal overflow with overflow-x-auto', () => {
    renderStrip();
    const nav = screen.getByTestId('week-strip');
    expect(nav.className).toMatch(/\boverflow-x-auto\b/);
  });

  test('testIdPrefix remaps strip and pill ids (meals / chores)', () => {
    renderStrip({ testIdPrefix: 'day', todayIndex: 1 });
    expect(screen.getByTestId('day-strip')).toBeInTheDocument();
    expect(screen.getByTestId('day-pill-1')).toBeInTheDocument();
    expect(screen.getByTestId('day-pill-1-today')).toBeInTheDocument();
    expect(screen.queryByTestId('week-strip')).toBeNull();
  });
});
