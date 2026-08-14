// Tests for mealsApi.ts.
//
// Three contracts:
//   1. fetchMealsCurrent hits /api/meals/current with credentials.
//   2. Non-2xx responses throw MealsApiError carrying the status.
//   3. AbortSignal flows through to fetch.

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import {
  createRecipe,
  deactivateRecipe,
  fetchMealsCurrent,
  fetchRecipes,
  importRecipeFromUrl,
  MealsApiError,
} from './mealsApi';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

describe('fetchMealsCurrent', () => {
  test('GETs /api/meals/current with credentials and parses the body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        weekYear: '2026-W18',
        meals: [
          {
            dayOfWeek: 0,
            dayName: 'mandag',
            recipeId: 1,
            status: 'planned',
            notes: null,
            recipe: {
              id: 1,
              name: 'Kylling red curry',
              category: 'rask',
              prepTime: '25 min',
              servings: 2,
              source: 'godt.no',
              url: 'https://www.godt.no/test',
              notes: null,
              ingredients: [
                { id: 1, productKey: 'kylling', name: 'Kyllingfilet', qty: 400, unit: 'g' },
              ],
            },
          },
        ],
      })
    );
    const r = await fetchMealsCurrent();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/meals/current',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(r.weekYear).toBe('2026-W18');
    expect(r.meals).toHaveLength(1);
    expect(r.meals[0]?.recipe?.name).toBe('Kylling red curry');
  });

  test('throws MealsApiError carrying the status on 500', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    try {
      await fetchMealsCurrent();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MealsApiError);
      expect((err as MealsApiError).status).toBe(500);
      expect((err as MealsApiError).message).toBe('boom');
    }
  });

  test('throws MealsApiError on 401 with HTTP-prefixed fallback when body is unparseable', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not-json', { status: 401 }));
    try {
      await fetchMealsCurrent();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MealsApiError);
      expect((err as MealsApiError).status).toBe(401);
      expect((err as MealsApiError).message).toBe('HTTP 401');
    }
  });

  test('forwards AbortSignal to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { weekYear: '2026-W18', meals: [] }));
    const ctrl = new AbortController();
    await fetchMealsCurrent(ctrl.signal);
    const callArgs = fetchSpy.mock.calls[0]?.[1];
    expect((callArgs as RequestInit | undefined)?.signal).toBe(ctrl.signal);
  });
});

describe('recipe mutations', () => {
  test('fetchRecipes appends source and includeInactive query params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { recipes: [], filter: {} }));
    await fetchRecipes(undefined, { source: 'imported', includeInactive: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/recipes?source=imported&includeInactive=1',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
  });

  test('createRecipe POSTs /api/recipes and returns recipeId', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(201, { ok: true, recipeId: 8, recipe: { id: 8 } }));
    const res = await createRecipe({
      name: 'Taco',
      category: 'rask',
      ingredients: [{ name: 'kjøttdeig', qty: 400, unit: 'g' }],
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/recipes',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    expect(res.recipeId).toBe(8);
  });

  test('deactivateRecipe POSTs /api/recipes/:id/deactivate', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, recipe: { id: 3, active: false } }));
    await deactivateRecipe(3);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/recipes/3/deactivate',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('importRecipeFromUrl POSTs the URL and surfaces 400 as MealsApiError', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(400, { detail: 'Missing url' }));
    await expect(importRecipeFromUrl('')).rejects.toMatchObject({
      name: 'MealsApiError',
      status: 400,
      message: 'Missing url',
    });
  });
});
