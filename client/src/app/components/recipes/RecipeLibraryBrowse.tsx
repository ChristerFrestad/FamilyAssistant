// Shared recipe library. Search is server-side so title, ingredient,
// source and time filters stay in one place.

import type { FormEvent, JSX } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../base/Button';
import { Card } from '../layout/Card';
import {
  copyLibraryRecipe,
  fetchRecipeLibrary,
  type LibraryRecipeSummary,
} from '../../meals/mealsApi';

const TIME_OPTIONS = [20, 30, 45, 60];

export function RecipeLibraryBrowse({
  canAdd,
  onAdded,
}: {
  canAdd: boolean;
  onAdded?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation('recipes');
  const [q, setQ] = useState('');
  const [ingredient, setIngredient] = useState('');
  const [source, setSource] = useState('');
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<LibraryRecipeSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);

  async function load(next = { q, ingredient, source, maxMinutes }): Promise<void> {
    setLoading(true);
    setError(false);
    try {
      const res = await fetchRecipeLibrary(next);
      setRecipes(res.recipes);
      setSources(res.sources);
    } catch {
      setError(true);
      setRecipes(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load({ q: '', ingredient: '', source: '', maxMinutes: null });
    // Initial browse only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    setNotice(null);
    setSearched(true);
    void load();
  }

  async function add(recipe: LibraryRecipeSummary): Promise<void> {
    setBusyId(recipe.id);
    setNotice(null);
    try {
      const result = await copyLibraryRecipe(recipe.id);
      onAdded?.();
      setNotice(
        result.alreadyAdded
          ? t('library.alreadyAdded', { title: recipe.title })
          : t('library.added', { title: recipe.title })
      );
    } catch {
      setNotice(t('library.addFailed'));
    } finally {
      setBusyId(null);
    }
  }

  if (!loading && !error && !searched && recipes && recipes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="recipe-library-heading">
      <h2 id="recipe-library-heading" className="font-display text-card text-text-1">
        {t('library.heading')}
      </h2>
      <form className="flex flex-col gap-2" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1 font-body text-meta text-text-2">
          {t('library.searchLabel')}
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="min-h-6 rounded-md border border-stroke bg-surface px-3 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            data-testid="library-search"
          />
        </label>
        <label className="flex flex-col gap-1 font-body text-meta text-text-2">
          {t('library.ingredientLabel')}
          <input
            value={ingredient}
            onChange={(event) => setIngredient(event.target.value)}
            className="min-h-6 rounded-md border border-stroke bg-surface px-3 font-body text-body text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            data-testid="library-ingredient"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 font-body text-meta text-text-2">
            {t('library.sourceLabel')}
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="min-h-6 rounded-md border border-stroke bg-surface px-2 font-body text-body text-text-1"
              data-testid="library-source"
            >
              <option value="">{t('library.allSources')}</option>
              {sources.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-body text-meta text-text-2">
            {t('library.timeLabel')}
            <select
              value={maxMinutes ?? ''}
              onChange={(event) =>
                setMaxMinutes(event.target.value ? Number(event.target.value) : null)
              }
              className="min-h-6 rounded-md border border-stroke bg-surface px-2 font-body text-body text-text-1"
              data-testid="library-time"
            >
              <option value="">{t('library.anyTime')}</option>
              {TIME_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t('library.withinMinutes', { count: minutes })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit" variant="secondary" data-testid="library-submit">
          {t('library.search')}
        </Button>
      </form>

      <p role="status" aria-live="polite" className="font-body text-body text-text-2">
        {notice}
      </p>

      {loading ? (
        <p role="status" data-testid="library-loading">
          {t('library.loading')}
        </p>
      ) : null}
      {!loading && error ? (
        <p role="alert" data-testid="library-error">
          {t('library.loadFailed')}
        </p>
      ) : null}
      {!loading && !error && recipes && recipes.length === 0 ? (
        <p data-testid="library-empty">{t('library.empty')}</p>
      ) : null}
      {!loading && recipes && recipes.length > 0 ? (
        <ul className="flex flex-col gap-3" data-testid="library-list">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Card padding="md" shadow="low" className="flex gap-3">
                {recipe.imageUrl ? (
                  <img
                    src={recipe.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 rounded-md object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h3 className="font-display text-card text-text-1">{recipe.title}</h3>
                  <p className="font-body text-meta text-text-3">
                    {recipe.sourceName}
                    {recipe.totalTimeMin ? ` · ${recipe.totalTimeMin} min` : ''}
                  </p>
                  {canAdd ? (
                    <Button
                      type="button"
                      variant="primary"
                      loading={busyId === recipe.id}
                      onClick={() => void add(recipe)}
                      data-testid={`library-add-${recipe.id}`}
                    >
                      {t('library.add')}
                    </Button>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
