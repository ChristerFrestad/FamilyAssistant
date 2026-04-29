// Production-ready three-state theme toggle (system / light / dark).
//
// Token contract: the global tokens.css resolves --canvas-*, --text-*,
// --mint, etc. against the [data-theme] attribute on <html>. Setting
// data-theme="dark" forces dark even when the OS prefers light, and
// vice versa for data-theme="light". Removing the attribute lets the
// `prefers-color-scheme` @media block in tokens.css decide.
//
// Persistence uses localStorage under `fa:theme`. The choice is read
// synchronously on mount so the first paint already matches the
// stored preference rather than briefly flashing the system default.
//
// A near-identical component exists in dev/preview/sections/ — that
// version uses a different localStorage key (`fa:dev-preview:theme`)
// so the preview page's theme setting does not bleed into the live
// app. We deliberately accept a small amount of duplication to keep
// the dev/ → app/ import boundary clean (see CLAUDE.md DEL 7.7).

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'fa:theme';

function readPersisted(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // localStorage may be unavailable in private mode — fall through.
  }
  return 'system';
}

function applyTheme(choice: ThemeChoice): void {
  const html = document.documentElement;
  if (choice === 'system') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', choice);
  }
}

export interface ThemeToggleProps {
  /** Optional class on the wrapper. */
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps): JSX.Element {
  const { t } = useTranslation('common');
  const [choice, setChoice] = useState<ThemeChoice>(() => readPersisted());

  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Persistence failure is non-blocking — the in-memory state
      // still drives data-theme correctly for the current session.
    }
  }, [choice]);

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
