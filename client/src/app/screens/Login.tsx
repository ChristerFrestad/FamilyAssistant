// Phase-1d placeholder for the Login screen. AuthGuard redirects here
// when the (mocked, currently always-true) auth state is missing.
// Real login flow — magic-link + Google OAuth — lands in Phase 1e
// (Prompt 5).
//
// We render this OUTSIDE the AppShell on purpose: an unauthenticated
// user should not see the header, nav, or any of the in-app chrome.
// PageShell gives the auth-flow density we use elsewhere.

import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/layout/PageShell';

export function Login(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <PageShell maxWidth="sm" compact>
      <section
        aria-labelledby="login-heading"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center"
      >
        <h1 id="login-heading" className="font-display text-display-md text-text-1">
          Familieassistenten
        </h1>
        <p className="font-body text-body text-text-2 max-w-md">
          Innlogging-skjermen kommer i Fase 1e (magic-link + Google). Inntil videre er denne
          plasseringen reservert slik at AuthGuard har en gyldig redirect-rute.
        </p>
        <p className="font-body text-meta text-text-3">{t('status.loading')}</p>
      </section>
    </PageShell>
  );
}
