// Recipes library — G1. Adults create, import from URL, and open
// the editor. Children get the same list as read-only links.
// Recipes stay off primary nav; Meals links here.

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { Badge } from '../components/display/Badge';
import { Field } from '../components/form/Field';
import { Input } from '../components/form/Input';
import { Modal } from '../components/overlay/Modal';
import { useAuthContext } from '../auth/AuthContext';
import {
  fetchRecipes,
  importRecipeFromUrl,
  MealsApiError,
  type RecipeCategory,
  type RecipeSourceFilter,
  type RecipeSourceType,
  type RecipeSummary,
} from '../meals/mealsApi';

const CATEGORY_BADGE_VARIANT: Record<RecipeCategory, 'mint' | 'cyan' | 'amber'> = {
  rask: 'mint',
  comfort: 'cyan',
  helg: 'amber',
};

const ALL_CATEGORIES: RecipeCategory[] = ['rask', 'comfort', 'helg'];
const SOURCE_FILTERS: RecipeSourceFilter[] = ['all', 'mine', 'imported', 'ai'];

function isAdultRole(role: string | undefined): boolean {
  return role === 'owner' || role === 'adult';
}

function recipeSourceType(recipe: RecipeSummary): RecipeSourceType | string {
  return recipe.sourceType || 'manual';
}

export function Recipes(): JSX.Element {
  const { t } = useTranslation(['recipes', 'common']);
  const { user } = useAuthContext();
  const isAdult = isAdultRole(user?.role);
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<Set<RecipeCategory>>(() => new Set());
  const [source, setSource] = useState<RecipeSourceFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { recipes, isLoading, error, retry } = useRecipesList({
    source,
    includeInactive: isAdult && includeInactive,
  });

  const visible = useMemo(() => {
    if (!recipes) return [];
    const q = search.trim().toLowerCase();
    return recipes.filter((recipe) => {
      if (q && !recipe.name.toLowerCase().includes(q)) return false;
      if (categories.size > 0 && !categories.has(recipe.category)) return false;
      return true;
    });
  }, [recipes, search, categories]);

  const filtersOn = search.trim() !== '' || categories.size > 0 || source !== 'all';

  function toggleCategory(category: RecipeCategory): void {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function clearFilters(): void {
    setSearch('');
    setCategories(new Set());
    setSource('all');
  }

  const adultActions = isAdult ? (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button
        type="button"
        variant="primary"
        data-testid="recipes-new"
        onClick={() => navigate('/recipes/new')}
      >
        {t('recipes:actions.new')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        data-testid="recipes-import-cta"
        onClick={() => setImportOpen(true)}
      >
        {t('recipes:actions.importUrl')}
      </Button>
    </div>
  ) : null;

  return (
    <section aria-labelledby="recipes-heading" className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="recipes-heading" className="font-display text-display-md text-text-1">
            {t('recipes:title')}
          </h1>
          <p className="font-body text-body text-text-2">{t('recipes:description')}</p>
        </div>
        {adultActions}
      </header>

      {!isLoading && error === null ? (
        <div className="flex flex-col gap-3" data-testid="recipes-filters">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('recipes:filters.search')}
            aria-label={t('recipes:filters.search')}
            data-testid="recipes-search"
          />
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t('recipes:filters.categoryAria')}
            data-testid="recipes-category-filter"
          >
            {ALL_CATEGORIES.map((category) => {
              const active = categories.has(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  aria-pressed={active}
                  className={[
                    'rounded-pill border px-3 py-1.5 font-body text-meta',
                    active
                      ? 'border-mint bg-mint text-ink-contrast'
                      : 'border-stroke bg-canvas-0 text-text-2',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                  ].join(' ')}
                  data-testid={`recipes-category-${category}`}
                >
                  {t(`recipes:category.${category}`)}
                </button>
              );
            })}
          </div>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t('recipes:filters.source')}
            data-testid="recipes-source-filter"
          >
            {SOURCE_FILTERS.map((value) => {
              const active = source === value;
              const labelKey =
                value === 'all'
                  ? 'recipes:filters.sourceAll'
                  : value === 'mine'
                    ? 'recipes:filters.sourceMine'
                    : value === 'imported'
                      ? 'recipes:filters.sourceImported'
                      : 'recipes:filters.sourceAi';
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSource(value)}
                  aria-pressed={active}
                  className={[
                    'rounded-pill border px-3 py-1.5 font-body text-meta',
                    active
                      ? 'border-mint bg-mint text-ink-contrast'
                      : 'border-stroke bg-canvas-0 text-text-2',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                  ].join(' ')}
                  data-testid={`recipes-source-${value}`}
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
          {isAdult ? (
            <label className="inline-flex items-center gap-2 font-body text-meta text-text-2">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                data-testid="recipes-inactive-toggle"
                className="h-4 w-4 rounded-sm border-stroke accent-mint focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
              />
              {t('recipes:filters.inactive')}
            </label>
          ) : null}
        </div>
      ) : null}

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

      {!isLoading && error === null && recipes !== null && visible.length === 0 && !filtersOn ? (
        <Card padding="md" shadow="low" data-testid="recipes-empty">
          <h2 className="mb-1 font-display text-card text-text-1">{t('recipes:empty.title')}</h2>
          <p className="font-body text-body text-text-2">
            {isAdult ? t('recipes:empty.bodyAdult') : t('recipes:empty.bodyChild')}
          </p>
          {isAdult ? <div className="mt-3">{adultActions}</div> : null}
        </Card>
      ) : null}

      {!isLoading && error === null && recipes !== null && visible.length === 0 && filtersOn ? (
        <Card padding="md" shadow="low" data-testid="recipes-filter-empty">
          <p className="font-body text-body text-text-2">{t('recipes:empty.filtered')}</p>
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={clearFilters}>
              {t('recipes:actions.clearFilters')}
            </Button>
          </div>
        </Card>
      ) : null}

      {!isLoading && error === null && visible.length > 0 ? (
        <ul
          className="flex flex-col gap-3"
          data-testid="recipes-list"
          aria-label={t('recipes:listAria')}
        >
          {visible.map((recipe) => (
            <RecipeListItem key={recipe.id} recipe={recipe} />
          ))}
        </ul>
      ) : null}

      {isAdult ? (
        <ImportUrlSheet
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={(recipeId, blocked) => {
            setImportOpen(false);
            navigate(`/recipes/${recipeId}`, {
              state: blocked && blocked.length > 0 ? { blockedIngredients: blocked } : undefined,
            });
          }}
        />
      ) : null}
    </section>
  );
}

function RecipeListItem({ recipe }: { recipe: RecipeSummary }): JSX.Element {
  const { t } = useTranslation('recipes');
  const badgeVariant = CATEGORY_BADGE_VARIANT[recipe.category] ?? 'cyan';
  const sourceType = recipeSourceType(recipe);
  const showAllergy = Boolean(recipe.hiddenByAllergy || recipe.shownWithDislikeWarning);
  const inactive = recipe.active === false;

  return (
    <li>
      <Link
        to={`/recipes/${recipe.id}`}
        data-testid={`recipe-row-${recipe.id}`}
        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
      >
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
              {sourceType === 'imported' ? (
                <span className="font-body text-meta text-text-3">{t('meta.sourceImported')}</span>
              ) : null}
              {sourceType === 'ai' ? (
                <span className="font-body text-meta text-text-3">{t('meta.sourceAi')}</span>
              ) : null}
              {showAllergy ? <Badge variant="amber">{t('meta.allergyWarning')}</Badge> : null}
              {inactive ? <Badge variant="rose">{t('status.inactive')}</Badge> : null}
            </div>
            <h2 className="font-display text-card text-text-1">{recipe.name}</h2>
          </div>
        </Card>
      </Link>
    </li>
  );
}

function ImportUrlSheet({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (recipeId: number, blocked?: Array<{ name: string }>) => void;
}): JSX.Element {
  const { t } = useTranslation(['recipes', 'common']);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isDesktop = useIsMd();

  useEffect(() => {
    if (!open) {
      setUrl('');
      setFieldError(null);
      setFatalError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  async function submit(): Promise<void> {
    const trimmed = url.trim();
    setFieldError(null);
    setFatalError(null);
    if (!trimmed) {
      setFieldError(t('recipes:import.invalid'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await importRecipeFromUrl(trimmed);
      onImported(res.recipeId, res.blockedIngredients ?? res.recipe?.blockedIngredients);
    } catch (err) {
      if (err instanceof MealsApiError && err.status >= 400 && err.status < 500) {
        const detail = err.message;
        const safe = detail.length > 0 && detail.length <= 160 && !detail.includes('<');
        setFieldError(
          safe && detail !== `HTTP ${err.status}` ? detail : t('recipes:import.invalid')
        );
      } else {
        setFatalError(t('recipes:import.failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('recipes:import.title')}
      description={t('recipes:import.description')}
      position={isDesktop ? 'center' : 'bottom'}
      size={isDesktop ? 'md' : 'full'}
    >
      <form
        className="flex flex-col gap-3"
        data-testid="recipes-import-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label={t('recipes:import.url')}
          {...(fieldError ? { error: fieldError } : {})}
          required
        >
          <Input
            ref={inputRef}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            data-testid="recipes-import-url"
          />
        </Field>
        {fatalError ? (
          <p
            role="alert"
            className="font-body text-body text-rose-deep"
            data-testid="recipes-import-error"
          >
            {fatalError}
          </p>
        ) : null}
        <div className="flex flex-row-reverse items-center justify-start gap-2 pt-2">
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            data-testid="recipes-import-submit"
          >
            {t('recipes:import.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common:actions.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function useIsMd(): boolean {
  const [isMd, setIsMd] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(min-width: 768px)');
    const update = (): void => setIsMd(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMd;
}

function useRecipesList(query: { source: RecipeSourceFilter; includeInactive: boolean }): {
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

    fetchRecipes(ctrl.signal, {
      source: query.source,
      includeInactive: query.includeInactive,
    }).then(
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
  }, [reloadKey, query.source, query.includeInactive]);

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  return { recipes, isLoading, error, retry };
}
