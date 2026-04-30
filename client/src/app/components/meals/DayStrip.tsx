// Horizontal day-picker for the Meals screen.
//
// Renders all seven slots from /api/meals/current as button-pills,
// with the active slot ring-mint-highlighted and "today" (per the
// hook's todayIndex prop) labelled with a small dot indicator.
// Planned days (slot.recipe truthy AND status !== 'removed') get a
// solid mint dot; un-planned days get a muted dot so the strip
// signals "where do I have a plan" at a glance.
//
// Pure render: input via props, output a row of buttons. The
// caller (Meals.tsx) owns selection state via the useMealsData
// hook and passes onSelect so the strip can stay testable without
// spinning up the full hook.

import type { MealSlot } from '../../meals/mealsApi';

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

function isPlanned(slot: MealSlot): boolean {
  if (slot.recipe === null) return false;
  if (slot.status === 'removed' || slot.status === 'skipped') return false;
  return true;
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
    <nav
      aria-label={ariaLabel}
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      data-testid="day-strip"
    >
      <ul className="flex min-w-full gap-2" role="list">
        {slots.map((slot, idx) => {
          const isSelected = idx === selectedIndex;
          const isToday = idx === todayIndex;
          const planned = isPlanned(slot);
          return (
            <li key={slot.dayOfWeek} className="flex-shrink-0">
              <button
                type="button"
                onClick={() => onSelect(idx)}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                data-testid={`day-pill-${slot.dayOfWeek}`}
                className={[
                  'flex min-w-[72px] flex-col items-center gap-1 rounded-lg border px-3 py-2 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                  isSelected
                    ? 'border-mint bg-surface-strong text-text-1'
                    : 'border-stroke bg-surface text-text-2 hover:text-text-1',
                ].join(' ')}
              >
                <span className="font-body text-meta uppercase tracking-wider">
                  {shortDayLabels[idx] ?? ''}
                </span>
                {isToday ? (
                  <span
                    className="font-body text-meta text-mint"
                    data-testid={`day-pill-${slot.dayOfWeek}-today`}
                  >
                    {todayLabel}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  className={[
                    'mt-1 h-1.5 w-1.5 rounded-full',
                    planned ? 'bg-mint' : 'bg-stroke-strong',
                  ].join(' ')}
                  data-testid={`day-pill-${slot.dayOfWeek}-${planned ? 'planned' : 'empty'}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
