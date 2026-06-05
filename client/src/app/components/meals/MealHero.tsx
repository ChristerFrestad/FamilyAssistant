// Hero card for the currently selected day in the Meals screen.
//
// States rendered (mutually exclusive, in this priority order):
//   1. status === 'away'   → "Borte denne dagen" panel + optional
//                             notes; recipe-name shown as small meta
//                             if present (some users plan a meal but
//                             then mark themselves away).
//   2. status === 'skipped'→ "Hopp over"-panel.
//   3. recipe === null     → empty-state panel with "Planlegg middag"
//                             CTA that opens the recipe picker.
//   4. recipe present      → full hero with category-tag, prep-time,
//                             title, "Marker tilberedt", "Bytt middag"
//                             (opens picker), "Open source" link.

import type { JSX } from 'react';
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
   * Sprint 6 — fires when the user taps "Planlegg middag" on an
   * empty slot. Parent opens the recipe picker dialog for the slot's
   * dayOfWeek.
   */
  onPlan?: (dayOfWeek: number) => void;
  /**
   * Sprint 6 — fires when the user taps "Bytt middag". Parent opens
   * the same picker dialog with the current recipe id pre-marked.
   */
  onSwap?: (dayOfWeek: number, currentRecipeId: number) => void;
  /**
   * Sprint 6 — fires when the user taps "Marker tilberedt". Optional
   * so existing tests that do not exercise the cook-flow can keep
   * rendering the hero without supplying a handler.
   */
  onMarkCooked?: (mealId: number) => void;
}

export function MealHero({
  slot,
  dayLabel,
  isToday,
  onPlan,
  onSwap,
  onMarkCooked,
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
          onClick={() => onPlan?.(slot.dayOfWeek)}
          disabled={onPlan == null}
          data-testid="meal-hero-plan-button"
        >
          {t('actions.plan')}
        </Button>
      </Card>
    );
  }

  const recipe = slot.recipe;
  const isCooked = slot.status === 'cooked' || slot.status === 'eaten';
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
        {isCooked ? (
          <Badge variant="mint" data-testid="meal-hero-cooked-badge">
            {t('actions.alreadyCooked')}
          </Badge>
        ) : null}
      </div>
      <h2 className="mb-3 font-display text-display-sm text-text-1" data-testid="meal-hero-name">
        {recipe.name}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {!isCooked && onMarkCooked ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => onMarkCooked(slot.id)}
            data-testid="meal-hero-mark-cooked-button"
          >
            {t('actions.markCooked')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSwap?.(slot.dayOfWeek, recipe.id)}
          disabled={onSwap == null}
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
    </Card>
  );
}

function HeroDayHeader({ label }: { label: string }): JSX.Element {
  return <p className="mb-1 font-body text-meta uppercase tracking-wider text-mint">{label}</p>;
}
