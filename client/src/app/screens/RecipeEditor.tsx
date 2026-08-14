// Recipe create / edit / read-only detail.
//
// /recipes/new  — adult form; children redirect to the library.
// /recipes/:id  — adult edit + deactivate; child read-only text.

import type { FormEvent, JSX, KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '../components/layout/Card';
import { Button } from '../components/base/Button';
import { Badge } from '../components/display/Badge';
import { Field } from '../components/form/Field';
import { Input } from '../components/form/Input';
import { Toggle } from '../components/form/Toggle';
import { Modal } from '../components/overlay/Modal';
import { RecipeIngredients } from '../components/meals/RecipeIngredients';
import { useAuthContext } from '../auth/AuthContext';
import {
  createRecipe,
  deactivateRecipe,
  deleteRecipe,
  fetchRecipe,
  MealsApiError,
  reactivateRecipe,
  updateRecipe,
  type MealRecipe,
  type RecipeBlockedIngredient,
  type RecipeCategory,
  type RecipeDetail,
  type RecipeIngredient,
  type RecipeWriteBody,
} from '../meals/mealsApi';

const ALL_CATEGORIES: RecipeCategory[] = ['rask', 'comfort', 'helg'];
const CATEGORY_BADGE_VARIANT: Record<RecipeCategory, 'mint' | 'cyan' | 'amber'> = {
  rask: 'mint',
  comfort: 'cyan',
  helg: 'amber',
};

const TEXTAREA_CLASSES = [
  'block w-full rounded-md bg-canvas-0 text-text-1 placeholder:text-text-3',
  'border border-stroke px-3 py-2 font-body text-body',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
].join(' ');

interface IngredientDraft {
  key: string;
  name: string;
  qty: string;
  unit: string;
  optional: boolean;
  productKey?: string;
}

interface EditorDraft {
  name: string;
  category: RecipeCategory;
  prepTime: string;
  servings: string;
  url: string;
  notes: string;
  ingredients: IngredientDraft[];
}

interface ImportLocationState {
  blockedIngredients?: RecipeBlockedIngredient[];
}

function isAdultRole(role: string | undefined): boolean {
  return role === 'owner' || role === 'adult';
}

function newIngredientKey(): string {
  return `ing-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyIngredient(): IngredientDraft {
  return { key: newIngredientKey(), name: '', qty: '', unit: '', optional: false };
}

function emptyDraft(): EditorDraft {
  return {
    name: '',
    category: 'rask',
    prepTime: '',
    servings: '',
    url: '',
    notes: '',
    ingredients: [emptyIngredient()],
  };
}

function draftFromRecipe(recipe: RecipeDetail): EditorDraft {
  const ingredients =
    recipe.ingredients.length > 0
      ? recipe.ingredients.map((ing) => {
          const row: IngredientDraft = {
            key: newIngredientKey(),
            name: ing.name,
            qty: String(ing.qty),
            unit: ing.unit,
            optional: Boolean(ing.optional),
          };
          if (ing.productKey) row.productKey = ing.productKey;
          return row;
        })
      : [emptyIngredient()];
  return {
    name: recipe.name,
    category: recipe.category,
    prepTime: recipe.prepTime ?? '',
    servings: recipe.servings != null ? String(recipe.servings) : '',
    url: recipe.url ?? '',
    notes: recipe.notes ?? '',
    ingredients,
  };
}

function snapshot(draft: EditorDraft): string {
  return JSON.stringify({
    name: draft.name,
    category: draft.category,
    prepTime: draft.prepTime,
    servings: draft.servings,
    url: draft.url,
    notes: draft.notes,
    ingredients: draft.ingredients.map((row) => ({
      name: row.name,
      qty: row.qty,
      unit: row.unit,
      optional: row.optional,
    })),
  });
}

function rowComplete(row: IngredientDraft): boolean {
  const qty = Number(row.qty);
  return row.name.trim().length > 0 && row.unit.trim().length > 0 && Number.isFinite(qty);
}

function parseRecipeId(raw: string | undefined): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function RecipeEditor(): JSX.Element {
  const { t } = useTranslation(['recipes', 'common']);
  const { user } = useAuthContext();
  const isAdult = isAdultRole(user?.role);
  const isChild = user?.role === 'child';
  const params = useParams<{ id?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isCreate = params.id === undefined;
  const recipeId = parseRecipeId(params.id);

  const importState = (location.state ?? null) as ImportLocationState | null;

  const [draft, setDraft] = useState<EditorDraft>(emptyDraft);
  const [baseline, setBaseline] = useState<string>(() => snapshot(emptyDraft()));
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(!isCreate);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ingredientError, setIngredientError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const isDesktop = useIsMd();

  useEffect(() => {
    if (isCreate) {
      const initial = emptyDraft();
      setDraft(initial);
      setBaseline(snapshot(initial));
      setRecipe(null);
      setIsLoading(false);
      setLoadError(null);
      return;
    }
    if (recipeId === null) {
      setIsLoading(false);
      setLoadError(t('recipes:errors.loadOneFailed'));
      setRecipe(null);
      return;
    }
    const ctrl = new AbortController();
    setIsLoading(true);
    setLoadError(null);
    fetchRecipe(recipeId, ctrl.signal).then(
      (res) => {
        if (ctrl.signal.aborted) return;
        setRecipe(res.recipe);
        const next = draftFromRecipe(res.recipe);
        setDraft(next);
        setBaseline(snapshot(next));
        setIsLoading(false);
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setRecipe(null);
        setIsLoading(false);
        setLoadError(
          err instanceof MealsApiError && err.status === 404
            ? t('recipes:errors.loadOneFailed')
            : err instanceof Error
              ? err.message
              : t('recipes:errors.loadOneFailed')
        );
      }
    );
    return () => ctrl.abort();
  }, [isCreate, recipeId, t]);

  const dirty = snapshot(draft) !== baseline;
  const nameOk = draft.name.trim().length >= 2;
  const incompleteRow = draft.ingredients.some((row) => !rowComplete(row));
  const saveEnabled = nameOk && !incompleteRow && !saving;

  const blockedFromImport = importState?.blockedIngredients ?? [];
  const blockedFromRecipe = recipe?.blockedIngredients ?? [];
  const blockedList =
    blockedFromImport.length > 0
      ? blockedFromImport
      : recipe?.safeForProfile === false || recipe?.hiddenByAllergy
        ? blockedFromRecipe
        : [];

  if (isChild && isCreate) {
    return <Navigate to="/recipes" replace />;
  }

  function updateDraft(patch: Partial<EditorDraft>): void {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function updateIngredient(key: string, patch: Partial<IngredientDraft>): void {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  }

  function addIngredient(): void {
    setDraft((prev) => ({ ...prev, ingredients: [...prev.ingredients, emptyIngredient()] }));
  }

  function removeIngredient(key: string): void {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.filter((row) => row.key !== key),
    }));
  }

  function handleUnitKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number): void {
    if (event.key !== 'Enter') return;
    if (index !== draft.ingredients.length - 1) return;
    event.preventDefault();
    addIngredient();
  }

  function buildBody(): RecipeWriteBody | null {
    const complete = draft.ingredients.filter(rowComplete);
    if (complete.length === 0) {
      setIngredientError(t('recipes:errors.ingredientsRequired'));
      return null;
    }
    setIngredientError(null);
    const body: RecipeWriteBody = {
      name: draft.name.trim().slice(0, 200),
      category: draft.category,
      ingredients: complete.map((row) => {
        const item: NonNullable<RecipeWriteBody['ingredients']>[number] = {
          name: row.name.trim(),
          qty: Number(row.qty),
          unit: row.unit.trim(),
          optional: row.optional,
        };
        if (row.productKey) item.productKey = row.productKey;
        return item;
      }),
    };
    if (draft.prepTime.trim()) body.prepTime = draft.prepTime.trim();
    const servings = Number(draft.servings);
    if (Number.isInteger(servings) && servings >= 1) body.servings = servings;
    if (draft.url.trim()) body.url = draft.url.trim();
    if (draft.notes.trim()) body.notes = draft.notes.trim();
    return body;
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!isAdult || !saveEnabled) return;
    const body = buildBody();
    if (!body) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isCreate) {
        const res = await createRecipe(body);
        const id = res.recipeId ?? res.recipe.id;
        navigate(`/recipes/${id}`, { replace: true });
        return;
      }
      if (recipeId === null) return;
      const res = await updateRecipe(recipeId, body);
      setRecipe(res.recipe);
      const next = draftFromRecipe(res.recipe);
      setDraft(next);
      setBaseline(snapshot(next));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError(t('recipes:errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel(): void {
    if (dirty && !window.confirm(t('recipes:actions.confirmDiscard'))) return;
    navigate('/recipes');
  }

  async function handleDeactivate(): Promise<void> {
    if (recipeId === null) return;
    setBusyAction(true);
    setSaveError(null);
    try {
      await deactivateRecipe(recipeId);
      navigate('/recipes');
    } catch {
      setSaveError(t('recipes:errors.deactivateFailed'));
    } finally {
      setBusyAction(false);
      setDeactivateOpen(false);
      setConflictCount(null);
    }
  }

  async function handleReactivate(): Promise<void> {
    if (recipeId === null) return;
    setBusyAction(true);
    setSaveError(null);
    try {
      const res = await reactivateRecipe(recipeId);
      setRecipe(res.recipe);
    } catch {
      setSaveError(t('recipes:errors.saveFailed'));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (recipeId === null) return;
    setBusyAction(true);
    setSaveError(null);
    try {
      await deleteRecipe(recipeId);
      navigate('/recipes');
    } catch (err) {
      if (
        err instanceof MealsApiError &&
        (err.status === 409 || err.status === 405 || err.code === 'RECIPE_IN_USE')
      ) {
        setConflictCount(err.mealPlanCount ?? 1);
        setDeactivateOpen(true);
      } else {
        setSaveError(t('recipes:errors.deactivateFailed'));
      }
    } finally {
      setBusyAction(false);
    }
  }

  const heading = isCreate
    ? t('recipes:editor.createTitle')
    : recipe?.name || t('recipes:editor.editTitle');

  const saveBar = (
    <div className="flex items-center justify-end gap-2">
      <Button type="button" variant="ghost" onClick={handleCancel} data-testid="recipe-cancel">
        {t('common:actions.cancel')}
      </Button>
      <Button
        type="submit"
        variant="primary"
        loading={saving}
        disabled={!saveEnabled}
        data-testid="recipe-save"
      >
        {t('recipes:actions.save')}
      </Button>
    </div>
  );

  return (
    <section aria-labelledby="recipe-editor-heading" className="flex flex-col gap-4" data-testid="recipe-editor">
      <Link
        to="/recipes"
        className="font-body text-body text-mint underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
        data-testid="recipe-back"
      >
        {t('recipes:actions.backToLibrary')}
      </Link>

      {isLoading ? (
        <div role="status" aria-live="polite" data-testid="recipe-editor-skeleton">
          <span className="sr-only">{t('common:status.loading')}</span>
          <Card padding="md" shadow="low">
            <div className="flex flex-col gap-3">
              <div className="h-5 w-1/2 animate-pulse rounded-pill bg-stroke-strong" />
              <div className="h-3 w-1/3 animate-pulse rounded-pill bg-stroke-strong" />
            </div>
          </Card>
        </div>
      ) : null}

      {!isLoading && loadError !== null ? (
        <Card padding="md" shadow="low" data-testid="recipe-editor-error">
          <div className="flex flex-col gap-3" role="alert">
            <p className="font-body text-body text-text-2">{t('recipes:errors.loadOneFailed')}</p>
            <Link
              to="/recipes"
              className="font-body text-body text-mint underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
            >
              {t('recipes:actions.backToLibrary')}
            </Link>
          </div>
        </Card>
      ) : null}

      {!isLoading && loadError === null && (isCreate || recipe) && isChild ? (
        <RecipeReadOnly recipe={recipe as RecipeDetail} blockedList={blockedList} heading={heading} />
      ) : null}

      {!isLoading && loadError === null && (isCreate || recipe) && !isChild ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSave(e)} noValidate>
          <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <h1 id="recipe-editor-heading" className="font-display text-display-md text-text-1">
              {heading}
            </h1>
            {isDesktop ? <div className="hidden md:block">{saveBar}</div> : null}
          </header>

          {recipe && recipe.active === false ? (
            <Card padding="md" shadow="low" className="border-rose/30 bg-rose/10" data-testid="recipe-inactive-banner">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-body text-body text-text-1">{t('recipes:status.inactive')}</p>
                <Button
                  type="button"
                  variant="secondary"
                  loading={busyAction}
                  onClick={() => void handleReactivate()}
                  data-testid="recipe-reactivate"
                >
                  {t('recipes:actions.reactivate')}
                </Button>
              </div>
            </Card>
          ) : null}

          {blockedList.length > 0 ? (
            <Card padding="md" shadow="low" className="border-amber/30 bg-amber/10" data-testid="recipe-allergy-banner">
              <p className="font-body text-body text-text-1">
                {t('recipes:import.allergyWarning', {
                  list: blockedList.map((item) => item.name).join(', '),
                })}
              </p>
            </Card>
          ) : null}

          {saveError ? (
            <p role="alert" className="font-body text-body text-rose-deep" data-testid="recipe-save-error">
              {saveError}
            </p>
          ) : null}

          {savedFlash ? (
            <p role="status" aria-live="polite" className="font-body text-meta text-text-2" data-testid="recipe-saved">
              {t('common:status.saved')}
            </p>
          ) : null}

          <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6">
            <div className="flex flex-col gap-4">
              <Field label={t('recipes:fields.name')} required>
                <Input
                  value={draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  maxLength={200}
                  data-testid="recipe-field-name"
                />
              </Field>
              <fieldset>
                <legend className="mb-1.5 font-body text-meta text-text-2">
                  {t('recipes:fields.category')}
                </legend>
                <div className="flex flex-wrap gap-2" role="group">
                  {ALL_CATEGORIES.map((category) => {
                    const pressed = draft.category === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => updateDraft({ category })}
                        className={[
                          'rounded-lg border px-3 py-2 font-body text-body',
                          pressed
                            ? 'border-mint bg-surface-strong text-text-1'
                            : 'border-stroke bg-surface text-text-2',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-mint',
                        ].join(' ')}
                        data-testid={`recipe-category-${category}`}
                      >
                        {t(`recipes:category.${category}`)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <Field label={t('recipes:fields.prepTime')} hint={t('recipes:fields.prepTimeHint')}>
                <Input
                  value={draft.prepTime}
                  onChange={(e) => updateDraft({ prepTime: e.target.value })}
                  placeholder="25 min"
                  data-testid="recipe-field-prepTime"
                />
              </Field>
              <Field label={t('recipes:fields.servings')}>
                <Input
                  type="number"
                  min={1}
                  value={draft.servings}
                  onChange={(e) => updateDraft({ servings: e.target.value })}
                  data-testid="recipe-field-servings"
                />
              </Field>
              <Field label={t('recipes:fields.url')}>
                <Input
                  type="url"
                  inputMode="url"
                  value={draft.url}
                  onChange={(e) => updateDraft({ url: e.target.value })}
                  data-testid="recipe-field-url"
                />
              </Field>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <h2 className="font-display text-card text-text-1">{t('recipes:fields.ingredients')}</h2>
                {ingredientError ? (
                  <p role="alert" className="font-body text-meta text-rose-deep" data-testid="recipe-ingredients-error">
                    {ingredientError}
                  </p>
                ) : null}
                {draft.ingredients.map((row, index) => (
                  <Card key={row.key} padding="sm" shadow="low" data-testid={`recipe-ingredient-row-${index}`}>
                    <div className="flex flex-col gap-2">
                      <Field label={t('recipes:fields.ingredientName')} required>
                        <Input
                          value={row.name}
                          onChange={(e) => updateIngredient(row.key, { name: e.target.value })}
                          data-testid={`recipe-ing-name-${index}`}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label={t('recipes:fields.qty')} required>
                          <Input
                            type="number"
                            step="any"
                            value={row.qty}
                            onChange={(e) => updateIngredient(row.key, { qty: e.target.value })}
                            data-testid={`recipe-ing-qty-${index}`}
                          />
                        </Field>
                        <Field label={t('recipes:fields.unit')} required>
                          <Input
                            value={row.unit}
                            onChange={(e) => updateIngredient(row.key, { unit: e.target.value })}
                            onKeyDown={(e) => handleUnitKeyDown(e, index)}
                            data-testid={`recipe-ing-unit-${index}`}
                          />
                        </Field>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Toggle
                          checked={row.optional}
                          onChange={(checked) => updateIngredient(row.key, { optional: checked })}
                          label={t('recipes:fields.optional')}
                          size="sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIngredient(row.key)}
                          aria-label={t('recipes:fields.removeIngredient', {
                            name: row.name.trim() || t('recipes:fields.ingredientName'),
                          })}
                          data-testid={`recipe-ing-remove-${index}`}
                        >
                          {t('common:actions.delete')}
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={addIngredient}
                  data-testid="recipe-add-ingredient"
                >
                  {t('recipes:fields.addIngredient')}
                </Button>
              </div>

              <Field label={t('recipes:fields.notes')}>
                <textarea
                  rows={6}
                  value={draft.notes}
                  onChange={(e) => updateDraft({ notes: e.target.value })}
                  className={TEXTAREA_CLASSES}
                  data-testid="recipe-field-notes"
                />
              </Field>
            </div>
          </div>

          {!isCreate && recipe ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                className="self-start text-rose-deep"
                onClick={() => {
                  setConflictCount(null);
                  setDeactivateOpen(true);
                }}
                data-testid="recipe-deactivate"
              >
                {t('recipes:actions.deactivate')}
              </Button>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                  data-testid="recipe-more"
                >
                  {t('recipes:actions.more')}
                </Button>
                {moreOpen ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-deep"
                      onClick={() => void handleDelete()}
                      data-testid="recipe-delete"
                    >
                      {t('recipes:actions.delete')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!isDesktop ? (
            <div className="sticky bottom-20 z-10 -mx-4 border-t border-stroke bg-canvas-0/90 px-4 py-3 backdrop-blur md:hidden">
              {saveBar}
            </div>
          ) : null}
        </form>
      ) : null}

      <Modal
        open={deactivateOpen}
        onClose={() => {
          if (!busyAction) {
            setDeactivateOpen(false);
            setConflictCount(null);
          }
        }}
        title={t('recipes:actions.deactivate')}
        description={
          conflictCount !== null
            ? t('recipes:deactivate.conflict', { count: conflictCount })
            : t('recipes:deactivate.confirm', { name: draft.name.trim() || heading })
        }
      >
        <div className="flex flex-row-reverse items-center justify-start gap-2">
          <Button
            type="button"
            variant="primary"
            loading={busyAction}
            onClick={() => void handleDeactivate()}
            data-testid={conflictCount !== null ? 'recipe-409-deactivate' : 'recipe-deactivate-confirm'}
          >
            {t('recipes:actions.deactivate')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDeactivateOpen(false);
              setConflictCount(null);
            }}
            disabled={busyAction}
          >
            {t('common:actions.cancel')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function RecipeReadOnly({
  recipe,
  blockedList,
  heading,
}: {
  recipe: RecipeDetail;
  blockedList: RecipeBlockedIngredient[];
  heading: string;
}): JSX.Element {
  const { t } = useTranslation('recipes');
  const mealRecipe: MealRecipe = {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    prepTime: recipe.prepTime,
    servings: recipe.servings,
    source: recipe.source ?? null,
    url: recipe.url ?? null,
    notes: recipe.notes,
    ingredients: recipe.ingredients as RecipeIngredient[],
  };
  const badgeVariant = CATEGORY_BADGE_VARIANT[recipe.category] ?? 'cyan';

  return (
    <div className="flex flex-col gap-4" data-testid="recipe-readonly">
      <h1 id="recipe-editor-heading" className="font-display text-display-md text-text-1">
        {heading}
      </h1>
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
      {blockedList.length > 0 ? (
        <Card padding="md" shadow="low" className="border-amber/30 bg-amber/10">
          <p className="font-body text-body text-text-1">
            {t('import.allergyWarning', { list: blockedList.map((item) => item.name).join(', ') })}
          </p>
        </Card>
      ) : null}
      {recipe.notes ? <p className="font-body text-body text-text-1 whitespace-pre-wrap">{recipe.notes}</p> : null}
      <RecipeIngredients recipe={mealRecipe} scale={1} />
    </div>
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
