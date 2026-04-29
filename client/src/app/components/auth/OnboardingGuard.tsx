// Route guard that ensures users have finished onboarding before
// they reach the main app surface.
//
// Sits between AuthGuard and AppShell:
//
//   <AuthGuard>           — must be authenticated to pass
//     <OnboardingGuard>   — must have onboarding_completed=true
//       <AppShell>        — main app chrome
//         <Routes ... />
//       </AppShell>
//     </OnboardingGuard>
//   </AuthGuard>
//
// Four states (priority order):
//   1. isLoading            -> render the loading shell, do NOT
//                              redirect (avoids a one-frame flash
//                              if the guard is ever used outside
//                              AuthGuard, e.g. a test renders it
//                              standalone with isLoading=true).
//   2. !user (unauthenticated) -> redirect to /login. AuthGuard
//                                 upstream normally handles this,
//                                 but the defensive branch keeps
//                                 the guard correct standalone.
//   3. !user.onboardingCompleted -> redirect to /onboarding/family.
//   4. user.onboardingCompleted  -> render children.
//
// Why a separate guard instead of inline logic in AuthGuard: the
// onboarding-routes (/onboarding/family, /onboarding/profile) are
// auth-required but onboarding-NOT-completed. The reverse — the
// main app — is auth-required AND onboarding-completed. Splitting
// into two guards keeps each one's predicate single-purpose and
// the route table reads top-down.

import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../layout/PageShell';
import { useAuth } from '../../auth/useAuth';

export interface OnboardingGuardProps {
  children: ReactNode;
  /**
   * Where to send users that haven't completed onboarding.
   * Defaults to `/onboarding/family` — the first step of the
   * Sprint-3 two-step pilot wizard. Tests can override.
   */
  redirectTo?: string;
  /**
   * Where to send users that are not authenticated at all.
   * Defaults to `/login`. AuthGuard upstream normally handles
   * the unauthenticated case before OnboardingGuard mounts, so
   * this only fires when the guard is used standalone.
   */
  unauthenticatedRedirectTo?: string;
}

export function OnboardingGuard({
  children,
  redirectTo = '/onboarding/family',
  unauthenticatedRedirectTo = '/login',
}: OnboardingGuardProps): JSX.Element {
  const { t } = useTranslation('common');
  const { user, isLoading } = useAuth();

  if (isLoading) {
    // Match AuthGuard's loading view. Reaching here while loading
    // is unlikely in production (AuthGuard upstream renders its
    // own loading state and OnboardingGuard never mounts), but
    // standalone use in tests / future routing tweaks should NOT
    // briefly flash the protected children before the redirect
    // decision is made.
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

  if (!user) {
    // Defensive: AuthGuard upstream catches this case, but if the
    // guard is mounted directly we redirect to login instead of
    // bouncing the user through onboarding (which would just
    // redirect them to login anyway via FamilySetup's own
    // AuthGuard wrapper).
    return <Navigate to={unauthenticatedRedirectTo} replace />;
  }

  if (!user.onboardingCompleted) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
