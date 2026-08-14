// QuickActions — three CTA buttons under the dashboard cards that
// take the user straight to the screens that mutate the data the
// dashboard reads. For Sprint 4 the destination screens are still
// placeholders, but the navigation contract is in place so future
// sprints just have to fill in the destinations.
//
// Buttons:
//   - "Add meal"               -> /meals
//   - "New chore"              -> /chores
//   - "Add to shopping list"   -> /shopping
//
// All three labels live in dashboard:actions.* — no hard-coded
// strings here. The container is keyboard-accessible (semantic
// <nav> with aria-label so screen-readers can skip past it) and
// wraps to two rows on narrow viewports.

import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../base/Button';

export function QuickActions(): JSX.Element {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();

  return (
    <nav aria-label={t('quickActions.label')} className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => navigate('/meals')}>
        {t('actions.addMeal')}
      </Button>
      <Button type="button" variant="secondary" onClick={() => navigate('/chores')}>
        {t('actions.addChore')}
      </Button>
      <Button type="button" variant="secondary" onClick={() => navigate('/shopping')}>
        {t('actions.addShopping')}
      </Button>
    </nav>
  );
}
