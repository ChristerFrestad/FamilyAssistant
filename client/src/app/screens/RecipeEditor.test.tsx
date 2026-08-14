// Integration tests for the G1 recipe editor.
//
// /recipes/new creates via POST /api/recipes.
// /recipes/:id loads GET /api/recipes/:id, PATCHes on save, and
// deactivates via POST /api/recipes/:id/deactivate.
// Children are redirected away from /new and see a read-only detail.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RecipeEditor } from './RecipeEditor';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/authApi';

const ADULT_USER: AuthUser = {
  id: 1,
  email: 'peder@example.com',
  name: 'Christer',
  role: 'owner',
  avatarUrl: null,
  familyId: 1,
  profileMemberId: 10,
  onboardingCompleted: true,
  synthetic: false,
};

const CHILD_USER: AuthUser = {
  ...ADULT_USER,
  id: 2,
  email: 'barn@example.com',
  name: 'Storebror',
  role: 'child',
  profileMemberId: 11,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TACO = {
  id: 12,
  name: 'Hjemmelaget taco',
  category: 'rask' as const,
  prepTime: '20 min',
  servings: 4,
  source: null,
  sourceType: 'manual',
  url: null,
  notes: 'Fredagsklassiker',
  active: true,
  ingredients: [
    { id: 1, productKey: null, name: 'kjøttdeig', qty: 400, unit: 'g', optional: false },
    { id: 2, productKey: null, name: 'tortilla', qty: 8, unit: 'stk', optional: false },
  ],
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

function mountEditor(path: string, user: AuthUser = ADULT_USER): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <Routes>
          <Route path="/recipes" element={<div data-testid="recipes-library">library</div>} />
          <Route path="/recipes/new" element={<RecipeEditor />} />
          <Route path="/recipes/:id" element={<RecipeEditor />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockApi(
  handlers: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>
): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.split('?')[0] ?? url;
    const exact = `${method} ${path}`;
    const handler = handlers[exact] ?? handlers[`${method} ${path.replace(/\/\d+$/, '/:id')}`];
    if (!handler) return Promise.reject(new Error(`Unmocked fetch: ${method} ${url}`));
    return Promise.resolve(handler(url, init));
  });
}

describe('RecipeEditor — create', () => {
  test('adult create form posts and opens the new recipe', async () => {
    const posts: unknown[] = [];
    mockApi({
      'POST /api/recipes': (_url, init) => {
        posts.push(JSON.parse(String(init?.body ?? '{}')));
        return jsonResponse(201, { ok: true, recipeId: 99, recipe: { ...TACO, id: 99 } });
      },
      'GET /api/recipes/99': () => jsonResponse(200, { recipe: { ...TACO, id: 99 } }),
    });
    mountEditor('/recipes/new');
    expect(screen.getByTestId('recipe-editor')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ny oppskrift', level: 1 })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('recipe-field-name'), { target: { value: 'Taco' } });
    fireEvent.change(screen.getByTestId('recipe-ing-name-0'), { target: { value: 'kjøttdeig' } });
    fireEvent.change(screen.getByTestId('recipe-ing-qty-0'), { target: { value: '400' } });
    fireEvent.change(screen.getByTestId('recipe-ing-unit-0'), { target: { value: 'g' } });
    fireEvent.click(screen.getByTestId('recipe-save'));

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]).toMatchObject({
      name: 'Taco',
      category: 'rask',
      ingredients: [{ name: 'kjøttdeig', qty: 400, unit: 'g' }],
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Hjemmelaget taco', level: 1 })).toBeInTheDocument();
    });
  });

  test('save stays disabled until name is long enough', () => {
    fetchSpy.mockImplementation(() => Promise.reject(new Error('no fetch on create')));
    mountEditor('/recipes/new');
    expect(screen.getByTestId('recipe-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('recipe-field-name'), { target: { value: 'A' } });
    expect(screen.getByTestId('recipe-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('recipe-field-name'), { target: { value: 'Ab' } });
    expect(screen.getByTestId('recipe-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('recipe-ing-name-0'), { target: { value: 'salt' } });
    fireEvent.change(screen.getByTestId('recipe-ing-qty-0'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('recipe-ing-unit-0'), { target: { value: 'ts' } });
    expect(screen.getByTestId('recipe-save')).not.toBeDisabled();
  });

  test('zero ingredient rows show a field error and do not POST', async () => {
    const posts: unknown[] = [];
    mockApi({
      'POST /api/recipes': (_url, init) => {
        posts.push(JSON.parse(String(init?.body ?? '{}')));
        return jsonResponse(201, { ok: true, recipeId: 1, recipe: TACO });
      },
    });
    mountEditor('/recipes/new');
    fireEvent.change(screen.getByTestId('recipe-field-name'), { target: { value: 'Suppe' } });
    fireEvent.click(screen.getByTestId('recipe-ing-remove-0'));
    fireEvent.click(screen.getByTestId('recipe-save'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-ingredients-error')).toBeInTheDocument();
    });
    expect(posts).toHaveLength(0);
  });

  test('child on /recipes/new is redirected to the library', () => {
    fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse(200, { recipes: [] })));
    mountEditor('/recipes/new', CHILD_USER);
    expect(screen.getByTestId('recipes-library')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-editor')).toBeNull();
  });
});

describe('RecipeEditor — edit', () => {
  test('loads the recipe and PATCHes on save', async () => {
    const patches: unknown[] = [];
    mockApi({
      'GET /api/recipes/12': () => jsonResponse(200, { recipe: TACO }),
      'PATCH /api/recipes/12': (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        patches.push(body);
        return jsonResponse(200, { ok: true, recipe: { ...TACO, name: body.name } });
      },
    });
    mountEditor('/recipes/12');
    await waitFor(() => {
      expect(screen.getByTestId('recipe-field-name')).toHaveValue('Hjemmelaget taco');
    });
    fireEvent.change(screen.getByTestId('recipe-field-name'), { target: { value: 'Taco deluxe' } });
    fireEvent.click(screen.getByTestId('recipe-save'));
    await waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0]).toMatchObject({ name: 'Taco deluxe' });
    await waitFor(() => {
      expect(screen.getByTestId('recipe-saved')).toBeInTheDocument();
    });
  });

  test('unknown id shows an error and a back link', async () => {
    mockApi({
      'GET /api/recipes/404': () => jsonResponse(404, { detail: 'not found' }),
    });
    mountEditor('/recipes/404');
    await waitFor(() => {
      expect(screen.getByTestId('recipe-editor-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('recipe-back')).toHaveAttribute('href', '/recipes');
  });

  test('deactivate confirms and returns to the library', async () => {
    mockApi({
      'GET /api/recipes/12': () => jsonResponse(200, { recipe: TACO }),
      'POST /api/recipes/12/deactivate': () =>
        jsonResponse(200, { ok: true, recipe: { ...TACO, active: false } }),
    });
    mountEditor('/recipes/12');
    await waitFor(() => {
      expect(screen.getByTestId('recipe-deactivate')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('recipe-deactivate'));
    fireEvent.click(screen.getByTestId('recipe-deactivate-confirm'));
    await waitFor(() => {
      expect(screen.getByTestId('recipes-library')).toBeInTheDocument();
    });
  });

  test('409 delete offers deactivate instead', async () => {
    mockApi({
      'GET /api/recipes/12': () => jsonResponse(200, { recipe: TACO }),
      'DELETE /api/recipes/12': () =>
        jsonResponse(409, { code: 'RECIPE_IN_USE', mealPlanCount: 3, detail: 'in use' }),
      'POST /api/recipes/12/deactivate': () =>
        jsonResponse(200, { ok: true, recipe: { ...TACO, active: false } }),
    });
    mountEditor('/recipes/12');
    await waitFor(() => {
      expect(screen.getByTestId('recipe-more')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('recipe-more'));
    fireEvent.click(screen.getByTestId('recipe-delete'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-409-deactivate')).toBeInTheDocument();
    });
    expect(screen.getByText(/3 dag/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('recipe-409-deactivate'));
    await waitFor(() => {
      expect(screen.getByTestId('recipes-library')).toBeInTheDocument();
    });
  });
});

describe('RecipeEditor — child read-only', () => {
  test('renders text, not inputs, and omits save and deactivate', async () => {
    mockApi({
      'GET /api/recipes/12': () => jsonResponse(200, { recipe: TACO }),
    });
    mountEditor('/recipes/12', CHILD_USER);
    await waitFor(() => {
      expect(screen.getByTestId('recipe-readonly')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Hjemmelaget taco', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Fredagsklassiker')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-field-name')).toBeNull();
    expect(screen.queryByTestId('recipe-save')).toBeNull();
    expect(screen.queryByTestId('recipe-deactivate')).toBeNull();
    expect(screen.getByTestId('recipe-ingredients')).toBeInTheDocument();
  });
});
