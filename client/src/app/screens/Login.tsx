// Phase-1d placeholder for the Login screen. AuthGuard redirects here
// when the (mocked, currently always-true) auth state is missing.
// Real login flow — magic-link + Google OAuth — lands in Phase 1e
// (Prompt 5).
//
// We render this OUTSIDE the AppShell on purpose: an unauthenticated
// user should not see the header, nav, or any of the in-app chrome.
// PageShell gives the auth-flow density we use elsewhere.
//
// "Familieassistenten" is the brand name and stays as a literal —
// it does not translate. The descriptive paragraph and the loading
// hint flow through i18n.

import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/layout/PageShell';

export function Login(): JSX.Element {
  const { t } = useTranslation(['common', 'auth']);
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
          {t('auth:login.placeholder.description')}
        </p>
        <p className="font-body text-meta text-text-3">{t('common:status.loading')}</p>
      </section>
    </PageShell>
  );
}
