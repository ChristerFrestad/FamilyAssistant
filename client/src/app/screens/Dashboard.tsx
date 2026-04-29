// Phase-1d placeholder for the Dashboard screen. The real Dashboard
// (today's overview, agenda, family activity feed) lands in Phase 2A.
// Until then this stub anchors the /dashboard route so AppShell +
// AuthGuard + BottomNav/SideNav can be exercised end-to-end against
// real navigation.

import { useTranslation } from 'react-i18next';

export function Dashboard(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('nav.dashboard')}
      </h1>
      <p className="font-body text-body text-text-2">
        Kommer i Fase 2A — i mellomtiden er ruten på plass slik at navigasjonen kan verifiseres ende
        til ende.
      </p>
    </section>
  );
}
