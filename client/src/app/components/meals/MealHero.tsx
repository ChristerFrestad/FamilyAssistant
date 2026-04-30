// Hero card for the currently selected day in the Meals screen.
//
// States rendered (mutually exclusive, in this priority order):
//   1. status === 'away'   → "Borte denne dagen" panel + optional
//                             notes; recipe-name shown as small meta
//                             if present (some users plan a meal but
//                             then mark themselves away).
//   2. status === 'skipped'→ "Hopp over"-panel.
//   3. recipe === null     → empty-state panel with placeholder CTA.
//   4. recipe present      → full hero with category-tag, prep-time,
//                             title, "Bytt middag" placeholder action,
//                             "Åpne kilde" link if recipe.url is set.
//
// Pure render. Placeholder actions invoke onPlaceholderAction so the
// parent (Meals.tsx) can surface inline "kommer i Sprint 5"-status
// the same way Family.tsx does for edit/invite.

import { useTranslation } from 'react-i18next';
import { Card } from '../layout/Card';
import { Badge } from '../display/Badge';
import { Button } from '../base/Button';
import type { MealSlot, RecipeCategory } from '../../meals/mealsApi';

const CATEGORY_BADGE_VARIANT: Record<RecipeCategory, 'mint' | 'cyan' | 'amber'> = {
  rask: 'mint',
  comfort: 'cyan',
  helg: 'amber',
};

export interface MealHeroProps {
  slot: MealSlot;
  /** Localised long day-name shown in the hero label (e.g. "Mandag"). */
  dayLabel: string;
  /** Whether this hero is for "today" — surfaces a small "I dag"-marker. */
  isToday: boolean;
  /**
   * Fired when the user activates the placeholder action (swap/plan).
   * The parent decides the inline status surface; this component only
   * announces intent.
   */
  onPlaceholderAction: (kind: 'swap' | 'plan') => void;
  /** Inline placeholder status text, if the parent has one to show. */
  placeholderStatus?: string | null;
}

export function MealHero({
  slot,
  dayLabel,
  isToday,
  onPlaceholderAction,
  placeholderStatus,
}: MealHeroProps): JSX.Element {
  const { t } = useTranslation('meals');

  const headerLabel = isToday
    ? t('hero.todayHeading', { day: dayLabel })
    : t('hero.dayHeading', { day: dayLabel });

  if (slot.status === 'away') {
    return (
      <Card padding="md" shadow="low" data-testid="meal-hero-away">
        <HeroDayHeader label={headerLabel} />
        <h2 className="font-display text-display-sm text-text-1">{t('status.awayTitle')}</h2>
        <p className="font-body text-body text-text-2">{t('status.awayBody')}</p>
        {slot.recipe ? (
          <p
            className="mt-2 font-body text-meta text-text-3"
            data-testid="meal-hero-away-recipe-meta"
          >
            {t('status.awayRecipeMeta', { name: slot.recipe.name })}
          </p>
        ) : null}
      </Card>
    );
  }

  if (slot.status === 'skipped') {
    return (
      <Card padding="md" shadow="low" data-testid="meal-hero-skipped">
        <HeroDayHeader label={headerLabel} />
        <h2 className="font-display text-display-sm text-text-1">{t('status.skippedTitle')}</h2>
        <p className="font-body text-body text-text-2">{t('status.skippedBody')}</p>
      </Card>
    );
  }

  if (slot.recipe === null) {
    return (
      <Card padding="md" shadow="low" data-testid="meal-hero-empty">
        <HeroDayHeader label={headerLabel} />
        <h2 className="font-display text-display-sm text-text-1">{t('empty.heroTitle')}</h2>
        <p className="mb-3 font-body text-body text-text-2">{t('empty.heroBody')}</p>
        <Button
          type="button"
          variant="primary"
          onClick={() => onPlaceholderAction('plan')}
          data-testid="meal-hero-plan-button"
        >
          {t('actions.plan')}
        </Button>
        {placeholderStatus ? (
          <p
            className="mt-2 font-body text-meta text-text-3"
            role="status"
            aria-live="polite"
            data-testid="meal-hero-placeholder-status"
          >
            {placeholderStatus}
          </p>
        ) : null}
      </Card>
    );
  }

  const recipe = slot.recipe;
  return (
    <Card padding="md" shadow="low" data-testid="meal-hero-recipe">
      <HeroDayHeader label={headerLabel} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant={CATEGORY_BADGE_VARIANT[recipe.category]} data-testid="meal-hero-category">
          {t(`category.${recipe.category}`)}
        </Badge>
        {recipe.prepTime ? (
          <span className="font-body text-meta text-text-3" data-testid="meal-hero-prep-time">
            {recipe.prepTime}
          </span>
        ) : null}
      </div>
      <h2 className="mb-3 font-display text-display-sm text-text-1" data-testid="meal-hero-name">
        {recipe.name}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onPlaceholderAction('swap')}
          data-testid="meal-hero-swap-button"
        >
          {t('actions.swap')}
        </Button>
        {recipe.url ? (
          <a
            className="inline-flex items-center rounded-pill border border-stroke px-3 py-1.5 font-body text-body text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            href={recipe.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="meal-hero-source-link"
          >
            {t('actions.openSource')}
          </a>
        ) : null}
      </div>
      {placeholderStatus ? (
        <p
          className="mt-3 font-body text-meta text-text-3"
          role="status"
          aria-live="polite"
          data-testid="meal-hero-placeholder-status"
        >
          {placeholderStatus}
        </p>
      ) : null}
    </Card>
  );
}

function HeroDayHeader({ label }: { label: string }): JSX.Element {
  return <p className="mb-1 font-body text-meta uppercase tracking-wider text-mint">{label}</p>;
}
