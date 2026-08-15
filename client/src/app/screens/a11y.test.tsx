// Screen-level WCAG 2.1 AA accessibility audit. Each screen is mounted
// with the providers it needs in production (MemoryRouter +
// AuthProvider + ThemeProvider when relevant), fetch is stubbed with
// the smallest data fixture that exercises the data-state path, and
// axe-core scans the rendered DOM for violations.
//
// The intent is to lock in zero-violations now so a future change that
// strips an aria-label or breaks a heading hierarchy fails this suite
// before it lands. Color-contrast is checked separately by
// client/src/app/styles/contrast.test.ts.

import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expectNoAxeViolations } from '../../test-helpers/axe';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeContext';
import type { AuthUser } from '../auth/authApi';
import { Dashboard } from './Dashboard';
import { Family } from './Family';
import { Meals } from './Meals';
import { Shopping } from './Shopping';
import { Settings } from './Settings';

const TEST_USER: AuthUser = {
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
  vi.restoreAllMocks();
});

function mockFetchByPath(handlers: Record<string, () => Response>): void {
  // Sprint 9 PR #119: Family screen now also fetches
  // /api/family/invitations for owners. Pre-fill an empty array when the
  // caller does not supply its own handler.
  const withDefaults: Record<string, () => Response> = {
    '/api/family/invitations': () => jsonResponse(200, { invitations: [] }),
    ...handlers,
  };
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(withDefaults)) {
      if (url === pattern || url.startsWith(pattern + '?') || url.startsWith(pattern)) {
        return Promise.resolve(handler());
      }
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

// ---------------------------------------------------------------------
// Minimal but realistic data fixtures.
// ---------------------------------------------------------------------

const TODAY_DATA = {
  dayName: 'Mandag',
  dayOfWeek: 0,
  weekYear: '2026-W18',
  meal: {
    dayOfWeek: 0,
    recipeId: 1,
    status: 'planned',
    notes: null,
    recipe: { id: 1, name: 'Pasta carbonara', category: 'rask', prepTime: '30 min', servings: 4 },
  },
  chores: [
    {
      choreId: 1,
      task: 'Vaske gulv',
      icon: '🧹',
      status: 'pending',
      scheduledDay: 0,
      postponedTo: null,
    },
  ],
  events: [],
};

const SHOPPING_SUMMARY = {
  id: 1,
  weekYear: '2026-W18',
  status: 'active',
  items: [{ id: 1, ingredientName: 'Mel', qty: 1, unit: 'kg', checkedOff: false }],
  totalEstPrice: 50,
};

const UPCOMING = {
  events: [{ id: 1, title: 'Bursdag', date: '2026-05-10', startTime: '18:00' }],
};

const FAMILY_DATA = {
  family: {
    id: 1,
    name: 'Frestad',
    ownerUserId: 1,
    createdAt: '2026-04-01 12:00:00',
    updatedAt: '2026-04-01 12:00:00',
  },
  profileMembers: [
    {
      id: 10,
      name: 'Christer',
      category: 'adult',
      portionFactor: 1.0,
      sortOrder: 0,
      allergies: null,
      dislikes: null,
      dietTags: [],
      customDietNote: null,
      createdAt: '2026-04-01 12:00:00',
      updatedAt: '2026-04-01 12:00:00',
    },
  ],
  users: [
    {
      id: 1,
      email: 'peder@example.com',
      name: 'Christer',
      role: 'owner' as const,
      avatarUrl: null,
      profileMemberId: 10,
    },
  ],
  portionSum: 1,
};

const MEALS_DATA = {
  weekYear: '2026-W18',
  meals: Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    dayName: ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][i] ?? '',
    recipeId: i === 0 ? 1 : null,
    status: i === 0 ? 'planned' : 'unplanned',
    notes: null,
    recipe:
      i === 0
        ? {
            id: 1,
            name: 'Pasta carbonara',
            category: 'rask',
            prepTime: '25 min',
            servings: 4,
            source: null,
            url: null,
            notes: null,
            ingredients: [{ id: 1, productKey: 'pasta', name: 'Pasta', qty: 400, unit: 'g' }],
          }
        : null,
  })),
};

const SHOPPING_FULL = {
  id: 42,
  weekYear: '2026-W18',
  status: 'active',
  enrichmentStatus: 'done',
  totalEstPrice: 100,
  categories: [
    {
      category: 'Meieri',
      items: [
        {
          id: 1,
          listId: 42,
          sourceType: 'meal_ingredient',
          sourceRef: 'r1',
          ingredientName: 'Melk',
          ingredientNameNo: null,
          name: 'Melk',
          productKey: 'melk',
          qty: 2,
          unit: 'l',
          category: 'Meieri',
          packSize: null,
          packUnit: null,
          packCount: null,
          estPrice: 25,
          pantryHas: false,
          pantryQty: null,
          needsBuy: true,
          boughtAt: null,
          boughtQty: null,
          checkedOff: false,
          stillNeed: 2,
          mealsJson: ['Pasta pesto'],
          dairyNote: null,
          sortOrder: 0,
          notes: null,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------
// Tests — one per screen. Each waits for the loading skeleton to clear
// (data-testid="...-skeleton" no longer present) before running axe.
// Region-rule is enabled here because screens carry the full landmark
// structure that makes the rule meaningful.
// ---------------------------------------------------------------------

describe('a11y — Screens', () => {
  it('Dashboard data state passes axe', async () => {
    mockFetchByPath({
      '/api/today': () => jsonResponse(200, TODAY_DATA),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_SUMMARY),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING),
    });
    const { container, findByText } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ThemeProvider>
          <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
            <Dashboard />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    await findByText('Pasta carbonara');
    await expectNoAxeViolations(container);
  });

  it('Family data state passes axe', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    const { container, findByTestId } = render(
      <MemoryRouter initialEntries={['/family']}>
        <ThemeProvider>
          <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
            <Family />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    await findByTestId('member-card-10');
    await expectNoAxeViolations(container);
  });

  it('Meals data state passes axe', async () => {
    mockFetchByPath({
      '/api/meals/current': () => jsonResponse(200, MEALS_DATA),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    const { container, findByTestId } = render(
      <MemoryRouter initialEntries={['/meals']}>
        <ThemeProvider>
          <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
            <Meals />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    await findByTestId('meals-content');
    await expectNoAxeViolations(container);
  });

  it('Shopping data state passes axe', async () => {
    mockFetchByPath({
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_FULL),
      '/api/pantry': () => jsonResponse(200, { items: [] }),
    });
    const { container, findByText } = render(
      <MemoryRouter initialEntries={['/shopping']}>
        <ThemeProvider>
          <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
            <Shopping />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    await findByText('Melk');
    await expectNoAxeViolations(container);
  });

  it('Settings data state passes axe', async () => {
    mockFetchByPath({
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    const { container, findByText } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <ThemeProvider>
          <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
            <Settings />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    // Wait for the family-name section to render past the skeleton.
    await findByText('Frestad');
    await expectNoAxeViolations(container);
  });

  it('Dashboard error state passes axe', async () => {
    mockFetchByPath({
      '/api/today': () => jsonResponse(500, { error: 'boom' }),
      '/api/shopping/list/current': () => jsonResponse(500, { error: 'boom' }),
      '/api/calendar/events': () => jsonResponse(500, { error: 'boom' }),
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ThemeProvider>
          <AuthProvider initialState={{ user: TEST_USER, isLoading: false }}>
            <Dashboard />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    await waitFor(() => {
      const alerts = container.querySelectorAll('[role="alert"]');
      // Dashboard renders one alert per failed card.
      if (alerts.length === 0) throw new Error('alerts not yet rendered');
    });
    await expectNoAxeViolations(container);
  });
});
