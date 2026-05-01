// State synchronisation regression tests for shared UI state.
//
// Phase 3A WCAG audit (Prompt 12.7) called out a class of bug: state
// that lives in two places falls out of sync when one place updates.
// The Sprint-5 ThemeToggle bug was the canonical example — fixed by
// lifting state to ThemeContext, with a regression test in
// ThemeToggle.test.tsx.
//
// This file extends the same idea to the other shared-state surfaces:
//
//   - Theme        : already covered by ThemeToggle.test.tsx (kept link
//                    here for documentation; not duplicated)
//   - Language     : i18next is already a singleton — multiple
//                    LanguageSwitcher instances share state via the
//                    shared i18n object. Test below confirms.
//   - Auth user    : AuthContext is the single source. Tested in
//                    AuthContext.test.tsx via the AuthProvider state.
//
// Adding new shared state? Add a regression test here so a future
// "I'll just useState locally" change cannot bypass the lesson.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageSwitcher } from './form/LanguageSwitcher';
import i18n from '../i18n/config';

beforeEach(() => {
  // Default language for tests is 'no' (test-setup.ts). Reset on each
  // test so the previous test's switch does not leak into this one.
  void i18n.changeLanguage('no');
});

afterEach(() => {
  void i18n.changeLanguage('no');
});

describe('LanguageSwitcher synchronisation across instances', () => {
  // Regression test: two LanguageSwitcher instances on the same page
  // (e.g. AppShell-header + Settings-screen) must reflect the same
  // active language. i18next is a singleton, so this should hold by
  // construction — the test guards against a future refactor that
  // accidentally puts language state in component-local useState.
  test('two instances reflect a language change in either', () => {
    render(
      <>
        <LanguageSwitcher />
        <LanguageSwitcher />
      </>
    );

    // Both groups exist with NO and EN buttons each.
    const groups = screen.getAllByRole('group', { name: /Språk|Language/i });
    expect(groups).toHaveLength(2);

    // NO is active in both initially (test-setup.ts forces 'no').
    const noButtons = screen.getAllByRole('button', { name: 'NO' });
    expect(noButtons).toHaveLength(2);
    expect(noButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(noButtons[1]?.getAttribute('aria-pressed')).toBe('true');

    // Click EN in the first group.
    const enButtons = screen.getAllByRole('button', { name: 'EN' });
    fireEvent.click(enButtons[0]!);

    // Both groups should now have EN pressed and NO unpressed.
    const refetchedEn = screen.getAllByRole('button', { name: 'EN' });
    const refetchedNo = screen.getAllByRole('button', { name: 'NO' });
    expect(refetchedEn[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(refetchedEn[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(refetchedNo[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(refetchedNo[1]?.getAttribute('aria-pressed')).toBe('false');
  });
});
