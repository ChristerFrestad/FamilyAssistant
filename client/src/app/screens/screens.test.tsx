// Light tests for leftover Phase-1d screens that are still placeholders.
// Real screens have their own dedicated files (see comments below).

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter } from 'react-router';
import { NotFound } from './NotFound';
import { Login } from './auth/Login';
import { AuthProvider } from '../auth/AuthContext';

// Settings moved out when the real Phase-2F screen landed (Fase 2F
// Settings). Real Settings behavior tests live in Settings.test.tsx
// — they cover skeleton/error states, the four sections, family
// name inline-edit (owner-only), GDPR export download flow, and
// owner-blocked delete state.

// Dashboard moved out of this file when the real Phase-2A screen
// landed (PR-#? Fase 2A). Real Dashboard behavior tests live in
// Dashboard.test.tsx — they cover loading/empty/error per card,
// retry, and quick-actions navigation.
//
// Family moved out when the real Phase-2B screen landed
// (Fase 2B Family). Real Family behavior tests live in
// Family.test.tsx — they cover skeleton/error/data states,
// (Du)-badge, placeholder buttons, optimistic portion update,
// rollback on PUT failure, single-member hint, and child-viewer
// disabled state.
//
// Meals moved out when the real Phase-2C screen landed
// (Fase 2C Meals). Real Meals behavior tests live in
// Meals.test.tsx — they cover skeleton/error/data states,
// day-strip selection, hero variants (away/skipped/empty/recipe),
// scaled ingredients, defensive scaling-unavailable handling, and
// the swap/plan placeholder buttons.
//
// Shopping moved out when the real Phase-2D screen landed
// (Fase 2D Shopping). Real Shopping behavior tests live in
// Shopping.test.tsx — they cover skeleton/error/empty/data states,
// optimistic toggle/delete with rollback, QuickAdd flow,
// generate-from-meals + WEEK_NOT_COMPLETE branch, and toast.
//
// Calendar moved out when the local family-events screen landed
// (G0-3). Real Calendar behavior tests live in Calendar.test.tsx —
// they cover heading, empty/list/error, adult add/delete, and
// child read-only.

describe('placeholder screens render with i18n headings', () => {
  test('NotFound has 404 heading and a Dashboard link', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: '404', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  test('Login renders heading and a loading status', () => {
    // Password-first Login (2026-08-07) uses auth:password.loginTitle
    // ("Logg inn" / "Sign in"). Wrap in MemoryRouter + AuthProvider
    // so the form mounts without a /api/auth/me round-trip.
    render(
      <MemoryRouter>
        <AuthProvider initialState={{ user: null, isLoading: false }}>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: 'Logg inn', level: 1 })).toBeInTheDocument();
  });
});
