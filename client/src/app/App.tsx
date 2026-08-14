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
//      Everything else: Dashboard, Family, Meals, Recipes,
//      Shopping, Calendar, Settings. AuthGuard + OnboardingGuard wrap
//      AppShell, which renders the placeholder screens from
//      Sprint 2 (replaced with real screens in Phase 2A-2E).
//
// BrowserRouter lives one level up in main.tsx. A Route written as
// path="/dashboard" matches the URL /dashboard in the browser.

import type { JSX } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AuthGuard } from './components/auth/AuthGuard';
import { OnboardingGuard } from './components/auth/OnboardingGuard';
import { PilotGuard } from './components/auth/PilotGuard';
import { OnboardingProvider } from './auth/OnboardingContext';
import { ThemeProvider } from './theme/ThemeContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { Dashboard } from './screens/Dashboard';
import { Family } from './screens/Family';
import { Meals } from './screens/Meals';
import { Recipes } from './screens/Recipes';
import { Shopping } from './screens/Shopping';
import { Calendar } from './screens/Calendar';
import { Settings } from './screens/Settings';
import { Admin } from './screens/Admin';
import { NotFound } from './screens/NotFound';
import { Welcome } from './screens/auth/Welcome';
import { Login } from './screens/auth/Login';
import { MagicLinkSent } from './screens/auth/MagicLinkSent';
import { AuthCallback } from './screens/auth/AuthCallback';
import { SetPassword } from './screens/auth/SetPassword';
import { FamilySetup } from './screens/auth/FamilySetup';
import { UserProfile } from './screens/auth/UserProfile';
import { InviteAccept } from './screens/InviteAccept';

export default function App(): JSX.Element {
  return (
    <ThemeProvider>
      <PilotGuard>
        <AppRoutes />
      </PilotGuard>
    </ThemeProvider>
  );
}

function AppRoutes(): JSX.Element {
  return (
    <Routes>
      {/* PUBLIC routes — no AuthGuard. */}
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/login/sent" element={<MagicLinkSent />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      {/* Set password after post-grace email verification. Auth required
          (session from magic-link verify) but kept outside AppShell. */}
      <Route
        path="/set-password"
        element={
          <AuthGuard redirectTo="/login" allowPasswordReset>
            <SetPassword />
          </AuthGuard>
        }
      />
      {/* /invite/:token is PUBLIC by design — recipients arrive via
          email link without an active session yet. The component itself
          reads useAuthContext() to decide between the four
          valid-invitation states (anonymous, matching, mismatched,
          accepted). PilotGuard is still in front so pilot-mode deploys
          can gate visitors. */}
      <Route path="/invite/:token" element={<InviteAccept />} />

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
                  <Route path="/recipes" element={<Recipes />} />
                  <Route
                    path="/shopping"
                    element={
                      <ErrorBoundary messageKey="shoppingMessage">
                        <Shopping />
                      </ErrorBoundary>
                    }
                  />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route
                    path="/settings"
                    element={
                      <ErrorBoundary messageKey="settingsMessage">
                        <Settings />
                      </ErrorBoundary>
                    }
                  />
                  <Route path="/admin" element={<Admin />} />
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
