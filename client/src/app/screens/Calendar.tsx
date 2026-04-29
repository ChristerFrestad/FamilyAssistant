// Phase-1d placeholder for the Calendar screen. Real implementation
// — Google passthrough + family-events overlay — arrives in Phase 2D
// (Sprint 5 / Prompt 10). See pending-decisions.md "Kalender-
// arkitektur" for the hybrid model.

import { useTranslation } from 'react-i18next';

export function Calendar(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <section aria-labelledby="screen-heading" className="space-y-3">
      <h1 id="screen-heading" className="font-display text-display-md text-text-1">
        {t('nav.calendar')}
      </h1>
      <p className="font-body text-body text-text-2">
        Kommer i Fase 2D — Google-kalender pass-through + familie-events.
      </p>
    </section>
  );
}
