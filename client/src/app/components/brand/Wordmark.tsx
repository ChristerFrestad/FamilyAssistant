// Sprint 10 — wordmark component.
//
// Renders APP_NAME_PRIMARY + APP_NAME_ACCENT with brand-color split.
// Pulls from useBrandConfig() so every consumer sees the same brand
// without prop-drilling. While the hook is still loading (cold-load,
// first paint), the component renders an invisible width-reserved
// placeholder so the layout doesn't shift when the real wordmark
// resolves — better than rendering "FamilyAssistant" briefly for a
// Hverdagsplanleggeren-deploy.
//
// Use cases:
//   - AppShell logo / "back to home" link
//   - Welcome / Login splash heading
//   - Footer attribution
//
// For pure-text contexts (browser title, meta-tags) reach for
// `useBrandConfig().config?.appName` directly instead of rendering
// this component.

import { useBrandConfig } from '../../hooks/useBrandConfig';

export type WordmarkSize = 'sm' | 'md' | 'lg' | 'xl';
export type WordmarkVariant = 'light' | 'dark';

export interface WordmarkProps {
  size?: WordmarkSize;
  variant?: WordmarkVariant;
  className?: string;
}

const SIZE_MAP: Record<
  WordmarkSize,
  { fontSize: number; letterSpacing: string; minWidth: number }
> = {
  sm: { fontSize: 18, letterSpacing: '-0.3px', minWidth: 90 },
  md: { fontSize: 26, letterSpacing: '-0.5px', minWidth: 130 },
  lg: { fontSize: 38, letterSpacing: '-1px', minWidth: 190 },
  xl: { fontSize: 56, letterSpacing: '-1.5px', minWidth: 280 },
};

const VARIANT_COLORS: Record<WordmarkVariant, { primary: string; accent: string }> = {
  // light: dark mark on light surface (default app chrome)
  light: { primary: 'var(--brand-primary, #1F3F26)', accent: 'var(--brand-accent, #5F8B5C)' },
  // dark: light mark on dark surface (dark-mode header / splash)
  dark: { primary: 'var(--brand-cream, #F7F3E8)', accent: 'var(--brand-dark-accent, #9BC59A)' },
};

export function Wordmark({
  size = 'md',
  variant = 'light',
  className,
}: WordmarkProps): JSX.Element {
  const { config } = useBrandConfig();
  const { fontSize, letterSpacing, minWidth } = SIZE_MAP[size];
  const { primary, accent } = VARIANT_COLORS[variant];

  // Cold-load: reserve space without rendering text. aria-hidden so
  // screen readers don't announce a blank, and an aria-label on the
  // outer span when config arrives gives the full read-back.
  if (!config) {
    return (
      <span
        aria-hidden="true"
        data-testid="wordmark-skeleton"
        className={className}
        style={{
          display: 'inline-block',
          minWidth: `${minWidth}px`,
          height: `${fontSize}px`,
        }}
      />
    );
  }

  return (
    <span
      className={className}
      data-testid="wordmark"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: `${fontSize}px`,
        fontWeight: 500,
        letterSpacing,
        color: primary,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
      aria-label={`${config.namePrimary}${config.nameAccent}`}
    >
      {config.namePrimary}
      <span style={{ color: accent }}>{config.nameAccent}</span>
    </span>
  );
}
