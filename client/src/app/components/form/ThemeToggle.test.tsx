// Tests for ThemeToggle.
//
// We verify both the runtime side-effects (data-theme attribute,
// localStorage) and the rendered ARIA contract. The component reads
// the persisted choice synchronously on mount, so each test has to
// reset localStorage AND the data-theme attribute up front.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, describe, beforeEach } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  window.localStorage.removeItem('fa:theme');
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle structure', () => {
  test('renders a radiogroup with three options', () => {
    render(<ThemeToggle />);
    const group = screen.getByRole('radiogroup', { name: 'Tema' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => r.textContent)).toEqual(['System', 'Lys', 'Mørk']);
  });

  test('System is checked by default', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ThemeToggle behavior', () => {
  test('clicking Light sets data-theme="light" and persists', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('radio', { name: 'Lys' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('fa:theme')).toBe('light');
  });

  test('clicking Dark sets data-theme="dark" and persists', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('radio', { name: 'Mørk' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('fa:theme')).toBe('dark');
  });

  test('clicking System removes the data-theme attribute', () => {
    render(<ThemeToggle />);
    // Start on Dark, then return to System.
    fireEvent.click(screen.getByRole('radio', { name: 'Mørk' }));
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('fa:theme')).toBe('system');
  });

  test('reads persisted choice on mount', () => {
    window.localStorage.setItem('fa:theme', 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'Mørk' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
