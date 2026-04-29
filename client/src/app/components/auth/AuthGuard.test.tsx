// Tests for AuthGuard.
//
// The Phase-1d mock useAuth always returns isAuthenticated=true, so
// the redirect path is awkward to exercise without a hook spy.
// `vi.mock` of the hook module gives us a knob: each test sets the
// returned shape, mounts AuthGuard, and asserts on the resulting
// route render.
//
// We mount inside MemoryRouter so the redirect lands on a navigable
// location instead of throwing. A `*` route catches whatever URL
// AuthGuard's <Navigate> picks so the test can verify the router
// followed through.

import { render, screen } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';

const useAuthMock = vi.fn();

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

function setAuthState(state: { isAuthenticated: boolean; isLoading: boolean }): void {
  useAuthMock.mockReturnValue({
    user: state.isAuthenticated ? { name: 'Test User' } : null,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
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
            <AuthGuard>
              <div data-testid="protected-content">Hemmelig</div>
            </AuthGuard>
          }
        />
        <Route path="/login" element={<div data-testid="login-screen">Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe('AuthGuard render branches', () => {
  test('renders the loading view while auth is in flight', () => {
    setAuthState({ isAuthenticated: false, isLoading: true });
    renderGuard();
    // The loading view uses role=status with the i18n loading text.
    expect(screen.getByRole('status')).toHaveTextContent('Laster...');
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  test('redirects to /login when not authenticated', () => {
    setAuthState({ isAuthenticated: false, isLoading: false });
    renderGuard();
    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  test('renders children when authenticated', () => {
    setAuthState({ isAuthenticated: true, isLoading: false });
    renderGuard();
    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
  });

  test('respects a custom redirectTo path', () => {
    setAuthState({ isAuthenticated: false, isLoading: false });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AuthGuard redirectTo="/welcome">
                <div data-testid="protected-content">Hemmelig</div>
              </AuthGuard>
            }
          />
          <Route path="/welcome" element={<div data-testid="welcome-screen">Welcome</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
  });
});
