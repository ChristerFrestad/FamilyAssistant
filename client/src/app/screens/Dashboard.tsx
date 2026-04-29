// Phase-1d placeholder for the Dashboard screen. The real Dashboard
// (today's overview, agenda, family activity feed) lands in Phase 2A.
// Until then this stub anchors the /dashboard route so AppShell +
// AuthGuard + BottomNav/SideNav can be exercised end-to-end against
// real navigation.
//
// Heading and body both flow through i18n: the heading reuses the
// nav label from `common:nav.dashboard` (so the screen title and
// the nav-rail name stay in lockstep), and the placeholder copy
// lives under `dashboard:placeholder.description`.

import { useTranslation } from 'react-i18next';

export function Dashboard(): JSX.Element {
  const { t } = useTranslation(['common', 'dashboard']);
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('common:nav.dashboard')}
      </h1>
      <p className="font-body text-body text-text-2">{t('dashboard:placeholder.description')}</p>
    </section>
  );
}
