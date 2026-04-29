// Tests for LanguageSwitcher.
//
// The shared test-setup forces i18n to Norwegian before every test,
// so we can assert that the NO button starts pressed and that
// clicking EN flips both i18n.language and the visible active state.
// localStorage persistence is verified by reading the storage key
// directly after the click.

import { render, screen, fireEvent } from '@testing-library/react';
import { test, expect, beforeEach } from 'vitest';
import i18n from '../../i18n/config';
import { LanguageSwitcher } from './LanguageSwitcher';

beforeEach(() => {
  // The cross-cutting setup already calls changeLanguage('no') in
  // its beforeEach, but localStorage state can leak between tests
  // since the i18next-browser-languagedetector writes to it on
  // every change. Wipe the persistence key so each test starts
  // from a clean baseline.
  window.localStorage.removeItem('fa:language');
});

test('renders NO and EN buttons grouped under an aria-label', () => {
  render(<LanguageSwitcher />);
  const group = screen.getByRole('group', { name: 'Språk' });
  expect(group).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'NO' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument();
});

test('NO is pressed when the active language is Norwegian', () => {
  render(<LanguageSwitcher />);
  expect(screen.getByRole('button', { name: 'NO' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
});

test('clicking EN switches i18n.language to en', () => {
  render(<LanguageSwitcher />);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(i18n.language).toMatch(/^en/);
});

test('clicking EN persists the choice to localStorage under fa:language', () => {
  render(<LanguageSwitcher />);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(window.localStorage.getItem('fa:language')).toBe('en');
});

test('clicking the already-active language is a no-op', () => {
  render(<LanguageSwitcher />);
  // i18n is on 'no' from setup. Clicking NO should not change anything.
  const lngBefore = i18n.language;
  fireEvent.click(screen.getByRole('button', { name: 'NO' }));
  expect(i18n.language).toBe(lngBefore);
});

test('switcher updates own pressed state after a language change', () => {
  render(<LanguageSwitcher />);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  // After the change, EN should now be pressed and NO unpressed.
  expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'NO' })).toHaveAttribute('aria-pressed', 'false');
});
