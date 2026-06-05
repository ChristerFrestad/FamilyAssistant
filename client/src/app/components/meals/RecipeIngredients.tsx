// Ingredient list for the selected day's recipe.
//
// Three render modes (mutually exclusive):
//   1. Recipe has servings (number > 0)
//      → ingredients rendered with scaled quantities; meta line
//        states "Skalert til X porsjoner" (with the original
//        servings count in parentheses for transparency).
//   2. Recipe is missing servings (null/0/NaN) — the documented
//      post-pilot import path may produce this. We render the
//      original quantities and surface a warning badge so users
//      know the numbers are not portion-adjusted.
//   3. Recipe has no ingredients at all
//      → render a neutral "no ingredients registered" line.
//
// We log a console.warn whenever case (2) hits because Christer
// asked for telemetry on recipes-without-servings during pilot.
// The log emits a stable key + recipe.id so log aggregation can
// count occurrences without leaking PII.
//
// Pure render. The caller computes `scale` via computeScale() in
// useMealsData.ts so the component does not have to know about
// the family fetch state.

import type { JSX } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../display/Badge';
import type { MealRecipe } from '../../meals/mealsApi';

export interface RecipeIngredientsProps {
  recipe: MealRecipe;
  /**
   * Effective scale factor from useMealsData.computeScale().
   *   - number  → multiply ingredient quantities by this.
   *   - null    → recipe.servings is missing/invalid; show un-scaled
   *               + the warning badge.
   */
  scale: number | null;
}

const SCALING_TELEMETRY_KEY = 'meals.recipe.scalingUnavailable';

export function RecipeIngredients({ recipe, scale }: RecipeIngredientsProps): JSX.Element {
  const { t } = useTranslation('meals');

  const scalingUnavailable = scale === null;

  // Defensive telemetry: emit one warn per render when servings is
  // missing. This shows up in the browser console during pilot. We
  // intentionally do NOT POST to a backend endpoint — the value is
  // identifying counts of occurrences, and console-side surfacing is
  // enough for the pilot's diagnostic needs.
  useEffect(() => {
    if (scalingUnavailable) {
      console.warn(SCALING_TELEMETRY_KEY, {
        recipeId: recipe.id,
        servings: recipe.servings,
      });
    }
  }, [scalingUnavailable, recipe.id, recipe.servings]);

  if (recipe.ingredients.length === 0) {
    return (
      <section aria-labelledby="ingredients-heading" data-testid="recipe-ingredients-empty">
        <h3 id="ingredients-heading" className="mb-2 font-display text-card text-text-1">
          {t('recipe.ingredients')}
        </h3>
        <p className="font-body text-body text-text-3">{t('recipe.noIngredients')}</p>
      </section>
    );
  }

  const effectiveScale = scale ?? 1;
  const scaledServings =
    typeof recipe.servings === 'number' && recipe.servings > 0
      ? Math.round(recipe.servings * effectiveScale * 10) / 10
      : null;

  return (
    <section aria-labelledby="ingredients-heading" data-testid="recipe-ingredients">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="ingredients-heading" className="font-display text-card text-text-1">
          {t('recipe.ingredients')}
        </h3>
        {scalingUnavailable ? (
          <Badge variant="amber" data-testid="recipe-scaling-unavailable-badge">
            {t('recipe.scalingUnavailable.label')}
          </Badge>
        ) : scaledServings !== null && recipe.servings !== null ? (
          <span className="font-body text-meta text-text-3" data-testid="recipe-scaled-servings">
            {t('recipe.scaledMeta', {
              effective: formatServings(scaledServings),
              original: recipe.servings,
            })}
          </span>
        ) : null}
      </div>
      {scalingUnavailable ? (
        <p
          className="mb-3 font-body text-meta text-text-3"
          data-testid="recipe-scaling-unavailable-description"
        >
          {t('recipe.scalingUnavailable.description')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5" role="list" data-testid="recipe-ingredient-list">
        {recipe.ingredients.map((ing, idx) => {
          const qty = ing.qty * effectiveScale;
          return (
            <li
              key={ing.id ?? `${ing.name}-${idx}`}
              className="flex items-baseline justify-between gap-3 font-body text-body"
              data-testid={`recipe-ingredient-${idx}`}
            >
              <span className="text-text-1">{ing.name}</span>
              <span className="text-text-2 font-mono">
                {formatQty(qty)} {ing.unit}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Format an ingredient quantity. Round to one decimal when < 10,
 * to a whole number otherwise — mirrors the way handlelisten in the
 * legacy frontend rendered numbers and avoids "0.30000000000000004".
 */
export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs < 10) {
    return (Math.round(value * 10) / 10).toString();
  }
  return Math.round(value).toString();
}

/** Servings are typically integers but slider can produce 1.25 etc. */
export function formatServings(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return value.toString();
  return (Math.round(value * 10) / 10).toString();
}
