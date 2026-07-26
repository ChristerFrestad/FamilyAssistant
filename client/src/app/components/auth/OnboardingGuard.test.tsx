// Tests for OnboardingGuard.
//
// Mirrors AuthGuard's test structure: vi.mock the useAuth hook so
// each test sets the desired auth state, then asserts on whether
// the children render or a redirect lands on /onboarding/family.

import { render, screen } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { OnboardingGuard } from './OnboardingGuard';
import type { AuthUser } from '../../auth/authApi';

const useAuthMock = vi.fn();

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

function buildUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 1,
    email: 'x@example.com',
    name: 'X',
    role: 'adult',
    avatarUrl: null,
    familyId: 1,
    profileMemberId: null,
    onboardingCompleted: false,
    synthetic: false,
    ...overrides,
  };
}

function setAuthState(state: { user: AuthUser | null; isLoading: boolean }): void {
  useAuthMock.mockReturnValue({
    user: state.user,
    isLoading: state.isLoading,
    isAuthenticated: state.user !== null && !state.isLoading,
    logout: () => undefined,
  });
}

function renderGuard(initialPath = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/"
          element={
            <OnboardingGuard>
              <div data-testid="protected">main app</div>
            </OnboardingGuard>
          }
        />
        <Route path="/onboarding/family" element={<div data-testid="onboarding">onboarding</div>} />
        <Route path="/login" element={<div data-testid="login">login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe('OnboardingGuard render branches', () => {
  test('renders the loading shell while isLoading=true (does NOT flash protected content)', () => {
    // PR #77 hotfix: the original implementation rendered children
    // during isLoading on the assumption that AuthGuard upstream
    // had already caught that case. That assumption is fine in
    // production routing but breaks any standalone use, so the
    // guard now renders its own loading view — same role=status
    // pattern as AuthGuard.
    setAuthState({ user: null, isLoading: true });
    renderGuard();
    expect(screen.getByRole('status')).toHaveTextContent('Laster...');
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });

  test('redirects to /onboarding/family when user has not completed onboarding', () => {
    setAuthState({ user: buildUser({ onboardingCompleted: false }), isLoading: false });
    renderGuard();
    expect(screen.getByTestId('onboarding')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  test('renders children when onboarding is completed', () => {
    setAuthState({ user: buildUser({ onboardingCompleted: true }), isLoading: false });
    renderGuard();
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument();
  });

  test('redirects to /login when user is null (NOT to onboarding)', () => {
    // PR #77 hotfix: previously OnboardingGuard sent unauthenticated
    // visitors to /onboarding/family — which itself wraps in
    // AuthGuard and bounces back to /login, but the detour was
    // wrong. Now the unauthenticated branch sends them straight to
    // /login, which is the actual destination AuthGuard would have
    // picked anyway.
    setAuthState({ user: null, isLoading: false });
    renderGuard();
    expect(screen.getByTestId('login')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  test('respects a custom unauthenticatedRedirectTo path', () => {
    setAuthState({ user: null, isLoading: false });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <OnboardingGuard unauthenticatedRedirectTo="/welcome">
                <div data-testid="protected">main app</div>
              </OnboardingGuard>
            }
          />
          <Route path="/welcome" element={<div data-testid="welcome">welcome</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('welcome')).toBeInTheDocument();
  });
});
