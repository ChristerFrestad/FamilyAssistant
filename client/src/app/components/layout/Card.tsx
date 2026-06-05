// Container surface used everywhere a screen needs a visual chunk —
// hero meal card, settings panel, modal interior, etc. Token-driven:
// surfaces resolve through bg-surface / bg-surface-strong, shadows
// through shadow-low/-mid/-high (see tokens.css). Theme switching
// re-themes every Card instantly because every utility expands to
// a CSS variable.
//
// Variants:
//   - default — Bg-surface (light translucent over canvas).
//   - strong  — Bg-surface-strong (more opaque, used when contrast
//               against the canvas matters more than glass effect).
//   - glass   — Bg-surface + backdrop-blur-md, the classic
//               glass-morphism look. Use sparingly; it requires
//               browser GPU support and adds visual noise on top
//               of busy backgrounds.
//
// padding=none exists so callers whose children handle their own
// padding (e.g. a list of full-bleed rows) do not have to fight
// the default.
//
// border defaults to true because the mockup's surface tones sit
// close enough to the canvas that a hairline border is what makes
// a Card look like a Card and not a flat background section. Pass
// border={false} for full-bleed variants.

import type { JSX } from 'react';
import { type HTMLAttributes, forwardRef } from 'react';

export type CardVariant = 'default' | 'strong' | 'glass';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardShadow = 'none' | 'low' | 'mid' | 'high';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Surface background style. Defaults to 'default'. */
  variant?: CardVariant;
  /** Inner padding scale. Defaults to 'md'. Use 'none' when children handle their own padding. */
  padding?: CardPadding;
  /** Whether to render the hairline border-stroke. Defaults to true. */
  border?: boolean;
  /** Drop-shadow elevation. Defaults to 'none'. */
  shadow?: CardShadow;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'bg-surface',
  strong: 'bg-surface-strong',
  glass: 'bg-surface backdrop-blur-md',
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const SHADOW_CLASSES: Record<CardShadow, string> = {
  none: '',
  low: 'shadow-low',
  mid: 'shadow-mid',
  high: 'shadow-high',
};

// rounded-lg matches --radius-lg = 16 px from tokens.css. Cards
// that need different corners (hero card uses rounded-2xl) override
// via className.
const BASE_CLASSES = 'rounded-lg';

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = 'default',
    padding = 'md',
    border = true,
    shadow = 'none',
    className,
    children,
    ...rest
  },
  ref
): JSX.Element {
  const cls = [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    PADDING_CLASSES[padding],
    border ? 'border border-stroke' : '',
    SHADOW_CLASSES[shadow],
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
