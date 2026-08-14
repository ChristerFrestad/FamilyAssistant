// Compact 7-row week summary under the selected-day list.
// Spacing and today-pill language match Meals WeekList.

import type { JSX } from 'react';

export interface ChoresWeekListProps {
  selectedIndex: number;
  todayIndex: number;
  longDayLabels: string[];
  todayLabel: string;
  sectionLabel: string;
  emptyRowLabel: string;
  pendingLabel: (count: number) => string;
  pendingByDay: number[];
  overdueByDay: boolean[];
  onSelect: (index: number) => void;
}

export function ChoresWeekList({
  selectedIndex,
  todayIndex,
  longDayLabels,
  todayLabel,
  sectionLabel,
  emptyRowLabel,
  pendingLabel,
  pendingByDay,
  overdueByDay,
  onSelect,
}: ChoresWeekListProps): JSX.Element {
  return (
    <section aria-labelledby="chores-week-list-heading" className="flex flex-col gap-2">
      <h2 id="chores-week-list-heading" className="font-display text-card text-text-1">
        {sectionLabel}
      </h2>
      <ul className="flex flex-col gap-1.5" role="list" data-testid="chores-week-list">
        {[0, 1, 2, 3, 4, 5, 6].map((idx) => {
          const isSelected = idx === selectedIndex;
          const isToday = idx === todayIndex;
          const pending = pendingByDay[idx] ?? 0;
          const overdue = overdueByDay[idx] === true;
          const rowText = pending > 0 ? pendingLabel(pending) : emptyRowLabel;
          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => onSelect(idx)}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                data-testid={`chores-week-row-${idx}`}
                className={[
                  'flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                  isSelected ? 'border-mint' : 'border-stroke hover:border-stroke-strong',
                ].join(' ')}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-body text-meta uppercase tracking-wider text-text-3">
                    {longDayLabels[idx] ?? ''}
                    {isToday ? (
                      <span
                        className="rounded-pill bg-mint px-1.5 py-0.5 font-body text-meta lowercase tracking-normal text-ink-contrast"
                        data-testid={`chores-week-row-${idx}-today`}
                      >
                        {todayLabel}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={[
                      'truncate font-body text-body',
                      pending > 0 ? (overdue ? 'text-rose-deep' : 'text-text-1') : 'text-text-3',
                    ].join(' ')}
                    data-testid={`chores-week-row-${idx}-text`}
                  >
                    {rowText}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
