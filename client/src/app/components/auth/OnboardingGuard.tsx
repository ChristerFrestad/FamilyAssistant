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
// Three states:
//   1. isLoading           -> defer to AuthGuard (won't reach here)
//   2. !onboardingCompleted -> redirect to /onboarding/family
//   3. onboardingCompleted  -> render children
//
// Why a separate guard instead of inline logic in AuthGuard: the
// onboarding-routes (/onboarding/family, /onboarding/profile) are
// auth-required but onboarding-NOT-completed. The reverse — the
// main app — is auth-required AND onboarding-completed. Splitting
// into two guards keeps each one's predicate single-purpose and
// the route table reads top-down.

import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

export interface OnboardingGuardProps {
  children: ReactNode;
  /**
   * Where to send users that haven't completed onboarding.
   * Defaults to `/onboarding/family` — the first step of the
   * Sprint-3 two-step pilot wizard. Tests can override.
   */
  redirectTo?: string;
}

export function OnboardingGuard({
  children,
  redirectTo = '/onboarding/family',
}: OnboardingGuardProps): JSX.Element {
  const { user, isLoading } = useAuth();

  // AuthGuard upstream already handled the loading + unauthenticated
  // cases. If we get here without a user, treat as not-yet-onboarded
  // and redirect (defensive — should not happen in practice).
  if (isLoading) return <>{children}</>;
  if (!user) return <Navigate to={redirectTo} replace />;
  if (!user.onboardingCompleted) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
