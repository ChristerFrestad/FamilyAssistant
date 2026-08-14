// Integration tests for the Chores week board.
//
// Mount Chores with AuthProvider + MemoryRouter, spy on fetch for
// GET /api/chores/current + GET /api/family and the complete / undo /
// postpone / create mutations. Assert:
//   * skeleton, error+retry, empty week, empty day, data
//   * complete sets aria-pressed and PUTs /api/chores/complete
//   * child omits FAB, postpone, and add modal
//   * adult postpone / add are present

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Chores } from './Chores';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/authApi';
import type { CurrentChore } from '../chores/choresApi';

const ADULT_USER: AuthUser = {
  id: 1,
  email: 'peder@example.com',
  name: 'Christer',
  role: 'adult',
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

function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}

function otherDay(): number {
  return (todayIndex() + 3) % 7;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
});

function mountChores(user: AuthUser = ADULT_USER): void {
  render(
    <MemoryRouter initialEntries={['/chores']}>
      <AuthProvider initialState={{ user, isLoading: false }}>
        <Chores />
      </AuthProvider>
    </MemoryRouter>
  );
}

function mockFetchByPath(handlers: Record<string, (init?: RequestInit) => Response>): void {
  fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const byMethod = handlers[key];
    if (byMethod) return Promise.resolve(byMethod(init));
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (pattern.startsWith('GET ') || pattern.startsWith('PUT ') || pattern.startsWith('POST ')) {
        continue;
      }
      if (url === pattern || url.startsWith(`${pattern}?`)) {
        return Promise.resolve(handler(init));
      }
    }
    return Promise.reject(new Error(`Unmocked fetch: ${method} ${url}`));
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
  users: [
    {
      id: 1,
      email: 'peder@example.com',
      name: 'Christer',
      avatarUrl: null,
      role: 'adult',
      profileMemberId: 10,
      lastSeenAt: null,
    },
  ],
  portionSum: 3,
};

function makeChore(
  partial: Partial<CurrentChore> & Pick<CurrentChore, 'choreId' | 'task'>
): CurrentChore {
  const day = partial.effectiveDay ?? todayIndex();
  return {
    icon: '🧹',
    frequency: 'ukentlig',
    details: null,
    scheduledDay: day,
    postponedTo: null,
    effectiveDay: day,
    dayName: 'dag',
    status: 'pending',
    ...partial,
  };
}

function currentPayload(chores: CurrentChore[]): { weekYear: string; chores: CurrentChore[] } {
  return { weekYear: '2026-W33', chores };
}

describe('Chores — initial render', () => {
  test('shows title and skeleton while fetch is in flight', () => {
    fetchSpy.mockImplementation(() => new Promise(() => undefined));
    mountChores();
    expect(screen.getByRole('heading', { name: 'Gjøremål', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('chores-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Laster...')).toBeInTheDocument();
  });

  test('renders week board after fetch resolves', async () => {
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(200, currentPayload([makeChore({ choreId: 7, task: 'Vaske gulv' })])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chores-content')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chores-week-year')).toHaveTextContent('Uke 2026-W33');
    expect(screen.getAllByTestId(/^chores-day-pill-\d$/)).toHaveLength(7);
    expect(screen.getByTestId('chore-row-7')).toBeInTheDocument();
    expect(screen.getByText('Vaske gulv')).toBeInTheDocument();
  });

  test('renders error card with retry on fetch failure', async () => {
    mockFetchByPath({
      '/api/chores/current': () => jsonResponse(500, { detail: 'boom' }),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chores-error')).toBeInTheDocument();
    });
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(200, currentPayload([makeChore({ choreId: 1, task: 'Rydd' })])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    await waitFor(() => {
      expect(screen.getByTestId('chores-content')).toBeInTheDocument();
    });
    expect(screen.getByText('Rydd')).toBeInTheDocument();
  });
});

describe('Chores — empty states', () => {
  test('empty week shows adult add CTA and muted strip', async () => {
    mockFetchByPath({
      '/api/chores/current': () => jsonResponse(200, currentPayload([])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chores-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('Ingen gjøremål denne uken')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('chores-empty')).getByRole('button', { name: 'Ny oppgave' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('chores-day-strip')).toBeInTheDocument();
    expect(screen.getByTestId('chores-fab')).toBeInTheDocument();
    expect(screen.getByTestId('chores-add')).toBeInTheDocument();
  });

  test('child empty week has no add CTA, FAB, or header add', async () => {
    mockFetchByPath({
      '/api/chores/current': () => jsonResponse(200, currentPayload([])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores(CHILD_USER);
    await waitFor(() => {
      expect(screen.getByTestId('chores-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chores-fab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chores-add')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('chores-empty')).queryByRole('button')
    ).not.toBeInTheDocument();
  });

  test('empty selected day shows day-empty card', async () => {
    const filled = otherDay();
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(
          200,
          currentPayload([
            makeChore({
              choreId: 3,
              task: 'Annen dag',
              effectiveDay: filled,
              scheduledDay: filled,
            }),
          ])
        ),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chores-content')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chores-day-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`chores-day-pill-${filled}`));
    await waitFor(() => {
      expect(screen.getByTestId('chore-row-3')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chores-day-empty')).not.toBeInTheDocument();
  });
});

describe('Chores — complete / undo / postpone', () => {
  test('complete is aria-pressed false then true and PUTs /api/chores/complete', async () => {
    const bodies: unknown[] = [];
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(200, currentPayload([makeChore({ choreId: 12, task: 'Tøm søppel' })])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      'PUT /api/chores/complete': (init) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(200, { ok: true });
      },
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chore-complete-12')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('chore-complete-12');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });
    expect(bodies).toEqual([{ choreId: 12, weekYear: '2026-W33' }]);
  });

  test('complete failure reverts and shows an alert', async () => {
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(200, currentPayload([makeChore({ choreId: 12, task: 'Tøm søppel' })])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      'PUT /api/chores/complete': () => jsonResponse(500, { detail: 'nope' }),
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chore-complete-12')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('chore-complete-12'));
    await waitFor(() => {
      expect(screen.getByTestId('chores-action-error')).toHaveTextContent(
        'Kunne ikke markere som gjort.'
      );
    });
    expect(screen.getByTestId('chore-complete-12')).toHaveAttribute('aria-pressed', 'false');
  });

  test('undo PUTs /api/chores/undone', async () => {
    const bodies: unknown[] = [];
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(
          200,
          currentPayload([makeChore({ choreId: 4, task: 'Støvsug', status: 'done' })])
        ),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      'PUT /api/chores/undone': (init) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(200, { ok: true });
      },
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chore-undo-4')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('chore-undo-4'));
    await waitFor(() => {
      expect(bodies).toEqual([{ choreId: 4, weekYear: '2026-W33' }]);
    });
  });

  test('adult postpone PUTs /api/chores/postpone', async () => {
    const bodies: unknown[] = [];
    const day = Math.min(todayIndex(), 3);
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(
          200,
          currentPayload([
            makeChore({
              choreId: 9,
              task: 'Tørke støv',
              effectiveDay: day,
              scheduledDay: day,
            }),
          ])
        ),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      'PUT /api/chores/postpone': (init) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(200, { ok: true });
      },
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chores-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`chores-day-pill-${day}`));
    await waitFor(() => {
      expect(screen.getByTestId('chore-postpone-9')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('chore-postpone-9'));
    await waitFor(() => {
      expect(bodies).toEqual([{ choreId: 9, weekYear: '2026-W33' }]);
    });
  });

  test('child has complete but no postpone, FAB, or add', async () => {
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(200, currentPayload([makeChore({ choreId: 5, task: 'Rydde rommet' })])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores(CHILD_USER);
    await waitFor(() => {
      expect(screen.getByTestId('chore-row-5')).toBeInTheDocument();
    });
    expect(screen.getByTestId('chore-complete-5')).toBeInTheDocument();
    expect(screen.queryByTestId('chore-postpone-5')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chores-fab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chores-add')).not.toBeInTheDocument();
  });

  test('child cannot complete a chore assigned to someone else', async () => {
    mockFetchByPath({
      '/api/chores/current': () =>
        jsonResponse(
          200,
          currentPayload([
            makeChore({
              choreId: 8,
              task: 'Pappa-oppgave',
              assignedUserId: 1,
              assignedName: 'Christer',
            }),
          ])
        ),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
    });
    mountChores(CHILD_USER);
    await waitFor(() => {
      expect(screen.getByTestId('chore-row-8')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chore-complete-8')).not.toBeInTheDocument();
  });
});

describe('Chores — add modal (adult)', () => {
  test('FAB opens the add modal and POST creates the chore', async () => {
    const posts: unknown[] = [];
    mockFetchByPath({
      '/api/chores/current': () => jsonResponse(200, currentPayload([])),
      '/api/family': () => jsonResponse(200, FAMILY_DATA),
      'POST /api/chores': (init) => {
        posts.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(201, {
          ok: true,
          chore: { id: 99, task: 'Ny oppgave', frequency: 'ukentlig' },
        });
      },
    });
    mountChores();
    await waitFor(() => {
      expect(screen.getByTestId('chores-fab')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('chores-fab'));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Ny oppgave' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('chores-field-task'), {
      target: { value: 'Tøm søppel' },
    });
    fireEvent.click(screen.getByTestId('chores-default-day-3'));
    fireEvent.click(screen.getByTestId('chores-add-submit'));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]).toMatchObject({
      task: 'Tøm søppel',
      frequency: 'ukentlig',
      defaultDay: 3,
      icon: '✅',
    });
  });
});
