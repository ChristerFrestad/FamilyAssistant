// Thin chores wrapper around the shared WeekStrip.
//
// Maps pending/overdue flags onto empty/active/alert dots so
// existing ChoresDayStrip callers keep a chores-shaped API.

import type { JSX } from 'react';
import { WeekStrip, type WeekStripDot } from '../layout/WeekStrip';

export interface ChoresDayStripProps {
  selectedIndex: number;
  todayIndex: number;
  shortDayLabels: string[];
  todayLabel: string;
  ariaLabel: string;
  /** Per-day pending flag, index 0..6. */
  pendingByDay: boolean[];
  /** Per-day overdue flag, index 0..6. Overdue wins over pending. */
  overdueByDay: boolean[];
  onSelect: (index: number) => void;
}

export function choreDayDots(pendingByDay: boolean[], overdueByDay: boolean[]): WeekStripDot[] {
  return [0, 1, 2, 3, 4, 5, 6].map((idx) => {
    if (overdueByDay[idx] === true) return 'alert';
    if (pendingByDay[idx] === true) return 'active';
    return 'empty';
  });
}

export function ChoresDayStrip({
  selectedIndex,
  todayIndex,
  shortDayLabels,
  todayLabel,
  ariaLabel,
  pendingByDay,
  overdueByDay,
  onSelect,
}: ChoresDayStripProps): JSX.Element {
  return (
    <WeekStrip
      selectedIndex={selectedIndex}
      todayIndex={todayIndex}
      shortDayLabels={shortDayLabels}
      todayLabel={todayLabel}
      ariaLabel={ariaLabel}
      onSelect={onSelect}
      dots={choreDayDots(pendingByDay, overdueByDay)}
      testIdPrefix="chores-day"
    />
  );
}
