// Tests for AppShell.
//
// AppShell composes 5+ children (header, ThemeToggle, LanguageSwitcher,
// UserMenu, SideNav, BottomNav). The unit test verifies the *shape*:
// landmark roles, the presence of each child, and that {children} is
// rendered inside <main>. Behavior of each individual child is
// covered in its own test file.

import { render, screen } from '@testing-library/react';
import { test, expect, describe } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AppShell } from './AppShell';
import { AuthProvider } from '../../auth/AuthContext';
import { ThemeProvider } from '../../theme/ThemeContext';
import type { AuthUser } from '../../auth/authApi';

// AppShell's UserMenu reads useAuthContext, so we need an
// AuthProvider wrapper. We pass initialState with a known user so
// the trigger renders deterministically — no live /me call.
const TEST_USER: AuthUser = {
  id: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'adult',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
};

function renderShell(pathname = '/dashboard'): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <ThemeProvider>
        <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
          <AppShell>
            <div data-testid="page-content">Page body</div>
          </AppShell>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('AppShell structure', () => {
  test('renders a banner role for the header', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  test('renders a main landmark with id="main-content"', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main-content');
  });

  test('renders the page body as children of <main>', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toContainElement(screen.getByTestId('page-content'));
  });

  test('renders the skip-link with the i18n target text', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Hopp til hovedinnhold' })).toBeInTheDocument();
  });

  test('renders the brand-link to /dashboard with the resolved appName', () => {
    renderShell();
    // The aria-label uses the {{appName}} interpolation, which
    // resolves to the default "FamilyAssistant" in test runs (no
    // VITE_APP_NAME override is set in the test environment).
    const link = screen.getByRole('link', { name: 'FamilyAssistant — til startsiden' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  test('renders LanguageSwitcher, BottomNav, and SideNav simultaneously', () => {
    // Both nav surfaces sit in the DOM at the same time; CSS media
    // queries decide which is visible. RTL/jsdom does not evaluate
    // media queries, so we verify that BOTH renderings exist via
    // their accessible names — even if one of them is media-hidden
    // in the actual viewport.
    renderShell();
    // LanguageSwitcher exposes a group with the Språk label.
    expect(screen.getByRole('group', { name: 'Språk' })).toBeInTheDocument();
    // BottomNav and SideNav both render <nav aria-label="Hovedmeny">.
    // getAllByRole returns both — exactly two.
    const navs = screen.getAllByRole('navigation', { name: 'Hovedmeny' });
    expect(navs.length).toBe(2);
  });

  test('renders the UserMenu trigger', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'Åpne bruker-meny' })).toBeInTheDocument();
  });

  test('main has min-w-0 to prevent flex-item overflow on mobile', () => {
    // Regression guard for hotfix/meals-mobile-layout. Without min-w-0,
    // a flex-item's default min-width: auto resolves to its children's
    // min-content, which lets fixed-width descendants (e.g. a 7-pill
    // DayStrip totalling 552px) push <body> wider than the viewport on
    // mobile. That broke BottomNav's fixed-bottom anchoring on /v2/meals.
    renderShell();
    const main = screen.getByRole('main');
    expect(main.className).toMatch(/\bmin-w-0\b/);
  });
});
