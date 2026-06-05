import type { JSX } from 'react';
import { useEffect, useState } from 'react';

// Three states match the locked theme contract in
// design/2026-04-redesign/extracted/locked-decisions.md section 4.5:
// - 'system' removes the data-theme attribute and lets the CSS @media
//   (prefers-color-scheme) rule pick light or dark from the OS.
// - 'light' / 'dark' set the attribute explicitly; the CSS overrides
//   in tokens.css then win over the system preference.
type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'fa:dev-preview:theme';

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

export default function ThemeToggle(): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => readPersisted());

  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Fail-quiet: persistence is a nice-to-have for the preview.
    }
  }, [choice]);

  const choices: Array<{ value: ThemeChoice; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex gap-1 p-1 rounded-pill bg-surface border border-stroke"
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
                ? 'rounded-pill px-4 py-2 text-meta tracking-wide font-body bg-ink text-ink-contrast'
                : 'rounded-pill px-4 py-2 text-meta tracking-wide font-body text-text-2'
            }
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
