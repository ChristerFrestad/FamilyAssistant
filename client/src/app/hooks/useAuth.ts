// Authentication hook contract for the v2 frontend.
//
// This file ships a deliberately *mocked* implementation for Phase 1d.
// Real auth wiring lands in Phase 1e (Prompt 5) — at that point the
// implementation will read session state from a secure cookie/Bearer
// flow against /api/auth/* and trigger a logout endpoint. The
// component surface (return shape) is what AuthGuard, AppShell, and
// UserMenu code against, so callers won't need any change when the
// real implementation slots in behind the same hook name.
//
// Why a mock now and not later: AppShell needs to render with a
// realistic data shape to validate the layout, and AuthGuard needs
// something to gate against so its redirect path is exercised in
// tests. Returning a hard-coded "always authenticated" placeholder
// lets us build everything downstream and swap in real auth without
// touching the consumers.

export interface AuthUser {
  /** Display name shown in the header / user menu. */
  name: string;
  /** Optional avatar URL. Falls back to initials when omitted. */
  avatarUrl?: string;
  /** Email address. Optional in v2; some pilot users may not have one yet. */
  email?: string;
}

export interface AuthState {
  /** Resolved user; null while loading or when unauthenticated. */
  user: AuthUser | null;
  /** True when an auth check is still in flight. */
  isLoading: boolean;
  /** Convenience: true when `user` is non-null AND `isLoading` is false. */
  isAuthenticated: boolean;
  /** Logout handler. In Phase 1e this calls /api/auth/logout. */
  logout: () => void;
}

// Phase-1d mock. Christer is the dummy pilot user so AppShell renders
// with realistic Norwegian first/last-name initials in the avatar.
// The Phase-1e implementation will replace this body with a
// useEffect/fetch flow against the session endpoint and a real
// logout handler that invalidates the cookie server-side.
const MOCK_USER: AuthUser = {
  name: 'Christer Frestad',
  email: 'christer@example.com',
};

export function useAuth(): AuthState {
  // The hook signature is intentional — even though the current body
  // returns a constant, consumers (AuthGuard, AppShell) call useAuth()
  // each render so the Phase-1e swap to real state-driven logic is
  // a body-only change.
  return {
    user: MOCK_USER,
    isLoading: false,
    isAuthenticated: true,
    logout: () => {
      // Phase-1d placeholder. In production this hits POST /api/auth/logout
      // and lets the response invalidate the session cookie before we
      // navigate away. For now we leave a console signal so the dev
      // preview can verify the menu-item is wired even though it
      // doesn't yet round-trip through a server.
      console.info('[Phase-1d mock] logout invoked — real flow lands in Phase 1e');
    },
  };
}
