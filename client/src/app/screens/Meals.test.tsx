// Integration tests for the Meals screen.
//
// We don't drive the hook layer here — useMealsData has its own
// tests. Instead we mount Meals, spy on globalThis.fetch for the
// GET /api/meals/current + GET /api/family round-trips, and assert:
//   * skeleton, error, and data states render correctly
//   * DayStrip selection drives MealHero + RecipeIngredients
//   * defensive scaling-unavailable handling kicks in for recipes
//     without servings
//   * placeholder buttons (swap + plan) show inline status
//   * empty week renders the "no meals planned"-card
//
// The real screen does not depend on AuthContext directly (the route
// is gated by AuthGuard upstream), so we don't need to wrap with an
// AuthProvider — only with a MemoryRouter for any nested Link.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Meals } from './Meals';

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

function mountMeals(): void {
  render(
    <MemoryRouter initialEntries={['/meals']}>
      <Meals />
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, () => Response>): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Week navigation hits /api/meals/week/:weekYear — reuse the
    // /api/meals/current handler so existing fixtures stay valid.
    const normalized = url.startsWith('/api/meals/week/') ? '/api/meals/current' : url;
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (
        normalized === pattern ||
        normalized.startsWith(pattern + '?') ||
        url === pattern ||
        url.startsWith(pattern + '?')
      ) {
        return Promise.resolve(handler());
      }
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

const FAMILY_DATA = {
  family: {
    id: 1,
    name: 'Familie Frestad',
    ownerUserId: 1,
    createdAt: '2026-04-01 12:00:00',
    updatedAt: '2026-04-01 12:00:00',
  },
  profileMembers: [],
  users: [],
  portionSum: 3,
};

function makeMealsPayload(
  overrides: Array<Partial<{ recipeId: number | null; status: string; recipe: unknown }>> = []
): unknown {
  return {
    weekYear: '2026-W18',
    meals: Array.from({ length: 7 }, (_, i) => {
      const ov = overrides[i] ?? {};
      const baseRecipe = {
        id: i + 1,
        name: `Recipe ${i + 1}`,
        category: 'rask',
        prepTime: '25 min',
        servings: 2,
        source: null,
        url: null,
        notes: null,
        ingredients: [
          { id: i * 2 + 1, productKey: 'kylling', name: 'Kyllingfilet', qty: 400, unit: 'g' },
          { id: i * 2 + 2, productKey: 'ris', name: 'Jasminris', qty: 300, unit: 'g' },
        ],
      };
      return {
        dayOfWeek: i,
        dayName: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][i] ?? '',
        recipeId: 'recipeId' in ov ? ov.recipeId : i + 1,
        status: ov.status ?? 'planned',
        notes: null,
        recipe: 'recipe' in ov ? ov.recipe : baseRecipe,
      };
    }),
  };
}

describe('Meals — initial render', () => {
  test('shows skeleton while fetch is in flight', () => {
    fetchSpy.mockImplementation(() => new Promise(() => undefined));
    mountMeals();
    expect(screen.getByTestId('meals-skeleton')).toBeInTheDocument();
  });

  test('renders Open library link to /recipes', () => {
    fetchSpy.mockImplementation(() => new Promise(() => undefined));
    mountMeals();
    const link = screen.getByRole('link', { name: 'Åpne bibliotek' });
    expect(link).toHaveAttribute('href', '/recipes');
    expect(screen.getByTestId('meals-open-library')).toBe(link);
  });

  test('renders week menu after fetch resolves', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload()),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    expect(screen.getByTestId('meals-week-year')).toHaveTextContent('Uke 2026-W18');
    // 7 day-pills (id ends at digit so we exclude planned/empty/today
    // sub-test-ids on the same pill).
    expect(screen.getAllByTestId(/^day-pill-\d$/)).toHaveLength(7);
  });

  test('renders error card with retry on fetch failure', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(500, { detail: 'boom' }),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-error')).toBeInTheDocument();
    });
    // Retry triggers a new fetch path
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload()),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    fireEvent.click(screen.getByText(/Prøv igjen/));
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
  });
});

describe('Meals — DayStrip selection drives MealHero', () => {
  test('selecting another day re-renders the hero with that day data', async () => {
    mockFetchByPath({
      '/api/meals/current': () =>
        jsonResponse(
          200,
          makeMealsPayload([
            // index 0 = Recipe 1 (default)
            // index 3 = recipe with a different name to assert against
            {},
            {},
            {},
            {
              recipeId: 99,
              recipe: {
                id: 99,
                name: 'Lasagne torsdag',
                category: 'comfort',
                prepTime: '40 min',
                servings: 4,
                source: null,
                url: null,
                notes: null,
                ingredients: [
                  { id: 1, productKey: 'kjøttdeig', name: 'Kjøttdeig', qty: 500, unit: 'g' },
                ],
              },
            },
          ])
        ),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-3'));
    await waitFor(() => {
      expect(screen.getByTestId('meal-hero-name')).toHaveTextContent('Lasagne torsdag');
    });
  });
});

describe('Meals — recipe ingredients and scaling', () => {
  test('renders scaled ingredient quantities when recipe.servings is set', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload()),
      '/api/family': () => jsonResponse(200, { ...FAMILY_DATA, portionSum: 3 }),
    });
    mountMeals();
    // Force selection to day 0 to make assertions deterministic
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-0'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-scaled-servings')).toBeInTheDocument();
    });
    // 400 g * (3/2) = 600 g — assert that the math made it through.
    expect(screen.getByText(/600 g/)).toBeInTheDocument();
  });

  test('falls back to un-scaled with badge when recipe.servings is null', async () => {
    mockFetchByPath({
      '/api/meals/current': () =>
        jsonResponse(
          200,
          makeMealsPayload([
            {
              recipe: {
                id: 1,
                name: 'No-servings recipe',
                category: 'rask',
                prepTime: '15 min',
                servings: null,
                source: null,
                url: null,
                notes: null,
                ingredients: [{ id: 1, productKey: 'tomat', name: 'Tomat', qty: 200, unit: 'g' }],
              },
            },
          ])
        ),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-0'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-scaling-unavailable-badge')).toBeInTheDocument();
    });
    // Original quantity preserved
    expect(screen.getByText(/200 g/)).toBeInTheDocument();
  });

  test('hides recipe card when status is away', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload([{ status: 'away' }])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-0'));
    await waitFor(() => {
      expect(screen.getByTestId('meal-hero-away')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('meals-recipe-card')).toBeNull();
  });
});

describe('Meals — picker integration', () => {
  test('swap button on a recipe slot opens the recipe picker dialog', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload()),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      '/api/recipes': () =>
        jsonResponse(200, {
          recipes: [{ id: 99, name: 'Pizza', category: 'rask', prepTime: '15 min', servings: 2 }],
          filter: { ignoreDietTags: false, activeDietTags: [] },
        }),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-0'));
    await waitFor(() => {
      expect(screen.getByTestId('meal-hero-swap-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('meal-hero-swap-button'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-picker')).toBeInTheDocument();
    });
    expect(screen.getByTestId('recipe-picker-row-99')).toBeInTheDocument();
  });

  test('plan button on empty hero opens the recipe picker dialog', async () => {
    mockFetchByPath({
      '/api/meals/current': () =>
        jsonResponse(200, makeMealsPayload([{ recipeId: null, recipe: null }])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      '/api/recipes': () =>
        jsonResponse(200, {
          recipes: [{ id: 7, name: 'Tacos', category: 'rask', prepTime: '20 min', servings: 2 }],
          filter: { ignoreDietTags: false, activeDietTags: [] },
        }),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-0'));
    await waitFor(() => {
      expect(screen.getByTestId('meal-hero-plan-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('meal-hero-plan-button'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-picker')).toBeInTheDocument();
    });
    expect(screen.getByTestId('recipe-picker-row-7')).toBeInTheDocument();
  });
});

describe('Meals — always 7 days keyed by dayOfWeek (F1)', () => {
  test('a 6-row week still renders 7 correctly labelled days and a plannable gap', async () => {
    const full = makeMealsPayload() as { weekYear: string; meals: Array<{ dayOfWeek: number }> };
    const sixDays = { ...full, meals: full.meals.filter((m) => m.dayOfWeek !== 2) };
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, sixDays),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId(/^day-pill-\d$/)).toHaveLength(7);
    expect(screen.getByTestId('day-pill-2-empty')).toBeInTheDocument();
    expect(screen.getByTestId('week-list-row-2')).toHaveTextContent('Onsdag');
    expect(screen.getByTestId('week-list-row-2-text')).toHaveTextContent('+ Legg til middag');
    const thursday = screen.getByTestId('week-list-row-3');
    expect(thursday).toHaveTextContent('Torsdag');
    expect(thursday).toHaveTextContent('Recipe 4');
    expect(screen.getByTestId('week-list-row-6')).toHaveTextContent('Søndag');
  });
});

describe('Meals — past week without a plan is read-only (F2)', () => {
  test('shows «Ingen plan for denne uka» with no plan/cook actions', async () => {
    const payload = {
      weekYear: '2026-W30',
      readOnly: true,
      meals: Array.from({ length: 7 }, (_, i) => ({
        id: null,
        dayOfWeek: i,
        dayName: '',
        recipeId: null,
        status: 'planned',
        notes: null,
        recipe: null,
      })),
    };
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, payload),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-week-readonly')).toBeInTheDocument();
    });
    expect(screen.getByTestId('meals-week-readonly')).toHaveTextContent('Ingen plan for denne uka');
    expect(screen.queryByTestId('meals-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meal-hero-plan-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('week-list')).not.toBeInTheDocument();
    // Week navigation stays available so the user can go forward again.
    expect(screen.getByTestId('meals-week-next')).toBeInTheDocument();
  });
});

describe('Meals — empty week', () => {
  test('renders week-empty card when all 7 slots are null', async () => {
    const allEmpty = makeMealsPayload(
      Array.from({ length: 7 }, () => ({ recipeId: null, recipe: null }))
    );
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, allEmpty),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-week-empty')).toBeInTheDocument();
    });
    // The week-list (7 rows) should NOT render in empty mode — the
    // empty card stands in for it.
    expect(screen.queryByTestId('week-list')).toBeNull();
  });
});

describe('Meals — family fetch failure does not block the screen', () => {
  test('renders meals + un-scaled ingredients when family endpoint 500s', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload()),
      '/api/family': () => jsonResponse(500, { detail: 'family-down' }),
    });
    mountMeals();
    await waitFor(() => {
      expect(screen.getByTestId('meals-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('day-pill-0'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-ingredient-list')).toBeInTheDocument();
    });
    // 400 g without scaling (family failed, so scale defaults to 1)
    expect(screen.getByText(/400 g/)).toBeInTheDocument();
  });
});

describe('Meals — week navigation', () => {
  test('renders prev/next week controls and advances the URL week', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, makeMealsPayload()),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    render(
      <MemoryRouter initialEntries={['/meals']}>
        <Meals />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId('meals-week-nav')).toBeInTheDocument();
    });
    expect(screen.getByTestId('meals-week-prev')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/forrige|previous/i)
    );
    expect(screen.getByTestId('meals-week-next')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/neste|next/i)
    );
    fireEvent.click(screen.getByTestId('meals-week-next'));
    await waitFor(() => {
      // After next, fetch should hit a /api/meals/week/… path at least once.
      const weekCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('/api/meals/week/')
      );
      expect(weekCalls.length).toBeGreaterThan(0);
    });
  });
});
