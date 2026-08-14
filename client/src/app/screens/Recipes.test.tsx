// Integration tests for the G0-4 Recipes library screen.
//
// useMealsData-style: we do not extract a dedicated hook file. Mount
// Recipes, spy on GET /api/recipes, and assert:
//   * skeleton while the fetch is in flight
//   * empty card when the family has no recipes
//   * list rows show name, category, prepTime, servings
//   * error card + retry reloads
//   * a child viewer has no import CTA (G0 is read-only)

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Recipes } from './Recipes';
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

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

function mountRecipes(user: AuthUser = ADULT_USER): void {
  render(
    <MemoryRouter initialEntries={['/recipes']}>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <Recipes />
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, () => Response>): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url === pattern || url.startsWith(pattern + '?')) {
        return Promise.resolve(handler());
      }
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

function recipesPayload(
  recipes: Array<{
    id: number;
    name: string;
    category: string;
    prepTime: string | null;
    servings: number | null;
  }>
): unknown {
  return {
    recipes,
    filter: { ignoreDietTags: false, activeDietTags: [] },
  };
}

describe('Recipes — initial render', () => {
  test('shows skeleton while fetch is in flight', () => {
    fetchSpy.mockImplementation(() => new Promise(() => undefined));
    mountRecipes();
    expect(screen.getByTestId('recipes-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Oppskrifter', level: 1 })).toBeInTheDocument();
  });

  test('renders empty state when the family has no recipes', async () => {
    mockFetchByPath({
      '/api/recipes': () => jsonResponse(200, recipesPayload([])),
    });
    mountRecipes();
    await waitFor(() => {
      expect(screen.getByTestId('recipes-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('Ingen oppskrifter ennå')).toBeInTheDocument();
    expect(screen.queryByTestId('recipes-list')).toBeNull();
  });

  test('renders recipe name, category, prepTime and servings', async () => {
    mockFetchByPath({
      '/api/recipes': () =>
        jsonResponse(
          200,
          recipesPayload([
            {
              id: 42,
              name: 'Pasta pesto',
              category: 'rask',
              prepTime: '20 min',
              servings: 4,
            },
          ])
        ),
    });
    mountRecipes();
    await waitFor(() => {
      expect(screen.getByTestId('recipes-list')).toBeInTheDocument();
    });
    const row = screen.getByTestId('recipe-row-42');
    expect(row).toHaveTextContent('Pasta pesto');
    expect(row).toHaveTextContent('Rask');
    expect(row).toHaveTextContent('20 min');
    expect(row).toHaveTextContent('4 porsjoner');
  });

  test('renders error card with retry on fetch failure', async () => {
    mockFetchByPath({
      '/api/recipes': () => jsonResponse(500, { detail: 'boom' }),
    });
    mountRecipes();
    await waitFor(() => {
      expect(screen.getByTestId('recipes-error')).toBeInTheDocument();
    });
    mockFetchByPath({
      '/api/recipes': () =>
        jsonResponse(
          200,
          recipesPayload([
            {
              id: 7,
              name: 'Tacos',
              category: 'helg',
              prepTime: '30 min',
              servings: 2,
            },
          ])
        ),
    });
    fireEvent.click(screen.getByText(/Prøv igjen/));
    await waitFor(() => {
      expect(screen.getByTestId('recipes-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('recipe-row-7')).toHaveTextContent('Tacos');
  });
});

describe('Recipes — role surfaces', () => {
  test('adult sees the G1 note and no import CTA', async () => {
    mockFetchByPath({
      '/api/recipes': () => jsonResponse(200, recipesPayload([])),
    });
    mountRecipes(ADULT_USER);
    await waitFor(() => {
      expect(screen.getByTestId('recipes-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('recipes-g1-note')).toBeInTheDocument();
    expect(screen.queryByTestId('recipes-import-cta')).toBeNull();
  });

  test('child has no import CTA', async () => {
    mockFetchByPath({
      '/api/recipes': () =>
        jsonResponse(
          200,
          recipesPayload([
            {
              id: 1,
              name: 'Pannekaker',
              category: 'rask',
              prepTime: '15 min',
              servings: 2,
            },
          ])
        ),
    });
    mountRecipes(CHILD_USER);
    await waitFor(() => {
      expect(screen.getByTestId('recipes-list')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('recipes-import-cta')).toBeNull();
    expect(screen.queryByTestId('recipes-g1-note')).toBeNull();
  });
});
