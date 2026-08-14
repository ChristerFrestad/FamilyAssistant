// Recipes library — G0-4 thin list. Families already fetch recipes
// from GET /api/recipes for the Meals plan/swap picker; this screen
// gives that list a home. Create/edit/import land in G1.
//
// Layout:
//   1. Header — title + short description. Adults see a muted G1 note.
//   2. Loading — skeleton cards (same language as Meals).
//   3. Error — card + retry.
//   4. Empty — card when the family has no recipes.
//   5. List — name, category, prepTime, servings. Read-only for all roles.
//
// Children never see an import CTA. Adults stay read-only in G0; the
// G1 note is the only extra adult surface.

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { Badge } from '../components/display/Badge';
import { useAuthContext } from '../auth/AuthContext';
import { fetchRecipes, type RecipeCategory, type RecipeSummary } from '../meals/mealsApi';

const CATEGORY_BADGE_VARIANT: Record<RecipeCategory, 'mint' | 'cyan' | 'amber'> = {
  rask: 'mint',
  comfort: 'cyan',
  helg: 'amber',
};

export function Recipes(): JSX.Element {
  const { t } = useTranslation(['recipes', 'common']);
  const { user } = useAuthContext();
  const isChild = user?.role === 'child';
  const { recipes, isLoading, error, retry } = useRecipesList();

  return (
    <section aria-labelledby="recipes-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 id="recipes-heading" className="font-display text-display-md text-text-1">
          {t('recipes:title')}
        </h1>
        <p className="font-body text-body text-text-2">{t('recipes:description')}</p>
        {!isChild ? (
          <p className="font-body text-meta text-text-3" data-testid="recipes-g1-note">
            {t('recipes:g1Note')}
          </p>
        ) : null}
      </header>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="recipes-skeleton"
          className="flex flex-col gap-3"
        >
          <span className="sr-only">{t('common:status.loading')}</span>
          {[0, 1, 2].map((i) => (
            <Card key={i} padding="md" shadow="low">
              <div className="flex flex-col gap-3">
                <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
                <div className="h-5 w-3/4 animate-pulse rounded-pill bg-stroke-strong" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!isLoading && error !== null ? (
        <Card padding="md" shadow="low" data-testid="recipes-error">
          <div className="flex flex-col gap-3" role="alert">
            <p className="font-body text-body text-text-2">{t('recipes:errors.loadFailed')}</p>
            <Button type="button" variant="secondary" onClick={retry}>
              {t('recipes:actions.retry')}
            </Button>
          </div>
        </Card>
      ) : null}

      {!isLoading && error === null && recipes !== null && recipes.length === 0 ? (
        <Card padding="md" shadow="low" data-testid="recipes-empty">
          <h2 className="mb-1 font-display text-card text-text-1">{t('recipes:empty.title')}</h2>
          <p className="font-body text-body text-text-2">{t('recipes:empty.body')}</p>
        </Card>
      ) : null}

      {!isLoading && error === null && recipes !== null && recipes.length > 0 ? (
        <ul
          className="flex flex-col gap-3"
          data-testid="recipes-list"
          aria-label={t('recipes:listAria')}
        >
          {recipes.map((recipe) => (
            <RecipeListItem key={recipe.id} recipe={recipe} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RecipeListItem({ recipe }: { recipe: RecipeSummary }): JSX.Element {
  const { t } = useTranslation('recipes');
  const badgeVariant = CATEGORY_BADGE_VARIANT[recipe.category] ?? 'cyan';

  return (
    <li data-testid={`recipe-row-${recipe.id}`}>
      <Card padding="md" shadow="low">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant}>{t(`category.${recipe.category}`)}</Badge>
            {recipe.prepTime ? (
              <span className="font-body text-meta text-text-3">{recipe.prepTime}</span>
            ) : null}
            {recipe.servings !== null ? (
              <span className="font-body text-meta text-text-3">
                {t('meta.servings', { count: recipe.servings })}
              </span>
            ) : null}
          </div>
          <h2 className="font-display text-card text-text-1">{recipe.name}</h2>
        </div>
      </Card>
    </li>
  );
}

function useRecipesList(): {
  recipes: RecipeSummary[] | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
} {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setIsLoading(true);
    setError(null);

    fetchRecipes(ctrl.signal).then(
      (res) => {
        if (ctrl.signal.aborted) return;
        setRecipes(res.recipes);
        setIsLoading(false);
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setRecipes(null);
        setIsLoading(false);
        setError(err instanceof Error ? err : new Error('Failed to load recipes'));
      }
    );

    return () => ctrl.abort();
  }, [reloadKey]);

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  return { recipes, isLoading, error, retry };
}
