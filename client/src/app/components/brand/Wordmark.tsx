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

// Per-size metrics. Christer's verification flagged that a hardcoded
// minWidth lies about the actual brand width — "FamilyAssistant" at
// md=26px is roughly 195px, "Hverdagsplanleggeren" is roughly 260px.
// Reserving a fixed 130px placeholder either oversizes the FOUC for
// short brands or under-reserves for long ones, both visually wrong.
//
// Cold-load behaviour now: we reserve VERTICAL space (so the header
// row keeps its height) but allow the horizontal slot to collapse to
// zero. Layout shift on wordmark-arrival happens horizontally only;
// the items to the right of the wordmark slide once when config
// resolves. Better than rendering the wrong brand or pretending we
// know the eventual width.
const SIZE_MAP: Record<WordmarkSize, { fontSize: number; letterSpacing: string }> = {
  sm: { fontSize: 18, letterSpacing: '-0.3px' },
  md: { fontSize: 26, letterSpacing: '-0.5px' },
  lg: { fontSize: 38, letterSpacing: '-1px' },
  xl: { fontSize: 56, letterSpacing: '-1.5px' },
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
  const { fontSize, letterSpacing } = SIZE_MAP[size];
  const { primary, accent } = VARIANT_COLORS[variant];

  // Cold-load: reserve VERTICAL space only (so the header row keeps
  // its height during the brief fetch window). Horizontal width is
  // unknown — we don't fake a width because every brand has a
  // different actual wordmark length. aria-hidden keeps screen
  // readers from announcing a blank.
  if (!config) {
    return (
      <span
        aria-hidden="true"
        data-testid="wordmark-skeleton"
        className={className}
        style={{
          display: 'inline-block',
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
