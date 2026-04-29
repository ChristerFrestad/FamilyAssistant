// Root of the v2 frontend. Wires four concerns together:
//
//   1. AuthGuard wraps every authenticated route. The /login route is
//      rendered OUTSIDE the guard so an unauthenticated user actually
//      reaches it instead of bouncing.
//   2. AppShell provides the chrome (header + side/bottom-nav) for
//      all in-app screens. Login does NOT live inside AppShell — the
//      auth-flow keeps its own minimal layout.
//   3. <Routes> declares the URL surface. /  redirects to /dashboard
//      so the bare base URL lands on something useful; the catch-all
//      maps to NotFound.
//   4. Phase-1d screens are placeholders. Each one will be replaced
//      with its real implementation in Phase 2A-2E without touching
//      this file beyond an import swap.
//
// BrowserRouter + basename="/v2" lives one level up in main.tsx, so
// every <Route path> is implicitly relative to /v2/*. A Route written
// as path="/dashboard" therefore matches the URL /v2/dashboard in the
// browser.

import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGuard } from './components/auth/AuthGuard';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './screens/Dashboard';
import { Family } from './screens/Family';
import { Meals } from './screens/Meals';
import { Shopping } from './screens/Shopping';
import { Calendar } from './screens/Calendar';
import { Settings } from './screens/Settings';
import { NotFound } from './screens/NotFound';
import { Login } from './screens/Login';

export default function App(): JSX.Element {
  return (
    <Routes>
      {/* Unauthenticated routes — rendered without AppShell. */}
      <Route path="/login" element={<Login />} />

      {/* Authenticated app surface. AuthGuard gates the entire tree;
          AppShell provides chrome; the inner <Routes> declares the
          actual screens. Nesting this way keeps AppShell mounted
          across navigation between authenticated screens — only the
          children swap when the URL changes. */}
      <Route
        path="*"
        element={
          <AuthGuard>
            <AppShell>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/family" element={<Family />} />
                <Route path="/meals" element={<Meals />} />
                <Route path="/shopping" element={<Shopping />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppShell>
          </AuthGuard>
        }
      />
    </Routes>
  );
}
