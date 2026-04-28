// Centered max-width wrapper for narrow page surfaces — auth flow,
// magic-link pages, bootstrap wizards, single-column docs. Sits
// between the page <body> and the content. Mobile-padding (px-4)
// is always present so content does not crash into the viewport
// edge on narrow screens.
//
// Not the same as the eventual AppShell (Phase 1d). AppShell will
// host the dashboard / calendar / shopping screens with bottom-nav
// and persistent header. PageShell is for the in-between flows
// where less chrome is more.
//
// max-width values are deliberately larger than Tailwind's default
// max-w-{sm,md,lg} (which top out at 32 rem ≈ 512 px). The aliases
// here map to:
//   sm  -> max-w-md (28 rem ≈ 448 px) — auth/wizard
//   md  -> max-w-2xl (42 rem ≈ 672 px) — main content default
//   lg  -> max-w-4xl (56 rem ≈ 896 px) — wide
// The "sm" alias is still narrower than the others, but a 384 px
// shell would feel cramped even on a phone in landscape.

import { type HTMLAttributes, forwardRef } from 'react';

export type PageShellMaxWidth = 'sm' | 'md' | 'lg';

export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  /** Max width tier. Defaults to 'md'. */
  maxWidth?: PageShellMaxWidth;
  /** When true, drops vertical padding to py-4 (auth-flow density). Defaults to false. */
  compact?: boolean;
}

const MAX_WIDTH_CLASSES: Record<PageShellMaxWidth, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
};

export const PageShell = forwardRef<HTMLDivElement, PageShellProps>(function PageShell(
  { maxWidth = 'md', compact = false, className, children, ...rest },
  ref
): JSX.Element {
  const cls = [
    'mx-auto w-full px-4',
    compact ? 'py-4' : 'py-8',
    MAX_WIDTH_CLASSES[maxWidth],
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
