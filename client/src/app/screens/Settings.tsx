// Phase-1d placeholder for the Settings screen. Real settings UI
// (system / family / user tiers per pending-decisions.md "Settings-
// arkitektur") arrives in Phase 2E.

import { useTranslation } from 'react-i18next';

export function Settings(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('common:nav.settings')}
      </h1>
      <p className="font-body text-body text-text-2">{t('settings:placeholder.description')}</p>
    </section>
  );
}
