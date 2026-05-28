// Production-ready three-state theme toggle (system / light / dark).
//
// Token contract: the global tokens.css resolves --canvas-*, --text-*,
// --mint, etc. against the [data-theme] attribute on <html>. Setting
// data-theme="dark" forces dark even when the OS prefers light, and
// vice versa for data-theme="light". Removing the attribute lets the
// `prefers-color-scheme` @media block in tokens.css decide.
//
// State is owned by ThemeProvider (../theme/ThemeContext) so multiple
// instances of ThemeToggle (one in the AppShell header, one in the
// Settings screen) stay in sync. Earlier the component carried its
// own useState, which broke synchronisation between the two surfaces.
//
// A near-identical component exists in dev/preview/sections/ — that
// version uses a different localStorage key (`fa:dev-preview:theme`)
// so the preview page's theme setting does not bleed into the live
// app. We deliberately accept a small amount of duplication to keep
// the dev/ → app/ import boundary clean (see AGENTS.md DEL 7.7).

import { useTranslation } from 'react-i18next';
import { useTheme, type ThemeChoice } from '../../theme/ThemeContext';

export interface ThemeToggleProps {
  /** Optional class on the wrapper. */
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps): JSX.Element {
  const { t } = useTranslation('common');
  const { choice, setChoice } = useTheme();

  // Order matches the dev preview's variant for visual consistency:
  // System first (the default), then Light, then Dark. This matters
  // because the radiogroup is keyboard-navigable left-to-right and
  // a user who tabs in expects the same flow as the preview page.
  const choices: Array<{ value: ThemeChoice; label: string }> = [
    { value: 'system', label: t('theme.system') },
    { value: 'light', label: t('theme.light') },
    { value: 'dark', label: t('theme.dark') },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      className={['inline-flex gap-1 p-1 rounded-pill bg-surface border border-stroke', className]
        .filter(Boolean)
        .join(' ')}
    >
      {choices.map((item) => {
        const active = item.value === choice;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setChoice(item.value)}
            className={
              active
                ? 'rounded-pill px-3 py-1 text-meta tracking-wide font-body bg-ink text-ink-contrast'
                : 'rounded-pill px-3 py-1 text-meta tracking-wide font-body text-text-2'
            }
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
