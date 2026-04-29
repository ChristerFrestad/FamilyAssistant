// Phase-1d placeholder for the Family screen. Real implementation —
// member list, per-member diet/allergy editing, and gamification
// progress — lands in Phase 2B. See B7 / pending-decisions.md for the
// per-member-diet UI scope.

import { useTranslation } from 'react-i18next';

export function Family(): JSX.Element {
  const { t } = useTranslation(['common', 'family']);
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('common:nav.family')}
      </h1>
      <p className="font-body text-body text-text-2">{t('family:placeholder.description')}</p>
    </section>
  );
}
