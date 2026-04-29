// Phase-1d placeholder for the Shopping screen. Real handleliste UI
// (category groupings, har-hjemme inline form, kjøpt-toggle) arrives
// in Phase 2C alongside the meal-planning surface.

import { useTranslation } from 'react-i18next';

export function Shopping(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('nav.shopping')}
      </h1>
      <p className="font-body text-body text-text-2">
        Kommer i Fase 2C — handleliste med kategorier, pantry-integrasjon og angre-flyt.
      </p>
    </section>
  );
}
