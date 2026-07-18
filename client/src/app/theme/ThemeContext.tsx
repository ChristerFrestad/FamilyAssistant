// Shared theme state for the v2 frontend.
//
// Bug context: ThemeToggle previously kept its own useState, so the
// AppShell-header instance and the Settings-screen instance ran on
// separate state. Clicking one updated localStorage + the document's
// data-theme attribute, but the other instance's button highlight
// stayed on its old value. This Context lifts theme to a single
// source of truth so every consumer re-renders together.
//
// Persistence still uses localStorage 'fa:theme' so the choice
// survives reloads. The provider reads it on mount and applies it
// to <html data-theme=...> immediately. When the user picks a new
// theme, we write to localStorage AND broadcast the new value to
// all consumers via Context.
//
// We use a small custom hook (useTheme) so consumer components do
// not have to import the context object directly. The hook throws
// when used outside a ThemeProvider — same pattern as AuthContext.

import type { JSX } from 'react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

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
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (choice === 'system') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', choice);
  }
}

export interface ThemeContextValue {
  choice: ThemeChoice;
  setChoice: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Test-only override: skip localStorage read on mount. */
  initialChoice?: ThemeChoice;
}

export function ThemeProvider({ children, initialChoice }: ThemeProviderProps): JSX.Element {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => initialChoice ?? readPersisted());

  // Apply on mount and on every change. localStorage write is best-
  // effort: a failing setItem (private mode quota, e.g.) does not
  // block the in-memory state from driving data-theme correctly.
  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* persistence is best-effort */
    }
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice): void => {
    setChoiceState(next);
  }, []);

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
