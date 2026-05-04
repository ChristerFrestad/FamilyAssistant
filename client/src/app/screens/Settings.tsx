// Phase 2F Settings screen — replaces the Phase-1d placeholder.
//
// Surfaces (Christer-confirmed tett-scope):
//   - System: Language (LanguageSwitcher), Theme (ThemeToggle)
//   - Family: Name (InlineEditableText, owner-only), Timezone /
//             Meal times / Gamification (disabled, "Coming soon")
//   - User:   Email + Push notifications (disabled, "Krever Resend")
//   - Account: Data export (GDPR), Delete account (GDPR), Version footer
//
// Owner-only restrictions:
//   - Family name edit: hidden Edit button when user.role !== 'owner'
//   - Delete account: disabled with hint when user is owner of a family
//     (backend would 403 anyway via gdpr-routes.handleDeleteMe)
//
// Loading/empty/error pattern follows the established pattern: skeleton
// while /api/family is in flight, error-card with retry on failure,
// data state once family is available. Routing is handled by App.tsx
// where /settings is wrapped in ErrorBoundary.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { LanguageSwitcher } from '../components/form/LanguageSwitcher';
import { ThemeToggle } from '../components/form/ThemeToggle';
import { SettingsSection } from '../components/settings/SettingsSection';
import { SettingsRow } from '../components/settings/SettingsRow';
import { InlineEditableText } from '../components/settings/InlineEditableText';
import { DataExportButton } from '../components/settings/DataExportButton';
import { DeleteAccountButton } from '../components/settings/DeleteAccountButton';
import { LogoutButton } from '../components/settings/LogoutButton';
import { useSettingsData } from '../settings/useSettingsData';
import { useAuthContext } from '../auth/AuthContext';

const TOAST_DISMISS_MS = 4000;
const APP_VERSION = '1.3.0';

export function Settings(): JSX.Element {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const { user, logout } = useAuthContext();
  const {
    family,
    isLoading,
    error,
    userFacingError,
    retry,
    renameFamily,
    exportMyData,
    deleteMyAccount,
    clearUserFacingError,
  } = useSettingsData();

  useEffect(() => {
    if (userFacingError === null) return undefined;
    const id = window.setTimeout(() => clearUserFacingError(), TOAST_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [userFacingError, clearUserFacingError]);

  const isOwner = user?.role === 'owner';
  // Owner of a family with members must transfer ownership before
  // deleting account — backend 403s otherwise. Pre-check here
  // for kjapp UX. We treat "any family attached" as the trigger;
  // a single-member family still has the owner constraint per
  // server/auth/gdpr-routes.js handleDeleteMe.
  const ownerBlocked = isOwner && (user?.familyId ?? null) !== null;

  function handleDeleteSuccess(): void {
    navigate('/login', { replace: true });
  }

  return (
    <section
      aria-labelledby="screen-heading"
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-2"
      data-testid="settings-screen"
    >
      <header>
        <h1 id="screen-heading" className="font-display text-display-md text-text-1">
          {t('settings:title')}
        </h1>
        <p className="mt-1 font-body text-body text-text-2">{t('settings:header.subtitle')}</p>
      </header>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          data-testid="settings-skeleton"
          className="flex flex-col gap-3"
        >
          <span className="sr-only">{t('common:status.loading')}</span>
          {[0, 1, 2].map((i) => (
            <Card key={i} padding="md" shadow="low">
              <div className="flex flex-col gap-2">
                <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-4 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && error !== null && (
        <Card padding="md" shadow="low" data-testid="settings-error">
          <div className="flex flex-col gap-3" role="alert">
            <h2 className="font-display text-card text-text-1">
              {t('settings:errors.loadFailed')}
            </h2>
            <Button type="button" variant="secondary" onClick={retry}>
              {t('settings:actions.retry')}
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && error === null && (
        <>
          <SettingsSection title={t('settings:sections.system')} id="system">
            <SettingsRow
              label={t('settings:system.language.label')}
              description={t('settings:system.language.description')}
              control={<LanguageSwitcher />}
            />
            <SettingsRow
              label={t('settings:system.theme.label')}
              description={t('settings:system.theme.description')}
              control={<ThemeToggle />}
            />
          </SettingsSection>

          <SettingsSection title={t('settings:sections.family')} id="family">
            <SettingsRow
              label={t('settings:family.name.label')}
              control={
                <InlineEditableText
                  value={family?.family.name ?? '—'}
                  onSave={renameFamily}
                  editLabel={t('settings:family.name.editLabel')}
                  saveLabel={t('common:actions.save')}
                  cancelLabel={t('common:actions.cancel')}
                  inputAriaLabel={t('settings:family.name.inputAriaLabel')}
                  readOnly={!isOwner}
                  readOnlyHint={t('settings:family.name.readOnlyHint')}
                />
              }
            />
            <SettingsRow
              label={t('settings:family.timezone.label')}
              description={t('settings:family.timezone.description')}
              disabled
              badge={t('settings:badge.postPilot')}
            />
            <SettingsRow
              label={t('settings:family.mealTimes.label')}
              description={t('settings:family.mealTimes.description')}
              disabled
              badge={t('settings:badge.postPilot')}
            />
            <SettingsRow
              label={t('settings:family.gamification.label')}
              description={t('settings:family.gamification.description')}
              disabled
              badge={t('settings:badge.postPilot')}
            />
          </SettingsSection>

          <SettingsSection title={t('settings:sections.user')} id="user">
            <SettingsRow
              label={t('settings:user.emailNotifications.label')}
              description={t('settings:user.emailNotifications.description')}
              disabled
              badge={t('settings:badge.requiresResend')}
            />
            <SettingsRow
              label={t('settings:user.pushNotifications.label')}
              description={t('settings:user.pushNotifications.description')}
              disabled
              badge={t('settings:badge.postPilot')}
            />
          </SettingsSection>

          <SettingsSection title={t('settings:sections.account')} id="account">
            <SettingsRow
              label={t('settings:account.export.label')}
              description={t('settings:account.export.description')}
              control={
                <DataExportButton
                  onExport={exportMyData}
                  label={t('settings:account.export.button')}
                  ariaLabel={t('settings:account.export.ariaLabel')}
                />
              }
            />
            <SettingsRow
              label={t('settings:account.delete.label')}
              description={t('settings:account.delete.description')}
              control={
                <DeleteAccountButton
                  onDelete={deleteMyAccount}
                  onSuccess={handleDeleteSuccess}
                  label={t('settings:account.delete.button')}
                  confirmText={t('settings:account.delete.confirmText')}
                  ownerBlocked={ownerBlocked}
                  ownerBlockedHint={t('settings:account.delete.ownerBlocked')}
                />
              }
            />
          </SettingsSection>

          <SettingsSection title={t('settings:sections.session')} id="session">
            <SettingsRow
              label={t('settings:session.logout.label')}
              description={t('settings:session.logout.description')}
              control={
                <LogoutButton
                  onLogout={logout}
                  label={t('settings:session.logout.button')}
                  confirmText={t('settings:session.logout.confirmText')}
                />
              }
            />
          </SettingsSection>

          <p className="text-center font-mono text-meta text-text-3" data-testid="settings-version">
            {t('settings:footer.version', { version: APP_VERSION })}
          </p>
        </>
      )}

      {userFacingError && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-canvas-2 px-4 py-2 font-body text-meta text-text-1 shadow-mid md:bottom-8"
          data-testid="settings-toast"
        >
          <span>{userFacingError.message || t('settings:errors.generic')}</span>
        </div>
      )}
    </section>
  );
}
