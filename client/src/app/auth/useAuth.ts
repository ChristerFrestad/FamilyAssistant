// Public auth hook used by AuthGuard, UserMenu, and any screen that
// needs the current auth state.
//
// Sprint 3 / Fase 1e replaced the Phase-1d mock — which always
// returned `isAuthenticated: true` and a hard-coded user — with a
// real implementation that delegates to AuthProvider/AuthContext.
// Consumers do not change shape: they still destructure the same
// fields (`user`, `isAuthenticated`, `isLoading`, `logout`).

import { useAuthContext } from './AuthContext';
import type { AuthUser } from './authApi';

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
}

export function useAuth(): AuthState {
  const ctx = useAuthContext();
  return {
    user: ctx.user,
    isLoading: ctx.isLoading,
    isAuthenticated: ctx.isAuthenticated,
    // The context's logout returns a Promise; UserMenu calls this
    // synchronously (on click) and doesn't await — wrap in a fire-
    // and-forget to keep the historical signature stable.
    logout: () => {
      void ctx.logout();
    },
  };
}
