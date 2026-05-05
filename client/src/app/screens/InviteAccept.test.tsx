// Tests for InviteAccept.
//
// Exercises the five states of the accept-page state machine:
//   1. LOADING        — spinner before peek resolves
//   2. VALID_ANON     — peek OK, viewer not authenticated → "Sign in" CTA
//   3. VALID_MATCH    — peek OK, viewer authenticated, email matches → accept CTA
//   4. VALID_MISMATCH — peek OK, viewer authenticated, email differs → logout CTA
//   5. ERROR          — peek failed (404 / 410 / 409 / 5xx)
//
// The tests stub useAuthContext via vi.mock so each scenario can flip
// the auth shape independently from the peek response. The peek/accept
// API is stubbed with a fetch spy so we exercise the real
// familyInvitationsApi error-classification path.

import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { InviteAccept } from './InviteAccept';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PEEK_OK = {
  familyId: 7,
  familyName: 'Frestad',
  assignedRole: 'adult',
  inviterName: 'Christer',
  inviterEmail: 'c@test.no',
  invitedEmail: 'r@test.no',
  invitationMessage: null,
  locale: 'no',
  expiresAt: '2026-05-12 12:00:00',
};

interface MockAuth {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { email: string } | null;
}

const useAuthContextMock = vi.fn();

vi.mock('../auth/AuthContext', () => ({
  useAuthContext: () => useAuthContextMock(),
}));

function setAuth(value: MockAuth): {
  logout: ReturnType<typeof vi.fn>;
  refreshUser: ReturnType<typeof vi.fn>;
} {
  const logout = vi.fn().mockResolvedValue(undefined);
  const refreshUser = vi.fn().mockResolvedValue(undefined);
  useAuthContextMock.mockReturnValue({ ...value, logout, refreshUser });
  return { logout, refreshUser };
}

function renderAt(token: string): void {
  render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/family" element={<div data-testid="family-screen">Family screen</div>} />
        <Route path="/login" element={<div data-testid="login-screen">Login</div>} />
        <Route path="/" element={<div data-testid="home-screen">Home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  useAuthContextMock.mockReset();
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('InviteAccept · loading', () => {
  test('renders the spinner while peek is in flight', () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockReturnValueOnce(new Promise(() => undefined));
    renderAt('the-token');
    expect(screen.getByTestId('invite-loading')).toBeInTheDocument();
  });
});

describe('InviteAccept · STATE 2 (anonymous viewer)', () => {
  test('shows sign-in CTA when not authenticated', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, PEEK_OK));
    renderAt('the-token');
    await waitFor(() => expect(screen.getByTestId('invite-state-valid')).toBeInTheDocument());
    expect(screen.getByTestId('invite-login-button')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-accept-button')).not.toBeInTheDocument();
  });

  test('renders personal message when present', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { ...PEEK_OK, invitationMessage: 'Velkommen kjære!' })
    );
    renderAt('tok');
    await waitFor(() => expect(screen.getByTestId('invite-personal-message')).toBeInTheDocument());
    expect(screen.getByText('Velkommen kjære!')).toBeInTheDocument();
  });
});

describe('InviteAccept · STATE 3 (logged-in matching)', () => {
  test('shows accept CTA when emails match', async () => {
    setAuth({ isAuthenticated: true, isLoading: false, user: { email: 'r@test.no' } });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, PEEK_OK));
    renderAt('the-token');
    await waitFor(() => expect(screen.getByTestId('invite-accept-button')).toBeInTheDocument());
  });

  test('accept POSTs and navigates to /family on success', async () => {
    const { refreshUser } = setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { email: 'r@test.no' },
    });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, PEEK_OK)).mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        user: {
          id: 5,
          email: 'r@test.no',
          name: 'R',
          role: 'adult',
          familyId: 7,
          profileMemberId: null,
        },
        family: { id: 7, name: 'Frestad' },
      })
    );
    renderAt('the-token');
    await waitFor(() => expect(screen.getByTestId('invite-accept-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-accept-button'));
    await waitFor(() => expect(screen.getByTestId('family-screen')).toBeInTheDocument());
    expect(refreshUser).toHaveBeenCalled();
  });

  test('accept failure (410) renders an inline accept-error', async () => {
    setAuth({ isAuthenticated: true, isLoading: false, user: { email: 'r@test.no' } });
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, PEEK_OK))
      .mockResolvedValueOnce(jsonResponse(410, { detail: 'expired', code: 'INVITATION_EXPIRED' }));
    renderAt('the-token');
    await waitFor(() => expect(screen.getByTestId('invite-accept-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-accept-button'));
    await waitFor(() => expect(screen.getByTestId('invite-accept-error')).toBeInTheDocument());
  });
});

describe('InviteAccept · STATE 4 (wrong-email)', () => {
  test('shows wrong-email panel when authenticated user does not match', async () => {
    setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { email: 'someone-else@test.no' },
    });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, PEEK_OK));
    renderAt('the-token');
    await waitFor(() => expect(screen.getByTestId('invite-state-mismatch')).toBeInTheDocument());
    expect(screen.getByTestId('invite-logout-button')).toBeInTheDocument();
  });

  test('logout button calls auth.logout and navigates to login with redirect', async () => {
    const { logout } = setAuth({
      isAuthenticated: true,
      isLoading: false,
      user: { email: 'someone-else@test.no' },
    });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, PEEK_OK));
    renderAt('the-token');
    await waitFor(() => expect(screen.getByTestId('invite-state-mismatch')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('invite-logout-button'));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeInTheDocument());
  });
});

describe('InviteAccept · STATE 5 (error)', () => {
  test('renders not-found panel on 404', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(jsonResponse(404, { detail: 'gone' }));
    renderAt('missing-token');
    await waitFor(() =>
      expect(screen.getByTestId('invite-state-error-not_found')).toBeInTheDocument()
    );
  });

  test('renders expired panel on 410 INVITATION_EXPIRED', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(410, { detail: 'expired', code: 'INVITATION_EXPIRED' })
    );
    renderAt('expired-token');
    await waitFor(() =>
      expect(screen.getByTestId('invite-state-error-expired')).toBeInTheDocument()
    );
  });

  test('renders revoked panel on 410 INVITATION_REVOKED', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(410, { detail: 'revoked', code: 'INVITATION_REVOKED' })
    );
    renderAt('revoked-token');
    await waitFor(() =>
      expect(screen.getByTestId('invite-state-error-revoked')).toBeInTheDocument()
    );
  });

  test('renders already-used panel on 409 INVITATION_ACCEPTED', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, { detail: 'used', code: 'INVITATION_ACCEPTED' })
    );
    renderAt('used-token');
    await waitFor(() =>
      expect(screen.getByTestId('invite-state-error-already_used')).toBeInTheDocument()
    );
  });

  test('renders generic panel on 500', async () => {
    setAuth({ isAuthenticated: false, isLoading: false, user: null });
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'oops' }));
    renderAt('boom-token');
    await waitFor(() =>
      expect(screen.getByTestId('invite-state-error-generic')).toBeInTheDocument()
    );
  });
});
