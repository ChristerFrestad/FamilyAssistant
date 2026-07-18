// Sprint 6 — RecipePickerDialog.
//
// One picker that drives both "Planlegg middag" (empty slot) and
// "Bytt middag" (slot with existing recipe) — the underlying
// PUT /api/meals/swap call uses INSERT ... ON CONFLICT DO UPDATE,
// so the same payload works either way. The parent supplies
// `mode` purely for the dialog title.
//
// Pure presentation: parent owns fetch + state. We render whatever
// recipes/loading/error the parent passes through props. Selecting
// a recipe fires onSelect(recipeId); parent issues the swap call
// and closes the dialog after success.

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../overlay/Modal';
import { Button } from '../base/Button';
import { Badge } from '../display/Badge';
import type { RecipeCategory, RecipeSummary } from '../../meals/mealsApi';

const CATEGORY_BADGE_VARIANT: Record<RecipeCategory, 'mint' | 'cyan' | 'amber'> = {
  rask: 'mint',
  comfort: 'cyan',
  helg: 'amber',
};

const ALL_CATEGORIES: RecipeCategory[] = ['rask', 'comfort', 'helg'];

export type PickerMode = 'plan' | 'swap';

export interface RecipePickerDialogProps {
  open: boolean;
  /** 'plan' for empty slot, 'swap' for an existing recipe. */
  mode: PickerMode;
  /** Day-of-week the picker was opened for (0..6). */
  dayOfWeek: number | null;
  recipes: RecipeSummary[];
  loading: boolean;
  error: string | null;
  /** True while the swap call is in-flight; locks "Velg" buttons. */
  applying: boolean;
  applyError: string | null;
  /** Recipe id of the currently planned recipe for visual cue (optional). */
  currentRecipeId?: number | null;
  onSelect: (recipeId: number) => void;
  onClose: () => void;
}

export function RecipePickerDialog({
  open,
  mode,
  dayOfWeek,
  recipes,
  loading,
  error,
  applying,
  applyError,
  currentRecipeId,
  onSelect,
  onClose,
}: RecipePickerDialogProps): JSX.Element {
  const { t } = useTranslation('meals');

  const [search, setSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<RecipeCategory>>(() => new Set());

  // Reset search/filter every time the dialog re-opens so the picker
  // does not carry over a previous day's filter state.
  useEffect(() => {
    if (open) {
      setSearch('');
      setActiveCategories(new Set());
    }
  }, [open, dayOfWeek]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (activeCategories.size > 0 && !activeCategories.has(r.category)) return false;
      return true;
    });
  }, [recipes, search, activeCategories]);

  function toggleCategory(c: RecipeCategory): void {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  const title = mode === 'plan' ? t('picker.titlePlan') : t('picker.titleSwap');
  const description =
    mode === 'plan'
      ? t('picker.descriptionPlan', { dayOfWeek: dayOfWeek ?? 0 })
      : t('picker.descriptionSwap');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      position="center"
      size="lg"
    >
      <div className="flex flex-col gap-3" data-testid="recipe-picker">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('picker.searchPlaceholder')}
          aria-label={t('picker.searchPlaceholder')}
          className="rounded-md border border-stroke bg-canvas-0 px-3 py-2 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
          data-testid="recipe-picker-search"
        />

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('picker.filterCategoryAria')}
          data-testid="recipe-picker-category-filter"
        >
          {ALL_CATEGORIES.map((c) => {
            const active = activeCategories.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCategory(c)}
                aria-pressed={active}
                className={[
                  'rounded-pill border px-3 py-1.5 font-body text-meta',
                  active
                    ? 'border-mint bg-mint text-ink-contrast'
                    : 'border-stroke bg-canvas-0 text-text-2',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                ].join(' ')}
                data-testid={`recipe-picker-category-${c}`}
              >
                {t(`category.${c}`)}
              </button>
            );
          })}
        </div>

        {loading ? (
          <p
            role="status"
            aria-live="polite"
            className="font-body text-body text-text-2"
            data-testid="recipe-picker-loading"
          >
            {t('picker.loading')}
          </p>
        ) : null}

        {!loading && error ? (
          <p
            role="alert"
            className="font-body text-body text-coral-deep"
            data-testid="recipe-picker-error"
          >
            {error}
          </p>
        ) : null}

        {!loading && !error && filtered.length === 0 ? (
          <p className="font-body text-body text-text-2" data-testid="recipe-picker-no-results">
            {recipes.length === 0
              ? t('picker.noRecipes')
              : t('picker.noResults', { query: search })}
          </p>
        ) : null}

        {!loading && !error && filtered.length > 0 ? (
          <ul
            className="flex max-h-96 flex-col gap-2 overflow-y-auto"
            data-testid="recipe-picker-list"
            aria-label={t('picker.listAria')}
          >
            {filtered.map((r) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                isCurrent={currentRecipeId === r.id}
                disabled={applying || isBlocked(r)}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : null}

        {applyError ? (
          <p
            role="alert"
            className="font-body text-meta text-coral-deep"
            data-testid="recipe-picker-apply-error"
          >
            {applyError}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={applying}
            data-testid="recipe-picker-cancel"
          >
            {t('picker.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function isBlocked(r: RecipeSummary): boolean {
  return r.hiddenByAllergy === true || r.hiddenByDiet === true;
}

interface RowProps {
  recipe: RecipeSummary;
  isCurrent: boolean;
  disabled: boolean;
  onSelect: (recipeId: number) => void;
}

function RecipeRow({ recipe, isCurrent, disabled, onSelect }: RowProps): JSX.Element {
  const { t } = useTranslation('meals');
  const blocked = isBlocked(recipe);
  const warned = !blocked && recipe.shownWithDislikeWarning === true;
  return (
    <li
      className={[
        'flex items-center justify-between gap-3 rounded-md border p-3',
        blocked ? 'border-stroke bg-stroke-strong/10 opacity-60' : 'border-stroke bg-canvas-0',
      ].join(' ')}
      data-testid={`recipe-picker-row-${recipe.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={CATEGORY_BADGE_VARIANT[recipe.category]}>
            {t(`category.${recipe.category}`)}
          </Badge>
          {recipe.prepTime ? (
            <span className="font-body text-meta text-text-3">{recipe.prepTime}</span>
          ) : null}
          {isCurrent ? (
            <Badge variant="cyan" data-testid={`recipe-picker-current-${recipe.id}`}>
              {t('picker.currentBadge')}
            </Badge>
          ) : null}
          {blocked ? (
            <span
              className="font-body text-meta text-coral-deep"
              data-testid={`recipe-picker-blocked-${recipe.id}`}
            >
              {recipe.hiddenByAllergy ? t('picker.blockedByAllergy') : t('picker.blockedByDiet')}
            </span>
          ) : null}
          {warned ? (
            <span
              className="font-body text-meta text-amber-deep"
              data-testid={`recipe-picker-warned-${recipe.id}`}
            >
              {t('picker.dislikeWarning')}
            </span>
          ) : null}
        </div>
        <div
          className="truncate font-body text-body text-text-1"
          title={recipe.name.length > 40 ? recipe.name : undefined}
        >
          {recipe.name}
        </div>
      </div>
      <Button
        type="button"
        variant="primary"
        onClick={() => onSelect(recipe.id)}
        disabled={disabled}
        data-testid={`recipe-picker-select-${recipe.id}`}
      >
        {t('picker.select')}
      </Button>
    </li>
  );
}
