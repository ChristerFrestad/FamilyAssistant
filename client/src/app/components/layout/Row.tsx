// Horizontal layout primitive. Stack's sibling — same gap and align
// scales, plus a `justify` for main-axis distribution and a `wrap`
// flag for letting children wrap onto a second line on narrow
// screens (toolbar buttons, badge groups, etc.).
//
// Default `justify='start'` matches the natural flex behavior, so
// callers who only need a horizontal layout can use Row without
// thinking about main-axis distribution. Default `align='stretch'`
// keeps cross-axis behavior consistent with Stack.
//
// `wrap=true` adds `flex-wrap`. The default is `nowrap`, which is
// also flexbox's default, so we omit the class entirely instead of
// emitting a redundant `flex-nowrap` utility.

import { type HTMLAttributes, forwardRef } from 'react';
import { type StackAlign, type StackGap } from './Stack';

export type RowGap = StackGap;
export type RowAlign = StackAlign;
export type RowJustify = 'start' | 'center' | 'end' | 'between' | 'around';

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  /** Spacing between children. Defaults to 'md' (gap-4 / 16 px). */
  gap?: RowGap;
  /** Cross-axis (vertical) alignment of children. Defaults to 'stretch'. */
  align?: RowAlign;
  /** Main-axis (horizontal) distribution of children. Defaults to 'start'. */
  justify?: RowJustify;
  /** When true, children may wrap onto multiple lines (`flex-wrap`). Defaults to false. */
  wrap?: boolean;
}

const GAP_CLASSES: Record<RowGap, string> = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-10',
};

const ALIGN_CLASSES: Record<RowAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

const JUSTIFY_CLASSES: Record<RowJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
};

const BASE_CLASSES = 'flex flex-row';

export const Row = forwardRef<HTMLDivElement, RowProps>(function Row(
  { gap = 'md', align = 'stretch', justify = 'start', wrap = false, className, children, ...rest },
  ref
): JSX.Element {
  const cls = [
    BASE_CLASSES,
    GAP_CLASSES[gap],
    ALIGN_CLASSES[align],
    JUSTIFY_CLASSES[justify],
    wrap ? 'flex-wrap' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={cls} {...rest}>
      {children}
    </div>
  );
});
