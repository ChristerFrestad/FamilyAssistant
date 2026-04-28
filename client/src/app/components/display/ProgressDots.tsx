// Discrete step indicator. Shows N dots in a row, with three
// possible states per dot:
//   - current  : the active step                 -> bg-mint
//   - completed: any step before current         -> bg-mint opacity-60
//   - pending  : any step after current          -> bg-stroke-strong
//
// Designed for short flows (3-7 steps) — wizard, onboarding, magic-
// link confirmation. For longer sequences, a labeled stepper would
// communicate progress better, but ProgressDots is the right choice
// when the user needs to feel "how close am I?" rather than "what
// did each step do?".
//
// Accessibility: the dots themselves are decorative (aria-hidden).
// The wrapper carries `role="status"` plus a Norwegian aria-label
// "Steg X av Y" so assistive tech announces a single coherent
// progress statement instead of N nameless circles.

import { type HTMLAttributes, forwardRef } from 'react';

export type ProgressDotsSize = 'sm' | 'md' | 'lg';

export interface ProgressDotsProps extends HTMLAttributes<HTMLDivElement> {
  /** Total number of steps. */
  total: number;
  /** Current step (1-indexed). Step 1 is the first. */
  current: number;
  /** Dot diameter scale. Defaults to 'md'. */
  size?: ProgressDotsSize;
}

const SIZE_CLASSES: Record<ProgressDotsSize, string> = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export const ProgressDots = forwardRef<HTMLDivElement, ProgressDotsProps>(function ProgressDots(
  { total, current, size = 'md', className, ...rest },
  ref
): JSX.Element {
  const wrapperCls = ['flex items-center gap-1.5', className].filter(Boolean).join(' ');
  const dotSize = SIZE_CLASSES[size];

  return (
    <div
      ref={ref}
      role="status"
      aria-label={`Steg ${current} av ${total}`}
      className={wrapperCls}
      {...rest}
    >
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        let stateCls: string;
        if (stepNum === current) {
          stateCls = 'bg-mint';
        } else if (stepNum < current) {
          stateCls = 'bg-mint opacity-60';
        } else {
          stateCls = 'bg-stroke-strong';
        }
        return (
          <span key={i} aria-hidden="true" className={`rounded-full ${dotSize} ${stateCls}`} />
        );
      })}
    </div>
  );
});
