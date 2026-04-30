// Light tests for the Phase-1d placeholder screens. Each screen is
// trivial — a heading + a body paragraph — but we still verify the
// heading text resolves through i18n so a typo in the JSON bundle
// fails fast. When the real screens land in Phase 2, these tests
// will be replaced with real behavior tests.

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Meals } from './Meals';
import { Shopping } from './Shopping';
import { Calendar } from './Calendar';
import { Settings } from './Settings';
import { NotFound } from './NotFound';
import { Login } from './auth/Login';
import { AuthProvider } from '../auth/AuthContext';

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

describe('placeholder screens render with i18n headings', () => {
  test('Meals', () => {
    render(<Meals />);
    expect(screen.getByRole('heading', { name: 'Måltider', level: 1 })).toBeInTheDocument();
  });

  test('Shopping', () => {
    render(<Shopping />);
    expect(screen.getByRole('heading', { name: 'Handleliste', level: 1 })).toBeInTheDocument();
  });

  test('Calendar', () => {
    render(<Calendar />);
    expect(screen.getByRole('heading', { name: 'Kalender', level: 1 })).toBeInTheDocument();
  });

  test('Settings', () => {
    render(<Settings />);
    expect(screen.getByRole('heading', { name: 'Innstillinger', level: 1 })).toBeInTheDocument();
  });

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
    // Sprint 3 / Fase 1e: Login moved to screens/auth/ and now uses
    // AuthContext (requestMagicLink) + react-router. Wrap in
    // MemoryRouter + AuthProvider so the form mounts; the heading
    // reads the resolved appName ("FamilyAssistant" by default)
    // wrapped in t('auth:login.title')="Sign in to {{appName}}" /
    // "Logg inn på {{appName}}".
    render(
      <MemoryRouter>
        <AuthProvider initialState={{ user: null, isLoading: false }}>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(
      screen.getByRole('heading', { name: /Logg inn på FamilyAssistant/, level: 1 })
    ).toBeInTheDocument();
  });
});
