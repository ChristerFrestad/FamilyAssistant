// Tests for AuthContext / AuthProvider.
//
// Three contracts to lock down:
//   1. Initial state: when initialState is omitted, the provider
//      issues a /api/auth/me round-trip on mount and reflects the
//      result (authenticated or not).
//   2. requestMagicLink: forwards to authApi.startMagicLink and
//      surfaces errors so screens can branch on them.
//   3. logout: invokes apiLogout and clears local state to null.
//      A 401 response is treated as "session already gone" and
//      still results in clean local state.
//
// Pattern: a tiny consumer component reads the context via
// useAuthContext() and exposes the relevant fields via testid
// attributes. We then drive state transitions by clicking buttons
// and asserting on the rendered text. This avoids the (much more
// brittle) approach of directly importing the context object.

import type { JSX } from 'react';
import { render, screen, act } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuthContext } from './AuthContext';
import type { AuthUser, MeResponse } from './authApi';

const TEST_USER: AuthUser = {
  id: 7,
  email: 'test@example.com',
  name: 'Test',
  role: 'adult',
  avatarUrl: null,
  familyId: 5,
  profileMemberId: null,
  onboardingCompleted: true,
  synthetic: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function Consumer(): JSX.Element {
  const ctx = useAuthContext();
  return (
    <div>
      <span data-testid="status">
        {ctx.isLoading ? 'loading' : ctx.isAuthenticated ? 'authenticated' : 'anon'}
      </span>
      <span data-testid="user-name">{ctx.user?.name ?? '—'}</span>
      <button onClick={() => void ctx.requestMagicLink('foo@example.com')}>req</button>
      <button onClick={() => void ctx.logout()}>logout</button>
      <button onClick={() => void ctx.refreshUser()}>refresh</button>
    </div>
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('AuthProvider initial /me round-trip', () => {
  test('reflects authenticated user when /me returns user', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { authenticated: true, user: TEST_USER } satisfies MeResponse)
    );
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    expect(screen.getByTestId('user-name').textContent).toBe('Test');
  });

  test('reflects anonymous when /me returns no user', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { authenticated: false, user: null } satisfies MeResponse)
    );
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });
    expect(screen.getByTestId('status').textContent).toBe('anon');
  });

  test('treats network errors as anonymous', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });
    expect(screen.getByTestId('status').textContent).toBe('anon');
  });

  test('treats synthetic LOCAL_USER (legacy single-tenant fallback) as anonymous', async () => {
    // PR #77 hotfix: when the backend has no AUTH_TOKEN configured
    // (legacy single-tenant deploy / local dev), the auth middleware
    // attaches a synthetic LOCAL_USER and /api/auth/me responds with
    // `authenticated: true, synthetic: true`. The v2 SPA must treat
    // that as unauthenticated — the user has no session cookie, and
    // any authenticated mutation (create-family, onboarding/complete)
    // would 401. Routing the synthetic user as authenticated stranded
    // visitors in an onboarding loop they could never finish.
    // Mirror what the backend's middleware.attachLocalUser puts on
    // ctx.user. The real synthetic user has email=null on the
    // backend; the AuthUser type currently models email as string,
    // so use an empty placeholder here. The behaviour under test
    // (synthetic flag → unauthenticated) is unaffected by what
    // ends up in the email slot.
    const SYNTHETIC: AuthUser = {
      ...TEST_USER,
      id: 0,
      email: '',
      name: 'Local',
      role: 'owner',
      familyId: 1,
      profileMemberId: null,
      onboardingCompleted: false,
      synthetic: true,
    };
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { authenticated: true, user: SYNTHETIC } satisfies MeResponse)
    );
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });
    expect(screen.getByTestId('status').textContent).toBe('anon');
    expect(screen.getByTestId('user-name').textContent).toBe('—');
  });
});

describe('initialState skips the auto-fetch', () => {
  test('renders authenticated immediately without calling /me', () => {
    render(
      <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('renders loading when initialState.isLoading=true', () => {
    render(
      <AuthProvider initialState={{ user: null, isLoading: true }}>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('logout clears local state', () => {
  test('successful logout flips authenticated to anon', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    render(
      <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('status').textContent).toBe('authenticated');

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('anon');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('401 from logout is treated as already-logged-out (no error rethrow)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(401, { title: 'Unauthorized', detail: 'no session' })
    );
    render(
      <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
        <Consumer />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText('logout').click();
    });

    // User is cleared locally even though server returned 401.
    expect(screen.getByTestId('status').textContent).toBe('anon');
  });
});

describe('requestMagicLink forwards to API', () => {
  test('successful POST to /magic-link/start does not throw', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, message: 'sent' }));
    render(
      <AuthProvider initialState={{ user: null, isLoading: false }}>
        <Consumer />
      </AuthProvider>
    );

    await act(async () => {
      screen.getByText('req').click();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/magic-link/start',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
