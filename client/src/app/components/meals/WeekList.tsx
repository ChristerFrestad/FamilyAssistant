// Compact list of all 7 days under the hero card. Provides at-a-
// glance context for the rest of the week and lets the user jump
// to a different day without scrolling back up to the day strip.
//
// Each row renders the long day-name (e.g. "Mandag"), the planned
// recipe-name OR the empty-placeholder text, and a subtle prep-time
// chip when the slot has a recipe with prepTime set. The selected
// row gets a mint accent border so it visually pairs with the
// active day-pill above.

import type { MealSlot } from '../../meals/mealsApi';

export interface WeekListProps {
  slots: MealSlot[];
  selectedIndex: number;
  todayIndex: number;
  /** Localised long day-names indexed 0..6 (Mandag..Søndag). */
  longDayLabels: string[];
  /** Localised "+ Legg til middag" placeholder for empty rows. */
  emptyRowLabel: string;
  /** Localised status hint for "away" rows (compact). */
  awayLabel: string;
  /** Localised status hint for "skipped" rows (compact). */
  skippedLabel: string;
  /** Localised "I dag"-marker text. */
  todayLabel: string;
  /** Localised section heading (h3). */
  sectionLabel: string;
  onSelect: (index: number) => void;
  /**
   * Sprint 6 — when supplied, clicking an empty-state row also opens
   * the recipe picker for that day. Without it, clicking an empty
   * row just navigates (legacy behaviour).
   */
  onSelectEmpty?: (dayOfWeek: number) => void;
}

export function WeekList({
  slots,
  selectedIndex,
  todayIndex,
  longDayLabels,
  emptyRowLabel,
  awayLabel,
  skippedLabel,
  todayLabel,
  sectionLabel,
  onSelect,
  onSelectEmpty,
}: WeekListProps): JSX.Element {
  return (
    <section aria-labelledby="week-list-heading" className="flex flex-col gap-2">
      <h3 id="week-list-heading" className="font-display text-card text-text-1">
        {sectionLabel}
      </h3>
      <ul className="flex flex-col gap-1.5" role="list" data-testid="week-list">
        {slots.map((slot, idx) => {
          const isSelected = idx === selectedIndex;
          const isToday = idx === todayIndex;
          const dayLabel = longDayLabels[idx] ?? '';
          const rowText = labelForRow(slot, emptyRowLabel, awayLabel, skippedLabel);
          const showPrepTime =
            slot.recipe !== null &&
            slot.status !== 'away' &&
            slot.status !== 'skipped' &&
            slot.recipe.prepTime !== null;
          const isEmpty =
            slot.recipe === null && slot.status !== 'away' && slot.status !== 'skipped';
          return (
            <li key={slot.dayOfWeek}>
              <button
                type="button"
                onClick={() => {
                  onSelect(idx);
                  if (isEmpty && onSelectEmpty) onSelectEmpty(slot.dayOfWeek);
                }}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                data-testid={`week-list-row-${slot.dayOfWeek}`}
                className={[
                  'flex w-full items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                  isSelected ? 'border-mint' : 'border-stroke hover:border-stroke-strong',
                ].join(' ')}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-body text-meta uppercase tracking-wider text-text-3">
                    {dayLabel}
                    {isToday ? (
                      <span
                        className="rounded-pill bg-mint px-1.5 py-0.5 font-body text-meta lowercase tracking-normal text-ink-contrast"
                        data-testid={`week-list-row-${slot.dayOfWeek}-today`}
                      >
                        {todayLabel}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={[
                      'truncate font-body text-body',
                      slot.recipe ? 'text-text-1' : 'text-text-3',
                    ].join(' ')}
                    data-testid={`week-list-row-${slot.dayOfWeek}-text`}
                  >
                    {rowText}
                  </span>
                </div>
                {showPrepTime ? (
                  <span
                    className="flex-shrink-0 rounded-pill border border-stroke px-2 py-0.5 font-body text-meta text-text-3"
                    data-testid={`week-list-row-${slot.dayOfWeek}-prep-time`}
                  >
                    {slot.recipe?.prepTime}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function labelForRow(
  slot: MealSlot,
  emptyRowLabel: string,
  awayLabel: string,
  skippedLabel: string
): string {
  if (slot.status === 'away') {
    return slot.recipe ? `${awayLabel} · ${slot.recipe.name}` : awayLabel;
  }
  if (slot.status === 'skipped') return skippedLabel;
  if (slot.recipe === null) return emptyRowLabel;
  return slot.recipe.name;
}
