// Phase-1d placeholder for the Meals screen. Real meal-planning UI
// (week menu, swap, ingredient customization) arrives in Phase 2C.

import { useTranslation } from 'react-i18next';

export function Meals(): JSX.Element {
  const { t } = useTranslation(['common', 'meals']);
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('common:nav.meals')}
      </h1>
      <p className="font-body text-body text-text-2">{t('meals:placeholder.description')}</p>
    </section>
  );
}
