// Shared horizontal week-of-pills for Meals and Chores.
//
// Pure render: seven buttons, selected/today chrome, and a status
// dot. Callers map domain state onto dots (meals planned → active,
// chores overdue → alert) so this file stays screen-agnostic.
// Calendar week view is a later surface (U5) and is not wired here.

import type { JSX } from 'react';

export type WeekStripDot = 'empty' | 'active' | 'alert';

export interface WeekStripProps {
  selectedIndex: number;
  /** Index of "today" — gets the small today-label. */
  todayIndex: number;
  /** Localised short day-names indexed 0..6 (mandag..søndag). */
  shortDayLabels: string[];
  /** Localised "I dag" badge text. */
  todayLabel: string;
  /** ARIA label for the navigation region. */
  ariaLabel: string;
  onSelect: (day: number) => void;
  /** Length 7. empty=stroke, active=mint, alert=rose. */
  dots: WeekStripDot[];
  /**
   * Prefix for data-testid. Default `week-strip` → `week-strip` /
   * `week-pill-N`. Pass `day` or `chores-day` to keep existing
   * screen testids.
   */
  testIdPrefix?: string;
}

const DOT_CLASS: Record<WeekStripDot, string> = {
  empty: 'bg-stroke-strong',
  active: 'bg-mint',
  alert: 'bg-rose',
};

function testIds(prefix: string): {
  strip: string;
  pill: (idx: number) => string;
  today: (idx: number) => string;
  dot: (idx: number, kind: WeekStripDot) => string;
} {
  const base = prefix.endsWith('-strip') ? prefix.slice(0, -'-strip'.length) : prefix;
  return {
    strip: `${base}-strip`,
    pill: (idx) => `${base}-pill-${idx}`,
    today: (idx) => `${base}-pill-${idx}-today`,
    dot: (idx, kind) => `${base}-pill-${idx}-${kind}`,
  };
}

export function WeekStrip({
  selectedIndex,
  todayIndex,
  shortDayLabels,
  todayLabel,
  ariaLabel,
  onSelect,
  dots,
  testIdPrefix = 'week-strip',
}: WeekStripProps): JSX.Element {
  const ids = testIds(testIdPrefix);
  return (
    <nav
      aria-label={ariaLabel}
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      data-testid={ids.strip}
    >
      <ul className="flex min-w-full gap-2" role="list">
        {dots.map((dot, idx) => {
          const isSelected = idx === selectedIndex;
          const isToday = idx === todayIndex;
          return (
            <li key={idx} className="flex-shrink-0">
              <button
                type="button"
                onClick={() => onSelect(idx)}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                data-testid={ids.pill(idx)}
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
                  <span className="font-body text-meta text-mint" data-testid={ids.today(idx)}>
                    {todayLabel}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  className={['mt-1 h-1.5 w-1.5 rounded-full', DOT_CLASS[dot]].join(' ')}
                  data-testid={ids.dot(idx, dot)}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
