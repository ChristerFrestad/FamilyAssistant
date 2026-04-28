// Small inline indicator. Two modes:
//   - Default — pill with optional children (text, ikon, both).
//                Use for status labels: "Ny", "3 nye", "Ferdig".
//   - dot     — Plain colored circle, no children. Use as a
//                notification-presence indicator on top of an
//                avatar / icon / nav item.
//
// Variants reuse the accent palette established for Button. Text on
// every variant is `text-ink-contrast` so a single design choice
// (the ink/ink-contrast invariant from Button) carries across every
// accent surface and stays correct in both themes.

import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

export type BadgeVariant = 'mint' | 'cyan' | 'amber' | 'coral' | 'rose';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Accent color. Required — there is no semantically-neutral default. */
  variant: BadgeVariant;
  /** Badge content (text, number, ikon). Ignored when `dot` is true. */
  children?: ReactNode;
  /** When true, renders a plain coloured circle without children. */
  dot?: boolean;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  mint: 'bg-mint text-ink-contrast',
  cyan: 'bg-cyan text-ink-contrast',
  amber: 'bg-amber text-ink-contrast',
  coral: 'bg-coral text-ink-contrast',
  rose: 'bg-rose text-ink-contrast',
};

const PILL_CLASSES = [
  'inline-flex items-center justify-center',
  'rounded-pill',
  'px-2 py-0.5',
  'font-body font-medium text-meta',
].join(' ');

const DOT_CLASSES = ['inline-block', 'h-2 w-2', 'rounded-full'].join(' ');

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant, children, dot = false, className, ...rest },
  ref
): JSX.Element {
  if (dot) {
    const cls = [DOT_CLASSES, VARIANT_CLASSES[variant], className].filter(Boolean).join(' ');
    return <span ref={ref} aria-hidden="true" className={cls} {...rest} />;
  }
  const cls = [PILL_CLASSES, VARIANT_CLASSES[variant], className].filter(Boolean).join(' ');
  return (
    <span ref={ref} className={cls} {...rest}>
      {children}
    </span>
  );
});
