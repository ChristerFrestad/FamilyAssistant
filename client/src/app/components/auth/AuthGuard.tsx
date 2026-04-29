// Route guard that gates protected screens behind a successful auth
// check. Wraps the entire AppShell + Routes tree so a single guard
// covers every authenticated route — there is no per-route opt-in.
//
// Three states the guard handles, in priority order:
//   1. isLoading       -> render the loading shell (PageShell + status text)
//   2. !isAuthenticated -> redirect to /login (Phase-1e implementation)
//   3. isAuthenticated  -> render children
//
// The redirect uses react-router's <Navigate replace /> rather than a
// plain <a> so the unauthenticated entry is not pushed onto history.
// Hitting "back" after login then returns to wherever the user came
// from instead of the synthetic /login URL.
//
// In Phase 1d the underlying useAuth() hook is mocked to always
// return authenticated. The redirect path is still rendered, tested,
// and verified — that way Phase 1e (real auth) only flips the hook
// body and the consumer surface keeps working.

import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../layout/PageShell';
import { useAuth } from '../../hooks/useAuth';

export interface AuthGuardProps {
  children: ReactNode;
  /**
   * Route to redirect to when the user is not authenticated.
   * Defaults to `/login`. Override for testing or for nested guards
   * that should send the user back to a specific entry point.
   */
  redirectTo?: string;
}

export function AuthGuard({ children, redirectTo = '/login' }: AuthGuardProps): JSX.Element {
  const { t } = useTranslation('common');
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    // Loading view — uses PageShell to match the auth-flow density.
    // The status text is announced via aria-live so a screen-reader
    // user knows the app is waiting on auth resolution and has not
    // simply hung.
    return (
      <PageShell maxWidth="sm" compact>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[40vh] items-center justify-center font-body text-text-2"
        >
          {t('status.loading')}
        </div>
      </PageShell>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
