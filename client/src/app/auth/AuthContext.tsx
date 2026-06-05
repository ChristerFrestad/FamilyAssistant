// React Context that holds the current auth state.
//
// AuthProvider runs once at app-mount and queries /api/auth/me to
// resolve a session cookie that may already be set (returning user).
// Until that round-trip finishes we report `isLoading: true` so
// AuthGuard can render a spinner instead of bouncing the user
// briefly to /login when they actually have a valid session.
//
// State shape mirrors what useAuth() promises so consumers can
// destructure { isAuthenticated, user, ... } without thinking
// about the network layer. The context value also exposes the
// action-handlers the screens need: requestMagicLink, logout,
// refreshUser. Each action does its work via authApi.ts, then
// updates the local state — no stale-after-action surprises.
//
// Pure mock-replacement contract: AuthGuard, UserMenu, and the
// existing useAuth() consumers keep their import path the same;
// this provider just wraps the real implementation behind it.

import type { JSX } from 'react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  AuthApiError,
  fetchMe,
  startMagicLink,
  logout as apiLogout,
  type AuthUser,
} from './authApi';

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface AuthActions {
  requestMagicLink: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * Optional override for tests. When provided, replaces the initial
   * state and disables the auto-fetch on mount. Production code
   * never passes this — the real flow always queries /api/auth/me.
   */
  initialState?: Partial<AuthState>;
}

export function AuthProvider({ children, initialState }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(initialState?.user ?? null);
  // The default is true so the very first render reports "loading"
  // and AuthGuard shows the loading view rather than bouncing to
  // /login before the /me round-trip completes. Tests that pass
  // initialState skip the auto-fetch and start with whatever they
  // want.
  const [isLoading, setIsLoading] = useState<boolean>(initialState?.isLoading ?? true);

  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      const result = await fetchMe();
      // Filter out synthetic / pilot-bypass users. The backend's
      // legacy single-tenant fallback (server/auth/middleware.js:
      // attachLocalUser) returns `authenticated: true, synthetic:
      // true` for any unauthenticated request when AUTH_TOKEN is
      // not configured. That keeps the legacy SPA at "/" working
      // unchanged, but the v2 SPA at "/v2" must NOT treat the
      // synthetic user as a real session: it has no session
      // cookie, no real `family_id` mapping for the multi-tenant
      // pilot, and any authenticated mutation (create-family,
      // onboarding/complete, ...) will hit a 401. Treating it as
      // unauthenticated here sends the visitor through the proper
      // welcome → login → magic-link flow instead of stranding
      // them in an onboarding loop they can never finish.
      const isReal = result.authenticated && result.user !== null && !result.user.synthetic;
      setUser(isReal ? result.user : null);
    } catch {
      // Treat any network/auth error as "not authenticated" — the
      // UI can recover by sending the user back through the magic-
      // link flow. We deliberately don't surface the error here
      // because /me is queried passively on mount, and a flash of
      // an error banner would surprise the user before they have
      // even typed anything.
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const requestMagicLink = useCallback(async (email: string): Promise<void> => {
    // Errors propagate up to the screen so it can show a status
    // hint (rate-limited, invalid email, ...). The provider does
    // NOT swallow them.
    await startMagicLink(email);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch (err) {
      // A 401 / session-already-gone is fine — the cookie is
      // already useless. Anything else we still want the local
      // state to drop because the user explicitly asked to leave.
      if (!(err instanceof AuthApiError) || err.status !== 401) {
        // Re-throw non-401 errors so the caller can show a hint.
        // We still clear local state below.
        setUser(null);
        throw err;
      }
    }
    setUser(null);
  }, []);

  useEffect(() => {
    if (initialState !== undefined) return; // tests skip auto-fetch
    void refreshUser();
  }, [initialState, refreshUser]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !isLoading && user !== null,
    requestMagicLink,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook used by screens, AuthGuard, UserMenu, etc. Throws when used
// outside an AuthProvider so a missing provider fails loudly in dev
// instead of silently rendering with a null user.
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuthContext must be used inside <AuthProvider>');
  }
  return ctx;
}
