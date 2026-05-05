import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { AuthProvider } from './app/auth/AuthContext';
import { applyBrandTokens } from './app/styles/brand-tokens';
// i18n config side-effect: registers resource bundles and the
// language detector with i18next. Imported here (and not lazily)
// so the very first render already has translations available.
import i18n from './app/i18n/config';
// Order matters: globals.css ships the Tailwind reset; tokens.css
// then defines the design system + body baseline that sits on top
// of that reset. tokens.css also pulls in the @font-face faces, so
// Vite emits the woff2 files as build assets next to the bundle.
import './app/styles/globals.css';
import './app/styles/tokens.css';

// Sprint 10 — runtime brand-config bootstrap.
//
// Fire the /api/config fetch as early as possible (before React mount)
// and apply the side-effects synchronously when it resolves:
//   1. document.title ← config.appName so the browser tab reflects the
//      active brand instead of the placeholder &nbsp; from index.html.
//   2. <meta name="description"> ← config.tagline.
//   3. <meta name="theme-color"> ← config.primaryColor.
//   4. CSS custom properties on :root via applyBrandTokens() so any
//      style rule that reads var(--brand-primary) re-renders with the
//      override.
//   5. i18n.addResource('common.appName') so existing {{appName}}
//      interpolations across the bundle pick up the active brand
//      without refactoring every t() call site.
//
// React mounts immediately — the brand-config promise runs in
// parallel and its components (Wordmark, useBrandConfig consumers)
// re-render via the hook's useState once it resolves. Failure leaves
// document.title at the placeholder and Wordmark blank; AppShell and
// the rest still render correctly.
function applyBrandSideEffects(config: {
  appName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  dotColor: string;
}): void {
  document.title = config.appName;
  const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (desc) desc.content = config.tagline;
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (theme) theme.content = config.primaryColor;
  applyBrandTokens(config);
  // Override every {{appName}} interpolation in the loaded i18n
  // bundles (no/en) so existing translations don't have to change.
  for (const lng of ['no', 'en']) {
    i18n.addResource(lng, 'common', 'appName', config.appName);
  }
}

void fetch('/api/config', { credentials: 'same-origin' })
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (data && typeof data.appName === 'string') {
      applyBrandSideEffects(data);
    }
  })
  .catch(() => {
    // Network failure — leave defaults from index.html in place.
    // Wordmark stays blank, document.title stays at the &nbsp;
    // placeholder. App still renders.
  });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// `basename="/v2"` tells React Router that all routes are relative to
// /v2/*. This matches Vite's `base: '/v2/'` so internal links ("/") map
// to "/v2/" in the browser URL without extra code.
//
// AuthProvider sits inside BrowserRouter so its useEffect-driven
// /api/auth/me call has the router context available, and outside
// App so every screen — including the public auth screens — can
// read auth state via useAuthContext()/useAuth(). On mount the
// provider issues exactly one /me round-trip; AuthGuard sees
// `isLoading: true` until that resolves and renders its loading
// view rather than bouncing the user to /login while the cookie
// is still being checked.
createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename="/v2">
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
