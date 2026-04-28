// Base Button — every action surface in the v2 frontend lands on this
// component. It is design-token-aware: colors, radius, focus ring, and
// disabled styling all resolve through Tailwind utilities that read CSS
// variables from client/src/app/styles/tokens.css. Toggling the theme
// (light / dark / system) re-themes every button instantly without any
// state change here.
//
// Variants:
//   - primary   — Solid mint. Dominant action on a screen.
//   - secondary — Glass surface. Paired actions next to a primary.
//   - ghost     — Transparent. Low-emphasis actions inside cards.
//
// Sizes (sm | md | lg) keep touch targets comfortable on mobile.
//
// Loading state swaps the left slot for an inline spinner, sets
// aria-busy, and disables the button so consumers do not have to pair
// `disabled` and `loading` themselves. Children stay visible so the
// action label remains readable.

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to 'primary'. */
  variant?: ButtonVariant;
  /** Padding and text-size scale. Defaults to 'md'. */
  size?: ButtonSize;
  /**
   * Optional icon shown before the label. Replaced by a spinner when
   * `loading` is true so the layout does not jump.
   */
  leftIcon?: ReactNode;
  /**
   * Optional icon shown after the label. Hidden while loading so the
   * spinner stays the only motion in the button.
   */
  rightIcon?: ReactNode;
  /**
   * When true, swaps the left slot for a spinner and disables click
   * interaction. The label remains visible.
   */
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-mint text-ink hover:bg-mint-deep',
  secondary: 'bg-surface text-text-1 hover:bg-surface-strong',
  ghost: 'bg-transparent text-text-1 hover:bg-surface',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-meta gap-1.5',
  md: 'px-4 py-2 text-body gap-2',
  lg: 'px-6 py-3 text-body gap-2',
};

// Static base classes shared across every variant. Theme transitions
// (background-color, color) are inherited from the global rule in
// tokens.css, so we do not duplicate them here.
const BASE_CLASSES = [
  'inline-flex items-center justify-center',
  'font-body font-medium',
  'rounded-md',
  // Visible focus ring on keyboard nav only (focus-visible). The ring
  // offset uses canvas-0 so the gap between button and ring matches
  // the page background under both themes.
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leftIcon,
    rightIcon,
    loading = false,
    disabled,
    type = 'button',
    className,
    children,
    'aria-busy': ariaBusyProp,
    ...rest
  },
  ref
): JSX.Element {
  const isDisabled = disabled || loading;
  const cls = [BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={ariaBusyProp ?? loading}
      className={cls}
      {...rest}
    >
      {loading ? <Spinner size={size} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

// Inline CSS spinner. Keeps the bundle dependency-free — Tailwind's
// built-in `animate-spin` keyframe drives the rotation. Border colors
// use `border-current` so the spinner inherits the button's text color
// and re-themes automatically.
function Spinner({ size }: { size: ButtonSize }): JSX.Element {
  const dim = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block ${dim} rounded-full border-2 border-current border-t-transparent animate-spin`}
    />
  );
}
