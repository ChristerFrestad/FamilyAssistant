// Meals screen — third real screen in the v2 SPA after Dashboard and
// Family. Sprint 6 turns the placeholder swap/plan-buttons into real
// actions: tapping "Planlegg middag" or "Bytt middag" opens a recipe
// picker that calls PUT /api/meals/swap. "Marker tilberedt" opens the
// pantry-deduction dialog (smart-coupling, PR #88).
//
// Layout:
//   1. Header  — "Ukens meny" + "Uke {weekYear}" subtitle
//   2. WeekStrip — horizontal pill row, scrolls on mobile
//   3. MealHero— feature card for the selected day
//   4. RecipeIngredients — under the hero when a recipe is set
//   5. WeekList— compact 7-row summary
//
// State:
//   - useMealsData() owns fetch + selected-day; we read `family`
//     to compute the ingredient scale via computeScale().
//   - useRecipePicker() owns the picker dialog state and the swap
//     mutation.
//   - usePantryDeduction() owns the mark-cooked dialog flow.
//   - Loading → skeleton (WeekStrip + hero placeholders).
//   - Meal-plan fetch error → full error-card with retry.

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Card } from '../components/layout/Card';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { WeekSwitcher } from '../components/layout/WeekSwitcher';
import { Button } from '../components/base/Button';
import { WeekStrip } from '../components/layout/WeekStrip';
import { mealSlotDots } from '../components/meals/DayStrip';
import { MealHero } from '../components/meals/MealHero';
import { MarkCookedDialog } from '../components/meals/MarkCookedDialog';
import { RecipePickerDialog } from '../components/meals/RecipePickerDialog';
import { RecipeIngredients } from '../components/meals/RecipeIngredients';
import { WeekList } from '../components/meals/WeekList';
import {
  useMealsData,
  computeScale,
  normalizeWeekSlots,
  type FamilyFetchState,
} from '../meals/useMealsData';
import { usePantryDeduction } from '../meals/usePantryDeduction';
import { useRecipePicker } from '../meals/useRecipePicker';
import { clearMeal } from '../meals/mealsApi';
import { useSelectedWeek } from '../hooks/useSelectedWeek';
import type { MealSlot } from '../meals/mealsApi';

const RESULT_DISMISS_MS = 3000;

export function Meals(): JSX.Element {
  const { t } = useTranslation(['meals', 'common']);
  const navigate = useNavigate();
  const { weekYear, goPrevWeek, goNextWeek, pathWithWeek } = useSelectedWeek();
  const {
    meals,
    isLoading,
    error,
    family,
    selectedDayIndex,
    todayIndex,
    selectDay,
    retry,
    replaceMeals,
  } = useMealsData({ weekYear });
  const [actionError, setActionError] = useState<string | null>(null);

  // Sprint 6 — meal-cooked dialog. After confirm/skip/cancel we refetch
  // meals so the hero re-renders with the new status.
  const deduction = usePantryDeduction(retry);
  const handleMarkCooked = useCallback(
    (mealId: number) => {
      void deduction.open(mealId);
    },
    [deduction]
  );

  // Auto-dismiss the result toast inside the dialog after a short
  // window so a successful confirm/skip closes itself rather than
  // leaving the user staring at the dialog.
  useEffect(() => {
    if (!deduction.state.resultMessage) return undefined;
    const timer = setTimeout(() => deduction.close(), RESULT_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [deduction.state.resultMessage, deduction]);

  // Sprint 6 — recipe picker dialog. Opens for plan (empty slot) and
  // swap (existing recipe) flows. Refetches meals after a successful
  // swap so the hero updates immediately.
  const picker = useRecipePicker(weekYear, (result) => {
    if (result.week) replaceMeals(result.week);
    else retry();
  });
  const handlePlan = useCallback(
    (dayOfWeek: number) => {
      void picker.openForPlan(dayOfWeek);
    },
    [picker]
  );
  const handleSwap = useCallback(
    (dayOfWeek: number, currentRecipeId: number) => {
      setActionError(null);
      void picker.openForSwap(dayOfWeek, currentRecipeId);
    },
    [picker]
  );
  const handleSelectDay = useCallback(
    (index: number) => {
      selectDay(index);
      const hero = document.getElementById('meals-hero');
      if (hero && typeof hero.scrollIntoView === 'function') {
        hero.scrollIntoView({ block: 'nearest' });
      }
    },
    [selectDay]
  );
  const handleOpenRecipe = useCallback(
    (recipeId: number) => {
      navigate(`/recipes/${recipeId}`);
    },
    [navigate]
  );
  const handleRemove = useCallback(
    (dayOfWeek: number) => {
      setActionError(null);
      void clearMeal(weekYear, dayOfWeek)
        .then((result) => {
          if (result.week) replaceMeals(result.week);
          else retry();
        })
        .catch(() => {
          setActionError(t('meals:errors.removeFailed'));
        });
    },
    [replaceMeals, retry, t, weekYear]
  );

  const shortDayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`meals:daysShort.${i}`));
  const longDayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`meals:daysLong.${i}`));
  const todayLabel = t('meals:todayLabel');

  return (
    <section aria-labelledby="meals-heading" className="flex flex-col gap-4">
      <ScreenHeader
        eyebrow={t('meals:weekHeader.label')}
        title={t('meals:title')}
        titleId="meals-heading"
        actions={
          <div className="flex items-center gap-2">
            <Link
              to={pathWithWeek('/shopping')}
              className="shrink-0 font-body text-body text-mint underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
              data-testid="meals-open-shopping"
            >
              {t('meals:actions.openShopping')}
            </Link>
            <Link
              to="/recipes"
              className="shrink-0 font-body text-body text-mint underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
              data-testid="meals-open-library"
            >
              {t('meals:actions.openLibrary')}
            </Link>
          </div>
        }
      >
        <WeekSwitcher
          label={t('meals:weekHeader.week', { weekYear: meals?.weekYear ?? weekYear })}
          prevLabel={t('meals:weekNav.prevAria')}
          nextLabel={t('meals:weekNav.nextAria')}
          onPrev={goPrevWeek}
          onNext={goNextWeek}
          testIdPrefix="meals"
        />
      </ScreenHeader>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="meals-skeleton"
          className="flex flex-col gap-3"
        >
          <span className="sr-only">{t('common:status.loading')}</span>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-16 w-[72px] flex-shrink-0 animate-pulse rounded-lg bg-stroke-strong"
              />
            ))}
          </div>
          <Card padding="md" shadow="low">
            <div className="flex flex-col gap-3">
              <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
              <div className="h-5 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
              <div className="h-4 w-1/2 animate-pulse rounded-pill bg-stroke-strong" />
            </div>
          </Card>
        </div>
      ) : null}

      {!isLoading && error !== null ? (
        <Card padding="md" shadow="low" data-testid="meals-error">
          <div className="flex flex-col gap-3" role="alert">
            <p className="font-body text-body text-text-2">{t('meals:errors.loadFailed')}</p>
            <Button type="button" variant="secondary" onClick={retry}>
              {t('meals:actions.retry')}
            </Button>
          </div>
        </Card>
      ) : null}

      {!isLoading && error === null && meals !== null && meals.readOnly === true ? (
        // Past week with no stored plan (F2): nothing was written, and
        // there is nothing to plan or cook — show it empty and read-only.
        <Card padding="md" shadow="low" data-testid="meals-week-readonly">
          <h2 className="mb-1 font-display text-card text-text-1">{t('meals:readOnly.title')}</h2>
          <p className="font-body text-body text-text-2">{t('meals:readOnly.body')}</p>
        </Card>
      ) : null}

      {!isLoading && error === null && meals !== null && meals.readOnly !== true ? (
        <MealsContent
          slots={meals.meals}
          selectedDayIndex={selectedDayIndex}
          todayIndex={todayIndex}
          shortDayLabels={shortDayLabels}
          longDayLabels={longDayLabels}
          todayLabel={todayLabel}
          dayStripAria={t('meals:dayStripAria')}
          onSelectDay={handleSelectDay}
          onPlan={handlePlan}
          onSwap={handleSwap}
          onMarkCooked={handleMarkCooked}
          onOpenRecipe={handleOpenRecipe}
          onRemove={handleRemove}
          actionError={actionError}
          weekListLabels={{
            heading: t('meals:weekList.heading'),
            emptyRow: t('meals:weekList.emptyRow'),
            away: t('meals:weekList.awayLabel'),
            skipped: t('meals:weekList.skippedLabel'),
            removed: t('meals:weekList.removedLabel'),
          }}
          family={family}
          weekEmptyTitle={t('meals:empty.weekTitle')}
          weekEmptyBody={t('meals:empty.weekBody')}
        />
      ) : null}

      <MarkCookedDialog
        state={{
          ...deduction.state,
          resultMessage:
            deduction.state.resultMessage === 'applied'
              ? t('meals:cookedDialog.successApplied')
              : deduction.state.resultMessage === 'skipped'
                ? t('meals:cookedDialog.successSkipped')
                : null,
          error: deduction.state.error !== null ? t('meals:cookedDialog.errorLoad') : null,
          applyError:
            deduction.state.applyError !== null ? t('meals:cookedDialog.errorApply') : null,
        }}
        onConfirm={deduction.confirm}
        onSkip={deduction.skip}
        onCancel={deduction.cancel}
        onClose={deduction.close}
      />

      <RecipePickerDialog
        open={picker.state.open}
        mode={picker.state.mode}
        dayOfWeek={picker.state.dayOfWeek}
        recipes={picker.state.recipes}
        loading={picker.state.loading}
        error={picker.state.error !== null ? t('meals:picker.errorLoad') : null}
        applying={picker.state.applying}
        applyError={picker.state.applyError !== null ? t('meals:picker.errorApply') : null}
        currentRecipeId={picker.state.currentRecipeId}
        onSelect={picker.select}
        onClose={picker.close}
      />
    </section>
  );
}

// ---------------------------------------------------------------------
// Internal helper component — keeps Meals.tsx scannable. Pulled out
// inline rather than promoting to its own file because nothing else
// will ever consume this layout.
// ---------------------------------------------------------------------

interface MealsContentProps {
  slots: MealSlot[];
  selectedDayIndex: number;
  todayIndex: number;
  shortDayLabels: string[];
  longDayLabels: string[];
  todayLabel: string;
  dayStripAria: string;
  onSelectDay: (index: number) => void;
  onPlan: (dayOfWeek: number) => void;
  onSwap: (dayOfWeek: number, currentRecipeId: number) => void;
  onMarkCooked: (mealId: number) => void;
  onOpenRecipe: (recipeId: number) => void;
  onRemove: (dayOfWeek: number) => void;
  actionError: string | null;
  weekListLabels: {
    heading: string;
    emptyRow: string;
    away: string;
    skipped: string;
    removed: string;
  };
  family: FamilyFetchState;
  weekEmptyTitle: string;
  weekEmptyBody: string;
}

function MealsContent({
  slots,
  selectedDayIndex,
  todayIndex,
  shortDayLabels,
  longDayLabels,
  todayLabel,
  dayStripAria,
  onSelectDay,
  onPlan,
  onSwap,
  onMarkCooked,
  onOpenRecipe,
  onRemove,
  actionError,
  weekListLabels,
  family,
  weekEmptyTitle,
  weekEmptyBody,
}: MealsContentProps): JSX.Element {
  // Always 7 slots indexed by dayOfWeek (0=Mon..6=Sun), so
  // selectedDayIndex/todayIndex/labels line up even if a row is missing.
  const weekSlots = normalizeWeekSlots(slots);
  const selectedSlot = weekSlots[selectedDayIndex] ?? weekSlots[0];
  const allEmpty = weekSlots.every((s) => s.recipe === null);

  if (selectedSlot === undefined) {
    // Defensive fallback — backend contract guarantees 7 slots, but
    // the UI should not throw if the contract ever drifts.
    return (
      <Card padding="md" shadow="low" data-testid="meals-empty">
        <p className="font-body text-body text-text-2">{weekEmptyTitle}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="meals-content">
      <WeekStrip
        selectedIndex={selectedDayIndex}
        todayIndex={todayIndex}
        shortDayLabels={shortDayLabels}
        todayLabel={todayLabel}
        ariaLabel={dayStripAria}
        onSelect={onSelectDay}
        dots={mealSlotDots(weekSlots)}
        testIdPrefix="day"
      />

      <div id="meals-hero">
        <MealHero
          slot={selectedSlot}
          dayLabel={longDayLabels[selectedDayIndex] ?? ''}
          isToday={selectedDayIndex === todayIndex}
          onPlan={onPlan}
          onSwap={onSwap}
          onMarkCooked={onMarkCooked}
          onOpenRecipe={onOpenRecipe}
          onRemove={onRemove}
        />
      </div>

      {actionError ? (
        <p
          className="font-body text-body text-rose-deep"
          role="alert"
          data-testid="meals-action-error"
        >
          {actionError}
        </p>
      ) : null}

      {selectedSlot.recipe !== null &&
      selectedSlot.status !== 'away' &&
      selectedSlot.status !== 'skipped' ? (
        <Card padding="md" shadow="low" data-testid="meals-recipe-card">
          <RecipeIngredients
            recipe={selectedSlot.recipe}
            scale={computeScale(selectedSlot.recipe, family)}
          />
        </Card>
      ) : null}

      {allEmpty ? (
        <Card padding="md" shadow="low" data-testid="meals-week-empty">
          <h2 className="mb-1 font-display text-card text-text-1">{weekEmptyTitle}</h2>
          <p className="font-body text-body text-text-2">{weekEmptyBody}</p>
        </Card>
      ) : (
        <WeekList
          slots={weekSlots}
          selectedIndex={selectedDayIndex}
          todayIndex={todayIndex}
          longDayLabels={longDayLabels}
          emptyRowLabel={weekListLabels.emptyRow}
          awayLabel={weekListLabels.away}
          skippedLabel={weekListLabels.skipped}
          removedLabel={weekListLabels.removed}
          todayLabel={todayLabel}
          sectionLabel={weekListLabels.heading}
          onSelect={onSelectDay}
          onSelectEmpty={onPlan}
        />
      )}
    </div>
  );
}
