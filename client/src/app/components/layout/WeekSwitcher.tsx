// Shared previous/next control for screens that follow ?week=YYYY-WNN.
// Icon buttons use the default button size so the target stays at least
// 24px (WCAG 2.2 AA 2.5.8). The week label is a live region so the
// change is announced after the arrows.

import type { JSX } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../base/Button';

export interface WeekSwitcherProps {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  /** Prefix for data-testid values: `${prefix}-week-nav|prev|next|year`. */
  testIdPrefix: string;
}

export function WeekSwitcher({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  testIdPrefix,
}: WeekSwitcherProps): JSX.Element {
  return (
    <div className="mt-1 flex items-center gap-2" data-testid={`${testIdPrefix}-week-nav`}>
      <Button
        type="button"
        variant="ghost"
        aria-label={prevLabel}
        onClick={onPrev}
        className="min-h-6 min-w-6"
        data-testid={`${testIdPrefix}-week-prev`}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <p
        className="min-w-[8rem] text-center font-body text-meta text-text-2"
        aria-live="polite"
        data-testid={`${testIdPrefix}-week-year`}
      >
        {label}
      </p>
      <Button
        type="button"
        variant="ghost"
        aria-label={nextLabel}
        onClick={onNext}
        className="min-h-6 min-w-6"
        data-testid={`${testIdPrefix}-week-next`}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
