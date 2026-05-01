// Tests for ThemeToggle.
//
// We verify both the runtime side-effects (data-theme attribute,
// localStorage) and the rendered ARIA contract. State now lives in
// ThemeProvider (../theme/ThemeContext) so each test must mount
// ThemeToggle inside a provider; the provider reads the persisted
// choice synchronously on mount.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, beforeEach } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider } from '../../theme/ThemeContext';

beforeEach(() => {
  window.localStorage.removeItem('fa:theme');
  document.documentElement.removeAttribute('data-theme');
});

function renderWithProvider(): void {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

describe('ThemeToggle structure', () => {
  test('renders a radiogroup with three options', () => {
    renderWithProvider();
    const group = screen.getByRole('radiogroup', { name: 'Tema' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => r.textContent)).toEqual(['System', 'Lys', 'Mørk']);
  });

  test('System is checked by default', () => {
    renderWithProvider();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ThemeToggle behavior', () => {
  test('clicking Light sets data-theme="light" and persists', () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole('radio', { name: 'Lys' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('fa:theme')).toBe('light');
  });

  test('clicking Dark sets data-theme="dark" and persists', () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole('radio', { name: 'Mørk' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('fa:theme')).toBe('dark');
  });

  test('clicking System removes the data-theme attribute', () => {
    renderWithProvider();
    // Start on Dark, then return to System.
    fireEvent.click(screen.getByRole('radio', { name: 'Mørk' }));
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('fa:theme')).toBe('system');
  });

  test('reads persisted choice on mount', () => {
    window.localStorage.setItem('fa:theme', 'dark');
    renderWithProvider();
    expect(screen.getByRole('radio', { name: 'Mørk' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('ThemeToggle synchronisation across instances', () => {
  // Regression test: this is the bug Christer reported on Phase 2F.
  // Two ThemeToggle instances under the same ThemeProvider must
  // reflect the same active state. Before ThemeContext lifted the
  // state, each instance kept its own useState, so clicking one did
  // not update the other's button highlight.
  test('two instances under one provider share state', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeToggle />
      </ThemeProvider>
    );

    // Both groups exist.
    const groups = screen.getAllByRole('radiogroup', { name: 'Tema' });
    expect(groups).toHaveLength(2);

    // Click "Mørk" in the first group.
    const allDarkButtons = screen.getAllByRole('radio', { name: 'Mørk' });
    expect(allDarkButtons).toHaveLength(2);
    fireEvent.click(allDarkButtons[0]!);

    // Both instances should now have aria-checked='true' on Mørk.
    const refetchedDark = screen.getAllByRole('radio', { name: 'Mørk' });
    expect(refetchedDark[0]?.getAttribute('aria-checked')).toBe('true');
    expect(refetchedDark[1]?.getAttribute('aria-checked')).toBe('true');

    // And the System buttons should both be unchecked.
    const refetchedSystem = screen.getAllByRole('radio', { name: 'System' });
    expect(refetchedSystem[0]?.getAttribute('aria-checked')).toBe('false');
    expect(refetchedSystem[1]?.getAttribute('aria-checked')).toBe('false');
  });
});
