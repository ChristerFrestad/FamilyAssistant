// Admin panel skeleton (Sprint 7).
//
// Pre-pilot scope: route exists, requires the current user to have
// is_admin=true via AuthContext. Fully-fledged admin UI (system stats,
// user management, Kassal status) lands post-pilot.

import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { useAuthContext } from '../auth/AuthContext';
import { Card } from '../components/layout/Card';

export function Admin(): JSX.Element {
  const { t } = useTranslation('admin');
  const { user } = useAuthContext();

  if (!user?.isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <section
      aria-labelledby="admin-screen-heading"
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-2"
      data-testid="admin-screen"
    >
      <header>
        <h1 id="admin-screen-heading" className="font-display text-display-md text-text-1">
          {t('admin:panel.title')}
        </h1>
      </header>
      <Card padding="md" shadow="low">
        <p className="font-body text-body text-text-2">{t('admin:panel.comingSoon')}</p>
      </Card>
    </section>
  );
}
