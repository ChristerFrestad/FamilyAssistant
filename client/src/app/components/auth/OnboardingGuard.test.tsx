// Tests for OnboardingGuard.
//
// Mirrors AuthGuard's test structure: vi.mock the useAuth hook so
// each test sets the desired auth state, then asserts on whether
// the children render or a redirect lands on /onboarding/family.

import { render, screen } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe('OnboardingGuard render branches', () => {
  test('renders children while isLoading=true (defers to AuthGuard)', () => {
    setAuthState({ user: null, isLoading: true });
    renderGuard();
    expect(screen.getByTestId('protected')).toBeInTheDocument();
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

  test('redirects when user is null (defensive — AuthGuard normally catches this first)', () => {
    setAuthState({ user: null, isLoading: false });
    renderGuard();
    expect(screen.getByTestId('onboarding')).toBeInTheDocument();
  });
});
