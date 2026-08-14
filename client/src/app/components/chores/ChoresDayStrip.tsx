// Horizontal day-picker for the Chores screen.
//
// Copies the Meals DayStrip visual contract 1:1 (pill size, selected
// / idle classes, today label, aria-pressed / aria-current). Dots
// encode pending vs overdue vs empty instead of meal planned/empty.

import type { JSX } from 'react';

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
    <nav
      aria-label={ariaLabel}
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      data-testid="chores-day-strip"
    >
      <ul className="flex min-w-full gap-2" role="list">
        {[0, 1, 2, 3, 4, 5, 6].map((idx) => {
          const isSelected = idx === selectedIndex;
          const isToday = idx === todayIndex;
          const overdue = overdueByDay[idx] === true;
          const pending = pendingByDay[idx] === true;
          const dotClass = overdue ? 'bg-rose' : pending ? 'bg-mint' : 'bg-stroke-strong';
          const dotKind = overdue ? 'overdue' : pending ? 'pending' : 'empty';
          return (
            <li key={idx} className="flex-shrink-0">
              <button
                type="button"
                onClick={() => onSelect(idx)}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                data-testid={`chores-day-pill-${idx}`}
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
                    data-testid={`chores-day-pill-${idx}-today`}
                  >
                    {todayLabel}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  className={['mt-1 h-1.5 w-1.5 rounded-full', dotClass].join(' ')}
                  data-testid={`chores-day-pill-${idx}-${dotKind}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
