// Root of the v2 frontend.
//
// Sprint 3 / Fase 1e routing tiers:
//
//   1. PUBLIC — no auth required. Welcome, Login, MagicLinkSent,
//      AuthCallback. Renders without AppShell so unauthenticated
//      users never see the in-app chrome.
//
//   2. ONBOARDING — auth required AND onboarding_completed=false.
//      The two-screen pilot wizard: FamilySetup, UserProfile.
//      Renders without AppShell so the user is not distracted by
//      empty nav-rails before their family exists. AuthGuard
//      enforces the auth requirement; the onboarding-routes
//      themselves do NOT use OnboardingGuard (they ARE the path
//      a user takes when onboarding is incomplete).
//
//   3. PROTECTED — auth required AND onboarding_completed=true.
//      Everything else: Dashboard, Family, Meals, Shopping,
//      Calendar, Settings. AuthGuard + OnboardingGuard wrap
//      AppShell, which renders the placeholder screens from
//      Sprint 2 (replaced with real screens in Phase 2A-2E).
//
// BrowserRouter + basename="/v2" lives one level up in main.tsx, so
// every <Route path> is implicitly relative to /v2/*. A Route
// written as path="/dashboard" therefore matches the URL
// /v2/dashboard in the browser.

import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthGuard } from './components/auth/AuthGuard';
import { OnboardingGuard } from './components/auth/OnboardingGuard';
import { OnboardingProvider } from './auth/OnboardingContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { Dashboard } from './screens/Dashboard';
import { Family } from './screens/Family';
import { Meals } from './screens/Meals';
import { Shopping } from './screens/Shopping';
import { Calendar } from './screens/Calendar';
import { Settings } from './screens/Settings';
import { NotFound } from './screens/NotFound';
import { Welcome } from './screens/auth/Welcome';
import { Login } from './screens/auth/Login';
import { MagicLinkSent } from './screens/auth/MagicLinkSent';
import { AuthCallback } from './screens/auth/AuthCallback';
import { FamilySetup } from './screens/auth/FamilySetup';
import { UserProfile } from './screens/auth/UserProfile';

export default function App(): JSX.Element {
  return (
    <Routes>
      {/* PUBLIC routes — no AuthGuard. */}
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/login/sent" element={<MagicLinkSent />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* ONBOARDING routes — auth required, but no OnboardingGuard
          (these screens ARE the onboarding flow). Rendered without
          AppShell so the page reads as a focused single-purpose
          wizard. The shared OnboardingProvider wraps both steps via
          a parent route + <Outlet />, so Step 1 (FamilySetup) can
          stash the family name in shared state and Step 2
          (UserProfile) can read it back when submitting the atomic
          POST /api/auth/onboarding/complete (PR #77). Navigating
          between /onboarding/family and /onboarding/profile keeps
          the same provider instance alive; navigating away from
          /onboarding/* drops the partial state, which is exactly
          the cancellation behaviour the bug fix aims for. */}
      <Route
        path="/onboarding"
        element={
          <AuthGuard>
            <OnboardingProvider>
              <Outlet />
            </OnboardingProvider>
          </AuthGuard>
        }
      >
        <Route path="family" element={<FamilySetup />} />
        <Route path="profile" element={<UserProfile />} />
      </Route>

      {/* PROTECTED app surface. AuthGuard + OnboardingGuard +
          AppShell wrap the inner Routes. Nesting AppShell here
          keeps it mounted across navigation between authenticated
          screens — only the inner children swap when the URL
          changes. */}
      <Route
        path="*"
        element={
          <AuthGuard>
            <OnboardingGuard>
              <AppShell>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/family" element={<Family />} />
                  <Route path="/meals" element={<Meals />} />
                  <Route
                    path="/shopping"
                    element={
                      <ErrorBoundary messageKey="shoppingMessage">
                        <Shopping />
                      </ErrorBoundary>
                    }
                  />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AppShell>
            </OnboardingGuard>
          </AuthGuard>
        }
      />
    </Routes>
  );
}
