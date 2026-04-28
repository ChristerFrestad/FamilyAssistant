// Vertical layout primitive. A flex-column container with a token-
// aware gap and cross-axis alignment. Replaces ad-hoc
// `<div className="flex flex-col gap-4 items-start">`-pattern that
// would otherwise repeat across every screen.
//
// gap uses t-shirt aliases (xs..xl) instead of raw Tailwind gap-N
// so consumers do not need to learn the spacing scale to use it.
// The mapping (md = gap-4 = 16 px) matches the design system's
// "natural medium gap" — most cards in the mockup use exactly
// that value.
//
// align defaults to 'stretch' because the most common usage is a
// stack of full-width children (form fields, list items). Override
// to 'center' for vertically-centered hero stacks.

import { type HTMLAttributes, forwardRef } from 'react';

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Spacing between children. Defaults to 'md' (gap-4 / 16 px). */
  gap?: StackGap;
  /** Cross-axis (horizontal) alignment of children. Defaults to 'stretch'. */
  align?: StackAlign;
}

const GAP_CLASSES: Record<StackGap, string> = {
  xs: 'gap-1', // 4 px
  sm: 'gap-2', // 8 px
  md: 'gap-4', // 16 px
  lg: 'gap-6', // 24 px
  xl: 'gap-10', // 40 px
};

const ALIGN_CLASSES: Record<StackAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

const BASE_CLASSES = 'flex flex-col';

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 'md', align = 'stretch', className, children, ...rest },
  ref
): JSX.Element {
  const cls = [BASE_CLASSES, GAP_CLASSES[gap], ALIGN_CLASSES[align], className]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={cls} {...rest}>
      {children}
    </div>
  );
});
