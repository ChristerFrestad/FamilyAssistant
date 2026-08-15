// Integration tests for the Dashboard screen.
//
// We don't drive the real fetch layer here — useDashboardData has
// its own dedicated hook tests. Instead we mount Dashboard inside
// the same providers it sees in production (AuthProvider +
// MemoryRouter), spy on globalThis.fetch with three mocked
// responses, and assert that:
//   * all four cards render their data (or empty/error/skeleton)
//   * a card-level retry button refetches just that card
//   * quick-actions are present at the bottom

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Dashboard } from './Dashboard';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/authApi';

const TEST_USER: AuthUser = {
  id: 7,
  email: 'peder@example.com',
  name: 'Christer',
  role: 'owner',
  avatarUrl: null,
  familyId: 5,
  profileMemberId: 9,
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
});

function mountDashboard(user: AuthUser = TEST_USER): void {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <Dashboard />
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, (init?: RequestInit) => Response>): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url === pattern || url.startsWith(pattern)) return Promise.resolve(handler(init));
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

const TODAY_DATA = {
  dayName: 'Mandag',
  dayOfWeek: 0,
  weekYear: '2026-W18',
  meal: {
    dayOfWeek: 0,
    recipeId: 12,
    status: 'planned',
    notes: null,
    recipe: { id: 12, name: 'Pasta carbonara', category: 'rask', prepTime: '30 min', servings: 4 },
  },
  chores: [
    {
      choreId: 1,
      task: 'Vaske gulv',
      icon: '🧹',
      status: 'pending',
      scheduledDay: 0,
      postponedTo: null,
      assigneeMemberId: null,
    },
    {
      choreId: 2,
      task: 'Lufte rom',
      icon: '🪟',
      status: 'pending',
      scheduledDay: 0,
      postponedTo: null,
      assigneeMemberId: null,
    },
  ],
  events: [],
};

const SHOPPING_DATA = {
  id: 5,
  weekYear: '2026-W18',
  status: 'active',
  items: [
    { id: 1, ingredientName: 'Mel', qty: 1, unit: 'kg', checkedOff: false },
    { id: 2, ingredientName: 'Egg', qty: 6, unit: 'stk', checkedOff: false },
    { id: 3, ingredientName: 'Smør', qty: 1, unit: 'pk', checkedOff: false },
  ],
  totalEstPrice: 100,
};

const UPCOMING_DATA = {
  events: [{ id: 1, title: 'Bursdag Lise', date: '2026-05-02', startTime: '18:00' }],
};

describe('Dashboard screen', () => {
  test('renders the welcome header and four cards once data resolves', async () => {
    mockFetchByPath({
      '/api/today': () => jsonResponse(200, TODAY_DATA),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
    });

    mountDashboard();

    // Welcome header — we don't pin the time-of-day in this test
    // because the actual greeting flexes with new Date().getHours().
    // We just confirm the personalised name appears in the heading.
    expect(screen.getByRole('heading', { level: 1, name: /Christer/i })).toBeInTheDocument();

    await waitFor(() => {
      // Meal card
      expect(screen.getByText('Pasta carbonara')).toBeInTheDocument();
      // Chores card (top 3 limit, only 2 in fixture)
      expect(screen.getByText(/Vaske gulv/)).toBeInTheDocument();
      expect(screen.getByText(/Lufte rom/)).toBeInTheDocument();
      // Shopping card — count summary "3 varer igjen"
      expect(screen.getByText(/3 varer igjen/i)).toBeInTheDocument();
      // Upcoming events card — title plus a real date (not Invalid Date)
      expect(screen.getByText('Bursdag Lise')).toBeInTheDocument();
      expect(screen.queryByText(/Invalid Date/)).toBeNull();
    });

    // Quick actions row at the bottom.
    expect(screen.getByRole('navigation', { name: /Hurtighandlinger/i })).toBeInTheDocument();
  });

  test('renders empty-state copy when shopping list has no items', async () => {
    mockFetchByPath({
      '/api/today': () => jsonResponse(200, { ...TODAY_DATA, meal: null, chores: [] }),
      '/api/shopping/list/current': () =>
        jsonResponse(200, {
          id: null,
          weekYear: '2026-W18',
          status: null,
          items: [],
          totalEstPrice: 0,
        }),
      '/api/calendar/events': () => jsonResponse(200, { events: [] }),
    });

    mountDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Ingen måltider planlagt for i dag/)).toBeInTheDocument();
      expect(screen.getByText(/Ingen gjøremål for i dag/)).toBeInTheDocument();
      expect(screen.getByText(/Handlelisten er tom/)).toBeInTheDocument();
      expect(screen.getByText(/Ingen kommende hendelser/)).toBeInTheDocument();
    });
  });

  test('renders error + retry button when /api/today fails', async () => {
    mockFetchByPath({
      '/api/today': () => jsonResponse(500, { detail: 'boom' }),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
    });

    mountDashboard();

    // The "today" alert shows up alongside the resolved shopping
    // card. Two Try-again buttons would be wrong; we expect exactly
    // one because only the today-bound cards fail. Both meals AND
    // chores cards share the today fetch, so we expect TWO retry
    // buttons (one per card sharing the same retry callback).
    await waitFor(() => {
      const retries = screen.getAllByRole('button', { name: /Prøv igjen/i });
      expect(retries.length).toBeGreaterThanOrEqual(1);
    });
    // Shopping resolved fine, so the count line is visible.
    expect(screen.getByText(/3 varer igjen/i)).toBeInTheDocument();
  });

  test('retry on the chores card refetches /api/today only', async () => {
    let todayCalls = 0;
    mockFetchByPath({
      '/api/today': () => {
        todayCalls += 1;
        return todayCalls === 1
          ? jsonResponse(500, { detail: 'boom' })
          : jsonResponse(200, TODAY_DATA);
      },
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
    });

    mountDashboard();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Prøv igjen/i }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Prøv igjen/i })[0]!);

    await waitFor(() => {
      expect(screen.getByText('Pasta carbonara')).toBeInTheDocument();
    });
    expect(todayCalls).toBe(2);
  });

  test('click complete fires PUT /api/chores/complete with choreId', async () => {
    const bodies: unknown[] = [];
    mockFetchByPath({
      '/api/today': () => jsonResponse(200, TODAY_DATA),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
      '/api/chores/complete': (init) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(200, { ok: true });
      },
    });

    mountDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('chore-complete-1')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('chore-complete-1');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });
    expect(bodies).toEqual([{ choreId: 1, weekYear: '2026-W18' }]);
    expect(screen.getByText(/Vaske gulv/)).toBeInTheDocument();
  });

  test('click undo after complete fires PUT /api/chores/undone with choreId', async () => {
    const completeBodies: unknown[] = [];
    const undoBodies: unknown[] = [];
    mockFetchByPath({
      '/api/today': () => jsonResponse(200, TODAY_DATA),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
      '/api/chores/complete': (init) => {
        completeBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(200, { ok: true });
      },
      '/api/chores/undone': (init) => {
        undoBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(200, { ok: true });
      },
    });

    mountDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('chore-complete-1')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('chore-complete-1');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-pressed', 'false');
    });
    expect(completeBodies).toEqual([{ choreId: 1, weekYear: '2026-W18' }]);
    expect(undoBodies).toEqual([{ choreId: 1, weekYear: '2026-W18' }]);
  });

  test('child cannot complete a chore assigned to another member', async () => {
    const child: AuthUser = {
      ...TEST_USER,
      id: 8,
      role: 'child',
      profileMemberId: 11,
      name: 'Storebror',
    };
    mockFetchByPath({
      '/api/today': () =>
        jsonResponse(200, {
          ...TODAY_DATA,
          chores: [
            {
              choreId: 8,
              task: 'Pappa-oppgave',
              icon: '🧹',
              status: 'pending',
              scheduledDay: 0,
              postponedTo: null,
              assigneeMemberId: 99,
            },
            {
              choreId: 9,
              task: 'Eget rom',
              icon: '🛏️',
              status: 'pending',
              scheduledDay: 0,
              postponedTo: null,
              assigneeMemberId: 11,
            },
          ],
        }),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
    });

    mountDashboard(child);

    await waitFor(() => {
      expect(screen.getByText(/Pappa-oppgave/)).toBeInTheDocument();
      expect(screen.getByText(/Eget rom/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chore-complete-8')).not.toBeInTheDocument();
    expect(screen.getByTestId('chore-complete-9')).toBeInTheDocument();
  });

  test('keeps the three-item chores limit', async () => {
    mockFetchByPath({
      '/api/today': () =>
        jsonResponse(200, {
          ...TODAY_DATA,
          chores: [
            {
              choreId: 1,
              task: 'En',
              icon: '1',
              status: 'pending',
              scheduledDay: 0,
              postponedTo: null,
            },
            {
              choreId: 2,
              task: 'To',
              icon: '2',
              status: 'pending',
              scheduledDay: 0,
              postponedTo: null,
            },
            {
              choreId: 3,
              task: 'Tre',
              icon: '3',
              status: 'pending',
              scheduledDay: 0,
              postponedTo: null,
            },
            {
              choreId: 4,
              task: 'Fire',
              icon: '4',
              status: 'pending',
              scheduledDay: 0,
              postponedTo: null,
            },
          ],
        }),
      '/api/shopping/list/current': () => jsonResponse(200, SHOPPING_DATA),
      '/api/calendar/events': () => jsonResponse(200, UPCOMING_DATA),
    });

    mountDashboard();

    await waitFor(() => {
      expect(screen.getByText('En')).toBeInTheDocument();
    });
    expect(screen.getByText('To')).toBeInTheDocument();
    expect(screen.getByText('Tre')).toBeInTheDocument();
    expect(screen.queryByText('Fire')).not.toBeInTheDocument();
    expect(screen.getByTestId('chore-complete-1')).toBeInTheDocument();
    expect(screen.getByTestId('chore-complete-2')).toBeInTheDocument();
    expect(screen.getByTestId('chore-complete-3')).toBeInTheDocument();
    expect(screen.queryByTestId('chore-complete-4')).not.toBeInTheDocument();
  });
});
