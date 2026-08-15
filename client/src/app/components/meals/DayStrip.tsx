// Thin meals wrapper around the shared WeekStrip.
//
// Maps MealSlot[] onto empty/active dots so existing DayStrip
// callers and tests keep a meals-shaped API.

import type { JSX } from 'react';
import type { MealSlot } from '../../meals/mealsApi';
import { WeekStrip, type WeekStripDot } from '../layout/WeekStrip';

export interface DayStripProps {
  slots: MealSlot[];
  selectedIndex: number;
  /** Index of "today" — gets the small "I dag"-label. */
  todayIndex: number;
  /** Localised short day-names indexed 0..6 (mandag..søndag). */
  shortDayLabels: string[];
  /** Localised "I dag" badge text. */
  todayLabel: string;
  /** ARIA label for the navigation region. */
  ariaLabel: string;
  onSelect: (index: number) => void;
}

export function isMealSlotPlanned(slot: MealSlot): boolean {
  if (slot.recipe === null) return false;
  if (slot.status === 'removed' || slot.status === 'skipped') return false;
  return true;
}

export function mealSlotDots(slots: MealSlot[]): WeekStripDot[] {
  return slots.map((slot) => (isMealSlotPlanned(slot) ? 'active' : 'empty'));
}

export function DayStrip({
  slots,
  selectedIndex,
  todayIndex,
  shortDayLabels,
  todayLabel,
  ariaLabel,
  onSelect,
}: DayStripProps): JSX.Element {
  return (
    <WeekStrip
      selectedIndex={selectedIndex}
      todayIndex={todayIndex}
      shortDayLabels={shortDayLabels}
      todayLabel={todayLabel}
      ariaLabel={ariaLabel}
      onSelect={onSelect}
      dots={mealSlotDots(slots)}
      testIdPrefix="day"
    />
  );
}
